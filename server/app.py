"""FastAPI-Server: statische Auslieferung, WebSocket-Sync, Bild-Upload.

Rollen-Erkennung ohne Login: Nur Anfragen vom Laptop selbst (Loopback,
127.0.0.1/::1) gelten als Spielleiter. Handys verbinden sich über die
LAN-IP und sind damit automatisch Spieler – sie können nicht SL werden.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import uuid
from pathlib import Path

import qrcode
from fastapi import FastAPI, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .game import Game, UPLOAD_DIR
from .paths import RESOURCE_DIR, HOSTNAME, APP_VERSION, local_ip, all_lan_ips, active_port
from . import diag
from . import winnet

WEB_DIR = RESOURCE_DIR / "web"
LOCAL_IP = local_ip()


def join_url() -> str:
    """Beitritts-URL – immer frisch (IP UND Port koennen sich geaendert haben)."""
    return f"http://{LOCAL_IP}:{active_port()}/"

app = FastAPI()
game = Game()


@app.middleware("http")
async def no_cache_for_assets(request: Request, call_next):
    """App-Dateien immer neu validieren, damit Updates sofort ankommen.
    Hochgeladene Bilder (/uploads) dürfen normal gecacht werden."""
    resp = await call_next(request)
    path = request.url.path
    if (path.startswith("/static") or path.startswith("/api") or path == "/qr.png"
            or path in ("/", "/tv") or path.endswith(".html")):
        resp.headers["Cache-Control"] = "no-cache"
    # Nur die SEITEN-Aufrufe loggen (nicht jede Asset-Datei): so sieht man, ob die
    # Anfrage eines Geräts überhaupt ankommt. Fehlt sie -> Firewall/Netz blockt.
    if path in ("/", "/tv"):
        ip = getattr(getattr(request, "client", None), "host", "?")
        diag.log(f"SEITE '{path}' geladen von ip={ip} (status {resp.status_code})")
    return resp


@app.get("/api/info")
async def api_info():
    """Beitritts-Info (IP/URL) – bei JEDEM Aufruf frisch, damit ein WLAN-Wechsel
    ohne Neustart auffällt. Liefert ALLE Kandidaten-IPs (falls eine nicht geht)."""
    ips = all_lan_ips()
    primary = ips[0] if ips else LOCAL_IP
    return JSONResponse({
        "ip": primary, "port": active_port(),
        "url": f"http://{primary}:{active_port()}/",
        "ips": ips,
        "urls": [f"http://{ip}:{active_port()}/" for ip in ips],
        "prettyUrl": f"http://{HOSTNAME}.local:{active_port()}/",
        "version": APP_VERSION,
        "networkPublic": winnet.is_public(),   # True = WLAN „öffentlich" (Firewall blockt)
        "isWindows": os.name == "nt",
    })


@app.get("/qr.png")
async def qr_png():
    """QR-Code zur Beitritts-URL – bei jedem Aufruf frisch aus der AKTUELLEN
    LAN-IP (überlebt so einen WLAN-Wechsel ohne Neustart)."""
    ips = all_lan_ips()
    url = f"http://{ips[0]}:{active_port()}/" if ips else join_url()
    buf = io.BytesIO()
    qrcode.make(url).save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


def _is_loopback(request_or_ws) -> bool:
    client = getattr(request_or_ws, "client", None)
    host = client.host if client else None
    return host in ("127.0.0.1", "::1", "localhost")


def _player_name(pid):
    if not pid:
        return None
    p = next((x for x in game.players if x.get("id") == pid), None)
    return p.get("name") if p else None


class Hub:
    """Verwaltet alle offenen WebSocket-Verbindungen und verteilt den State."""

    def __init__(self) -> None:
        self.sockets: dict[WebSocket, dict] = {}
        self.lock = asyncio.Lock()

    async def add(self, ws: WebSocket, meta: dict) -> None:
        async with self.lock:
            self.sockets[ws] = meta

    async def remove(self, ws: WebSocket) -> None:
        async with self.lock:
            self.sockets.pop(ws, None)

    async def broadcast_state(self) -> None:
        snap = game.snapshot()
        payload = {"type": "state", "state": snap}
        dead = []
        for ws in list(self.sockets):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.remove(ws)


hub = Hub()


@app.get("/tv")
async def tv_page():
    """Read-only Beamer-/TV-Ansicht für einen zweiten Bildschirm."""
    return FileResponse(WEB_DIR / "tv.html")


@app.get("/api/gm-token")
async def gm_token(request: Request):
    """Nur der Laptop (Loopback) erhält das SL-Kennzeichen -> SL-Ansicht."""
    if _is_loopback(request):
        return JSONResponse({"gm": True})
    return JSONResponse({"gm": False}, status_code=403)


@app.post("/api/upload")
async def upload(request: Request, file: UploadFile):
    # Bilder dürfen sowohl der SL (Laptop) als auch Spieler (Handy, Char-Bild)
    # hochladen – reines lokales WLAN-Spiel. Nur Bildtypen, mit Größenlimit.
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        suffix = ".png"
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:   # 8 MB Obergrenze
        return JSONResponse({"error": "too_large"}, status_code=413)
    name = f"{uuid.uuid4().hex}{suffix}"
    dest = UPLOAD_DIR / name
    dest.write_bytes(data)
    return JSONResponse({"url": f"/uploads/{name}"})


@app.get("/api/export")
async def export_backup(request: Request):
    """Sicherung als Download (nur SL/Laptop): Charaktere + Bibliotheken + Begegnungen."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    body = json.dumps(game.export_data(), ensure_ascii=False, indent=2)
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="sundered-skies-backup.json"'})


