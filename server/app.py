"""FastAPI-Server: statische Auslieferung, WebSocket-Sync, Bild-Upload.

Rollen-Erkennung ohne Login: Nur Anfragen vom Laptop selbst (Loopback,
127.0.0.1/::1) gelten als Spielleiter. Handys verbinden sich über die
LAN-IP und sind damit automatisch Spieler – sie können nicht SL werden.
"""

from __future__ import annotations

import asyncio
import io
from contextlib import asynccontextmanager
import json
import os
import time
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
from . import sicherung

WEB_DIR = RESOURCE_DIR / "web"
LOCAL_IP = local_ip()


# Vom IP-Waechter gesetzt: Adressen haben sich im laufenden Betrieb geaendert.
ADRESSWECHSEL: dict = {"passiert": False, "ips": []}


def adresse_gewechselt(neue_ips: list[str]) -> None:
    ADRESSWECHSEL["passiert"] = True
    ADRESSWECHSEL["ips"] = list(neue_ips)


def join_url() -> str:
    """Beitritts-URL – immer frisch (IP UND Port koennen sich geaendert haben)."""
    return f"http://{LOCAL_IP}:{active_port()}/"

async def _stille_verbindungen_pruefen() -> None:
    """Haelt den Online-Status an den TATSAECHLICHEN Lebenszeichen fest.

    Ein gekapptes Handy merkt die Gegenseite sonst erst nach 30-40 s (TCP/Ping).
    So lange galt der Charakter als 'wird gerade gespielt' - wer das Geraet
    wechselt oder den Speicher geleert hat, kam nicht wieder rein. Das Handy
    schickt alle 4 s ein Lebenszeichen, 15 s Stille sind also eindeutig.

    WICHTIG in beide Richtungen: ein Handy mit dunklem Bildschirm drosselt
    seine Zeitgeber und faellt kurz unter die Grenze. Meldet es sich danach
    auf DERSELBEN Verbindung zurueck, muss es auch wieder als online gelten -
    sonst bliebe es fuer den Rest des Abends faelschlich 'offline' und jemand
    anderes koennte sich seinen Charakter nehmen."""
    while True:
        await asyncio.sleep(5)
        try:
            jetzt = time.monotonic()
            geaendert = False
            for meta in list(hub.sockets.values()):
                pid = meta.get("playerId")
                if not pid:
                    continue
                stille = jetzt - meta.get("letzte", jetzt)
                lebt = stille <= 15
                p = next((x for x in game.players if x["id"] == pid), None)
                if not p or bool(p.get("connected")) == lebt:
                    continue
                p["connected"] = lebt
                geaendert = True
                diag.log(f"{'ZURUECK' if lebt else 'STILL'}: {p.get('name', '?')} "
                         f"(seit {stille:.0f} s ohne Lebenszeichen) -> "
                         f"{'wieder online' if lebt else 'gilt als offline'}")
            if geaendert:
                await hub.broadcast_state()
        except Exception:
            pass


@asynccontextmanager
async def _lebenszyklus(_app: FastAPI):
    """Beweist im Log, dass der Server wirklich lauscht - nicht nur gestartet
    wurde. Fehlt diese Zeile, ist er unterwegs haengen geblieben."""
    diag.log(f"SERVER BEREIT auf Port {active_port()} - wartet auf Verbindungen")
    wache = asyncio.create_task(_stille_verbindungen_pruefen())
    yield
    wache.cancel()
    diag.log("SERVER BEENDET")