@app.post("/api/import")
async def import_backup(request: Request, file: UploadFile):
    """Sicherung wiederherstellen (nur SL/Laptop). Ersetzt Charaktere/Bibliotheken."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        return JSONResponse({"error": "too_large"}, status_code=413)
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return JSONResponse({"error": "bad_json"}, status_code=400)
    ok = game.import_data(data)
    await hub.broadcast_state()
    return JSONResponse({"ok": bool(ok)})


@app.post("/api/firewall-allow")
async def firewall_allow(request: Request):
    """Gibt ALLE Ports der App (8000 + Ausweich-Ports) in der Windows-Firewall
    frei (nur SL/Laptop). Startet einen
    erhöhten Prozess -> beim SL erscheint eine UAC-Abfrage."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    ok = await asyncio.get_event_loop().run_in_executor(None, winnet.allow_firewall)
    # Kurz warten und dann PRUEFEN, ob die Regel wirklich existiert - "Elevation
    # gestartet" allein sagt noch nicht, ob sie auch angelegt wurde.
    await asyncio.sleep(2.5)
    aktiv = await asyncio.get_event_loop().run_in_executor(None, winnet.rule_active)
    diag.log(f"Firewall-Freigabe: Elevation={ok}, Regel jetzt aktiv={aktiv}")
    return JSONResponse({"ok": bool(ok)})


@app.get("/uploads/{name}")
async def serve_upload(name: str):
    path = UPLOAD_DIR / name
    if not path.is_file() or ".." in name:
        return Response(status_code=404)
    return FileResponse(path)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    is_gm = _is_loopback(ws)
    client_ip = getattr(getattr(ws, "client", None), "host", "?")
    meta = {"role": "gm" if is_gm else "player", "playerId": None, "ip": client_ip}
    await hub.add(ws, meta)
    diag.log(f"VERBUNDEN  {meta['role']:6s} ip={client_ip}")

    # Initialen Zustand senden.
    await ws.send_json({"type": "hello", "role": meta["role"]})
    await ws.send_json({"type": "state", "state": game.snapshot()})

    reason = "Abbruch"
    try:
        while True:
            msg = await ws.receive_json()
            # Ein fehlerhaftes Einzel-Kommando darf die Verbindung NICHT kappen.
            try:
                await handle_message(ws, meta, msg)
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                diag.log(f"FEHLER in Nachricht ({meta['role']} ip={client_ip}): "
                         f"{type(exc).__name__}: {exc}")
    except WebSocketDisconnect:
        reason = "getrennt"
    except Exception as exc:
        reason = f"Fehler {type(exc).__name__}"
    finally:
        who = _player_name(meta.get("playerId")) or meta["role"]
        diag.log(f"GETRENNT   {meta['role']:6s} ip={client_ip} ({who}) — {reason}")
        if meta.get("playerId"):
            game.set_player_connected(meta["playerId"], False)
            game.save_session()
        await hub.remove(ws)
        await hub.broadcast_state()


async def handle_message(ws: WebSocket, meta: dict, msg: dict) -> None:
    mtype = msg.get("type")

    if mtype == "ping":
        # App-Heartbeat: sofort antworten, damit der Client eine tote Leitung
        # (WLAN-Aussetzer) schnell erkennt. Kein Broadcast, kein State-Touch.
        await ws.send_json({"type": "pong"})
        return

    if mtype == "clientlog":
        # Ein Gerät meldet z. B. „war X s weg" (nach Wieder-Verbinden) -> ins Log,
        # damit die Handy-Seite des Flackerns sichtbar wird. Ändert nichts am Spiel.
        who = _player_name(meta.get("playerId")) or meta.get("role", "?")
        gap = msg.get("gapMs")
        ev = str(msg.get("event", "info"))[:40]
        extra = f" nach {round(gap / 1000, 1)} s weg" if isinstance(gap, (int, float)) else ""
        diag.log(f"HANDY-MELDUNG ({who} ip={meta.get('ip', '?')}): {ev}{extra}")
        return

    if mtype == "join":
        # Spieler tritt bei (aus Charakterliste oder als Gast).
        player = game.register_player(
            name=(msg.get("name") or "Spieler").strip() or "Spieler",
            character_id=msg.get("characterId"),
            existing_player_id=msg.get("playerId"),
        )
        meta["playerId"] = player["id"]
        diag.log(f"BEIGETRETEN  {player.get('name', '?')} (ip={meta.get('ip', '?')})")
        game.save_session()
        await ws.send_json({"type": "joined", "playerId": player["id"]})
        await hub.broadcast_state()
        return

    if mtype == "leave":
        # Spieler verlässt bewusst: eigenen Teilnehmer + Spielereintrag entfernen.
        pid = meta.get("playerId")
        own = next((c for c in game.combatants if c.get("playerId") == pid), None) if pid else None
        if own:
            diag.log(f"VERLASSEN    {own.get('name', '?')} (ip={meta.get('ip', '?')})")
            game.apply({"type": "remove_combatant", "id": own["id"]})
        meta["playerId"] = None
        await hub.broadcast_state()
        return

    if mtype == "gm_action":
        action = msg.get("action") or {}
        atype = action.get("type")

        if meta["role"] == "gm":
            # Der Laptop hat volle Kontrolle.
            if atype == "resume_session":
                game.resume_session()
            elif atype == "discard_session":
                game.discard_saved_session()
            else:
                game.apply(action)
            await hub.broadcast_state()
            return

        # Spieler dürfen nur eng begrenzte Aktionen für den eigenen Charakter.
        pid = meta.get("playerId")
        own = next((c for c in game.combatants if c.get("playerId") == pid), None)
        if not own:
            return
        if atype == "confirm_turn" and game.active_id == own["id"]:
            game.apply({"type": "confirm_turn"})
            await hub.broadcast_state()
        elif atype == "reveal" and action.get("id") == own["id"]:
            # Spieler deckt NUR die eigene Karte auf (tischweit sichtbar).
            game.apply({"type": "reveal", "id": own["id"]})
            await hub.broadcast_state()
        elif atype == "move_zone" and action.get("id") == own["id"]:
            # Spieler bewegt NUR die eigene Figur – und nur EINMAL pro Runde.
            game.apply({"type": "move_zone", "id": own["id"], "byPlayer": True,
                        "dir": action.get("dir"), "run": action.get("run")})
            await hub.broadcast_state()
        elif atype == "set_image" and action.get("id") == own["id"]:
            # Spieler setzt NUR das Bild der eigenen Figur.
            game.apply({"type": "set_image", "id": own["id"], "url": action.get("url")})
            await hub.broadcast_state()
        elif atype in ("hold", "intervene") and action.get("id") == own["id"]:
            game.apply({"type": atype, "id": own["id"]})
            await hub.broadcast_state()
        elif atype == "request":
            # Spieler ändert nichts selbst, sondern stellt eine Anfrage an den SL.
            game.apply({
                "type": "request", "combatantId": own["id"],
                "kind": action.get("kind"), "detail": action.get("detail"),
                "label": action.get("label"),
            })
            await hub.broadcast_state()
        return


# Statische Dateien zuletzt einhängen, damit /api und /ws Vorrang haben.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