app = FastAPI(lifespan=_lebenszyklus)
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
        "isAdmin": winnet.ist_admin(),          # ohne Adminrechte keine Firewall-Regel
        "firewallRuleActive": winnet.rule_active(),
        "addressChanged": ADRESSWECHSEL["passiert"],
    }, headers={
        # Handys pruefen bei Verbindungsverlust ALLE bekannten Adressen des
        # Servers durch (siehe adressFallback in app.js). Dieser Test laeuft
        # ueber eine andere Herkunft - ohne diesen Kopf blockt der Browser ihn.
        "Access-Control-Allow-Origin": "*",
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
        # ZWEI Fassungen: der SL sieht alles, die Spieler bekommen verdeckte
        # Gegner nur als Tarnnamen. Beide einmal bauen statt pro Verbindung.
        fassung = {
            "gm": {"type": "state", "state": game.snapshot()},
            "player": {"type": "state", "state": game.snapshot(fuer_spieler=True)},
        }
        dead = []
        for ws, meta in list(self.sockets.items()):
            try:
                await ws.send_json(fassung.get(meta.get("role"), fassung["player"]))
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
    """Sicherung als Download (nur SL/Laptop): Charaktere + Bibliotheken +
    Begegnungen als Zip MIT allen benutzten Bildern (vorher nur JSON - beim
    Laptop-Wechsel fehlten dann die Bilder)."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    body, bilder = sicherung.baue_zip(game.export_data(), UPLOAD_DIR)
    diag.log(f"Sicherung exportiert: {len(body) / 1024:.0f} KB, {bilder} Bild(er)")
    datum = time.strftime("%Y-%m-%d")
    return Response(content=body, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="sundered-skies-sicherung-{datum}.zip"'})


@app.post("/api/import")
async def import_backup(request: Request, file: UploadFile):
    """Sicherung wiederherstellen (nur SL/Laptop). Ersetzt Charaktere/Bibliotheken."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    raw = await file.read()
    if len(raw) > 500 * 1024 * 1024:     # Zip mit Bildern darf gross sein
        return JSONResponse({"error": "too_large"}, status_code=413)
    try:
        data, bilder = sicherung.lies_sicherung(raw, UPLOAD_DIR)
    except ValueError:
        return JSONResponse({"error": "bad_json"}, status_code=400)
    bericht = game.import_data(data) if isinstance(data, dict) else {"ok": False, "fehler": "Unbekanntes Format."}
    if bericht.get("ok"):
        bericht.setdefault("uebernommen", {})["Bilder"] = bilder
    if bericht.get("ok"):
        await hub.broadcast_state()
    return JSONResponse(bericht)


@app.post("/api/bilder-aufraeumen")
async def bilder_aufraeumen(request: Request):
    """Loescht hochgeladene Bilder, auf die nichts mehr zeigt (nur SL/Laptop).
    Jedes ersetzte Portraet bleibt sonst fuer immer liegen."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    ergebnis = game.bilder_aufraeumen()
    diag.log(f"Bilder aufgeraeumt: {ergebnis['geloescht']} Datei(en), "
             f"{ergebnis['bytes'] / 1024:.0f} KB frei")
    return JSONResponse(ergebnis)


@app.get("/api/bilder-verwaist")
async def bilder_verwaist(request: Request):
    """Wie viele Bilder waeren aufraeumbar? (nur lesen)"""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    verwaist = game.verwaiste_bilder()
    return JSONResponse({
        "anzahl": len(verwaist),
        "bytes": sum(p.stat().st_size for p in verwaist if p.exists()),
    })


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
    # Die TV-/Beamer-Ansicht meldet sich mit ?tv=1. Sie laeuft meist auf dem
    # SL-Laptop, gilt aber als ZUSCHAUER: sie darf nichts steuern und sieht
    # verdeckte Gegner nur mit Tarnnamen - sonst waere das Verdecken sinnlos.
    ist_tv = ws.query_params.get("tv") == "1"
    rolle = "tv" if ist_tv else ("gm" if is_gm else "player")
    meta = {"role": rolle, "playerId": None, "ip": client_ip,
            "seit": time.monotonic(), "letzte": time.monotonic()}
    await hub.add(ws, meta)
    diag.log(f"VERBUNDEN  {meta['role']:6s} ip={client_ip}")

    # Initialen Zustand senden.
    await ws.send_json({"type": "hello", "role": meta["role"]})
    await ws.send_json({"type": "state",
                        "state": game.snapshot(fuer_spieler=meta["role"] != "gm")})

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
        # Wichtig fuers Nachvollziehen: War es ein sauberes Ende (Tab zu) oder ist
        # die Leitung gestorben? Das Handy sendet alle 5 s einen Ping - kam laenger
        # nichts, war das WLAN weg und nicht der Finger auf dem Schliessen-Knopf.
        dauer = time.monotonic() - meta.get("seit", 0)
        stille = time.monotonic() - meta.get("letzte", 0)
        art = "Leitung tot (WLAN?)" if stille > 12 else "sauberes Ende"
        diag.log(f"GETRENNT   {meta['role']:6s} ip={client_ip} ({who}) — {reason} "
                 f"nach {dauer / 60:.1f} min, zuletzt gehoert vor {stille:.0f} s "
                 f"[{art}]")
        if meta.get("playerId"):
            game.set_player_connected(meta["playerId"], False)
            game.save_session()
        await hub.remove(ws)
        await hub.broadcast_state()


async def handle_message(ws: WebSocket, meta: dict, msg: dict) -> None:
    meta["letzte"] = time.monotonic()   # fuer die Diagnose beim Trennen
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
        # Spieler legt sich selbst einen Charakter an (Name aus dem Handy).
        # So kann jemand mitspielen, ohne dass der SL erst etwas eintragen muss.
        if msg.get("neuerCharakter"):
            neu = game.charakter_anlegen(msg["neuerCharakter"])
            if neu is None:
                await ws.send_json({"type": "joinError", "message": "Bitte einen Namen für den Charakter eingeben."})
                return
            diag.log(f"CHARAKTER ANGELEGT (Spieler): {neu['name']}")
            msg = {**msg, "characterId": neu["id"], "name": (msg.get("name") or neu["name"])}

        # Spielt jemand anderes diesen Charakter GERADE? Dann nicht wegnehmen.
        belegt = game.charakter_aktiv_belegt(msg.get("characterId"),
                                             ausser_player_id=msg.get("playerId"))
        if belegt:
            diag.log(f"BEITRITT ABGELEHNT: '{belegt}' wird gerade gespielt "
                     f"(ip={meta.get('ip', '?')})")
            await ws.send_json({
                "type": "joinError",
                # Wichtig: der Server merkt einen Abbruch erst nach ein paar
                # Sekunden (Ping-Zeitfenster). Wer gerade das Gerät gewechselt
                # hat, muss also kurz warten - das gehoert in die Meldung.
                "message": f"„{belegt}“ wird gerade auf einem anderen Gerät gespielt. "
                           f"Warst du das selbst (Gerät gewechselt, Akku leer)? "
                           f"Dann in ein paar Sekunden nochmal versuchen. "
                           f"Sonst anderen Charakter wählen – oder der Spielleiter "
                           f"entfernt das alte Gerät aus dem Kampf.",
            })
            return

        # Spieler tritt bei (aus Charakterliste oder als Gast).
        player = game.register_player(
            name=(msg.get("name") or "Spieler").strip() or "Spieler",
            character_id=msg.get("characterId"),
            existing_player_id=msg.get("playerId"),
        )
        if player is None:
            # Charakter-ID unbekannt - meist ein Rest aus einer frueheren Runde im
            # Handy-Speicher. Das Handy vergisst sie daraufhin und zeigt die
            # Auswahl neu, statt in der Beitrittsschleife haengen zu bleiben.
            diag.log(f"BEITRITT ABGELEHNT: Charakter-ID unbekannt "
                     f"({msg.get('characterId')!r}, ip={meta.get('ip', '?')})")
            await ws.send_json({
                "type": "joinError",
                "grund": "charakter-unbekannt",
                "message": "Diesen Charakter gibt es hier nicht (mehr) – "
                           "vermutlich noch aus einer früheren Runde gespeichert. "
                           "Bitte oben neu auswählen.",
            })
            return
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
                # Handys, die sich schon vor dem Fortsetzen wieder gemeldet haben,
                # stehen in der geladenen Sitzung als „offline" - sie sind aber da.
                for m in list(hub.sockets.values()):
                    if m.get("playerId"):
                        game.set_player_connected(m["playerId"], True)
            elif atype == "discard_session":
                game.discard_saved_session()
            else:
                game.apply(action)
            await hub.broadcast_state()
            return

        # Wartet noch eine gespeicherte Sitzung auf „Fortsetzen?", zählen
        # Spieler-Aktionen nicht: sie träfen nur den vorläufigen Neustart-Stand
        # und würden (als erste Aktion) die Fortsetzen-Möglichkeit wegwerfen.
        if game.resume_available:
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
        elif atype == "sheet_update":
            # Charakterbogen: NUR der eigene (die ID kommt vom Server, nicht vom Handy).
            game.apply({"type": "sheet_update", "id": own["id"], "bogen": action.get("bogen")})
            await hub.broadcast_state()
        elif atype == "talents_update":
            # Eigene Initiative-Talente - wieder NUR die eigene Figur.
            game.apply({"type": "talents_update", "id": own["id"], "talents": action.get("talents"),
                        "gluck": action.get("gluck"), "grosses_gluck": action.get("grosses_gluck")})
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
