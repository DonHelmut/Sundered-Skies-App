"""FastAPI-Server: statische Auslieferung, WebSocket-Sync, Bild-Upload.

Rollen-Erkennung ohne Login: Nur Anfragen vom Laptop selbst (Loopback,
127.0.0.1/::1) gelten als Spielleiter. Handys verbinden sich über die
LAN-IP und sind damit automatisch Spieler – sie können nicht SL werden.
"""

from __future__ import annotations

import asyncio
import copy
import io
from contextlib import asynccontextmanager
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import qrcode
from fastapi import FastAPI, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .game import Game, UPLOAD_DIR, DATA_DIR, TALENTS
from .paths import RESOURCE_DIR, HOSTNAME, APP_VERSION, local_ip, all_lan_ips, active_port
from . import diag
from . import winnet
from . import sicherung
from . import kampf_import
from .aufnahme import Aufnahmen, MAX_TRANSKRIPT
from .sprache import Sprache
from .namen import namen_aus_spiel

WEB_DIR = RESOURCE_DIR / "web"
SICHERUNG_DIR = DATA_DIR / "sicherungen"   # automatische Sicherungen (stündlich)
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
            # Pro SPIELER die frischeste Leitung zaehlen: nach einem Neuverbinden
            # haengt die alte, tote Leitung oft noch eine Weile mit derselben ID
            # da. Einzeln betrachtet kippte der Status sonst alle 5 s hin und her.
            letzte: dict = {}
            for meta in list(hub.sockets.values()):
                pid = meta.get("playerId")
                if pid:
                    letzte[pid] = max(letzte.get(pid, 0), meta.get("letzte", jetzt))
            for pid, zuletzt in letzte.items():
                stille = jetzt - zuletzt
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


SICHERUNG_ERSTE = 60          # s nach dem Start (der Start selbst soll flott sein)
SICHERUNG_ABSTAND = 3600     # dann etwa stündlich


async def _auto_sicherung() -> None:
    """Still im Hintergrund sichern (siehe sicherung.auto_sichern). Darf das
    Spiel nie aufhalten: Zip bauen läuft neben dem Event-Loop."""
    await asyncio.sleep(SICHERUNG_ERSTE)
    while True:
        try:
            # Kopie HIER im Event-Loop ziehen: export_data verweist auf die
            # lebenden Listen. Der Nebenfaden packte sonst, während ein Handy
            # gerade Notizen oder Bogen speichert - halbe Stände in der Zip
            # oder „dictionary changed size during iteration" (Prüfung 05.11.).
            daten = copy.deepcopy(game.export_data())
            pfad = await asyncio.get_event_loop().run_in_executor(
                None, sicherung.auto_sichern, daten, UPLOAD_DIR, SICHERUNG_DIR)
            if pfad:
                diag.log(f"AUTO-SICHERUNG: {pfad.name}")
        except Exception as e:  # noqa: BLE001
            diag.log(f"AUTO-SICHERUNG fehlgeschlagen: {e!r}")
        await asyncio.sleep(SICHERUNG_ABSTAND)


@asynccontextmanager
async def _lebenszyklus(_app: FastAPI):
    """Beweist im Log, dass der Server wirklich lauscht - nicht nur gestartet
    wurde. Fehlt diese Zeile, ist er unterwegs haengen geblieben."""
    diag.log(f"SERVER BEREIT auf Port {active_port()} - wartet auf Verbindungen")
    wache = asyncio.create_task(_stille_verbindungen_pruefen())
    sichern = asyncio.create_task(_auto_sicherung())
    # Eigener Thread: der erste sherpa-Import dauert eine halbe Sekunde.
    threading.Thread(target=sprache.genauer_nachholen, daemon=True, name="genauer").start()
    yield
    wache.cancel()
    sichern.cancel()
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


def _port_von(request: Request) -> int:
    """Der Port, über den die Anfrage WIRKLICH kam. Wird der Server nicht über
    server.run gestartet (z. B. Testserver direkt mit uvicorn auf 8765), kennt
    active_port() nur den Wunsch-Port 8000 - QR-Code und Adresse zeigten dann
    ins Leere."""
    return request.url.port or active_port()


@app.get("/api/info")
async def api_info(request: Request):
    """Beitritts-Info (IP/URL) – bei JEDEM Aufruf frisch, damit ein WLAN-Wechsel
    ohne Neustart auffällt. Liefert ALLE Kandidaten-IPs (falls eine nicht geht)."""
    port = _port_von(request)
    ips = all_lan_ips()
    primary = ips[0] if ips else LOCAL_IP
    # netsh startet einen Prozess - nicht im Event-Loop warten (kurz gepuffert).
    wlan = await asyncio.get_event_loop().run_in_executor(None, winnet.wlan_info)
    return JSONResponse({
        "ip": primary, "port": port,
        "url": f"http://{primary}:{port}/",
        "ips": ips,
        "urls": [f"http://{ip}:{port}/" for ip in ips],
        "prettyUrl": f"http://{HOSTNAME}.local:{port}/",
        "version": APP_VERSION,
        "networkPublic": winnet.is_public(),   # True = WLAN „öffentlich" (Firewall blockt)
        "isWindows": os.name == "nt",
        "isAdmin": winnet.ist_admin(),          # ohne Adminrechte keine Firewall-Regel
        "firewallRuleActive": winnet.rule_active(),
        "addressChanged": ADRESSWECHSEL["passiert"],
        "wlan": wlan,   # Netz, Band, Wi-Fi-Standard des Laptops (None = kein WLAN)
    }, headers={
        # Handys pruefen bei Verbindungsverlust ALLE bekannten Adressen des
        # Servers durch (siehe adressFallback in app.js). Dieser Test laeuft
        # ueber eine andere Herkunft - ohne diesen Kopf blockt der Browser ihn.
        "Access-Control-Allow-Origin": "*",
    })


@app.get("/qr.png")
async def qr_png(request: Request):
    """QR-Code zur Beitritts-URL – bei jedem Aufruf frisch aus der AKTUELLEN
    LAN-IP (überlebt so einen WLAN-Wechsel ohne Neustart)."""
    ips = all_lan_ips()
    url = f"http://{ips[0]}:{_port_von(request)}/" if ips else join_url()
    buf = io.BytesIO()
    qrcode.make(url).save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


_LOKAL = ("127.0.0.1", "::1", "localhost")


def _is_loopback(request_or_ws) -> bool:
    client = getattr(request_or_ws, "client", None)
    host = client.host if client else None
    if host not in _LOKAL:
        return False
    # Kommt die Anfrage zwar vom Laptop, aber aus einer FREMDEN Webseite (der
    # Browser setzt dann Origin auf deren Adresse), ist das nicht der SL: jede
    # Seite, die der SL nebenbei offen hat, hätte sonst per Formular oder
    # WebSocket an localhost:8000 Sicherungen einspielen, Aufnahmen löschen
    # oder den Kampf steuern können (Prüfung 05.11.2026). Eigene Seiten
    # schicken localhost/127.0.0.1 oder gar keinen Origin.
    origin = (getattr(request_or_ws, "headers", None) or {}).get("origin")
    if origin:
        try:
            herkunft = urlsplit(origin).hostname
        except ValueError:
            return False
        return herkunft in _LOKAL
    return True


def _player_name(pid):
    if not pid:
        return None
    p = next((x for x in game.players if x.get("id") == pid), None)
    return p.get("name") if p else None


# So lange darf ein einzelnes Handy beim Verteilen des Spielstands brauchen.
SENDE_FRIST = 3.0


async def _leise_schliessen(ws: WebSocket) -> None:
    try:
        await asyncio.wait_for(ws.close(), 5)
    except Exception:
        pass


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

    @staticmethod
    async def _senden(ws: WebSocket, daten: dict) -> bool:
        try:
            await asyncio.wait_for(ws.send_json(daten), SENDE_FRIST)
            return True
        except Exception:
            return False

    async def broadcast_state(self) -> None:
        # Läuft eine Aufnahme, Kampfbeginn/-ende mitschreiben. Hier, weil jede
        # Änderung am Spiel hier vorbeikommt. Darf das Spiel nie aufhalten.
        try:
            aufnahmen.beobachten(game)
        except Exception as e:  # noqa: BLE001
            diag.log(f"AUFNAHME: Mitschreiben fehlgeschlagen: {e!r}")
        # ZWEI Fassungen: der SL sieht alles, die Spieler bekommen verdeckte
        # Gegner nur als Tarnnamen. Beide einmal bauen statt pro Verbindung.
        fassung = {
            "gm": {"type": "state", "state": game.snapshot()},
            "player": {"type": "state", "state": game.snapshot(fuer_spieler=True)},
        }
        # An alle GLEICHZEITIG und mit Frist. Vorher nacheinander und ohne:
        # ein Handy, das nichts mehr annimmt (WLAN weg, Leitung aber noch
        # nicht tot), liess den Sendepuffer volllaufen, und ab da hing JEDES
        # Senden an diesem einen Handy - der ganze Tisch stand still, bis die
        # Leitung nach Minuten endgueltig starb (im Test: ueber 2 Minuten).
        # Geflüstertes (SL an EINEN Spieler) darf nur auf dessen Handy landen -
        # deshalb bekommt jedes Handy seine eigene Nachrichtenliste. Der Rest der
        # Spieler-Fassung bleibt geteilt (nur flache Kopie mit anderer Liste).
        def fuer(meta: dict) -> dict:
            if meta.get("role") == "gm":
                return fassung["gm"]
            pid = meta.get("playerId")
            return {"type": "state",
                    "state": {**fassung["player"]["state"], "messages": game.nachrichten_fuer(pid),
                              "meineNotizen": game.notizen_fuer(pid)}}
        ziele = list(self.sockets.items())
        ok = await asyncio.gather(*(self._senden(ws, fuer(meta)) for ws, meta in ziele))
        for (ws, meta), gesendet in zip(ziele, ok):
            if not gesendet:
                await self.rauswerfen(ws, meta)

    async def rauswerfen(self, ws: WebSocket, meta: dict) -> None:
        """Leitung, die nichts mehr annimmt, aufgeben. Das Handy verbindet sich
        von selbst neu, sobald es wieder da ist."""
        if ws not in self.sockets:
            return
        await self.remove(ws)
        diag.log(f"RAUSGEWORFEN {meta.get('role', '?')} ip={meta.get('ip', '?')} "
                 f"({_player_name(meta.get('playerId')) or '-'}): nimmt nichts mehr an")
        pid = meta.get("playerId")
        if pid and not any(m.get("playerId") == pid for m in list(self.sockets.values())):
            game.set_player_connected(pid, False)
        # Schliessen kann selbst an der vollen Leitung haengen - nicht warten.
        asyncio.ensure_future(_leise_schliessen(ws))


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


@app.post("/api/kampf-import/vorschau")
async def kampf_import_vorschau(request: Request):
    """Was steht im eingefügten Kampf-Text? (nur SL, nur lesen) - der Dialog
    zeigt es beim Tippen an, gespeichert wird erst per encounter_import."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        daten = await request.json()
    except ValueError:
        return JSONResponse({"error": "bad_json"}, status_code=400)
    text = daten.get("text") if isinstance(daten, dict) else ""
    return JSONResponse(game.kampf_import_vorschau(str(text or "")))


@app.get("/api/kampf-import/anleitung")
async def kampf_import_anleitung(request: Request):
    """Die Anleitung für die KI (Gemini & Co.) - Talente aus der App."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    return JSONResponse({"text": kampf_import.anleitung(TALENTS)})


@app.get("/api/sicherungen")
async def sicherungen_liste(request: Request):
    """Automatische Sicherungen (nur SL/Laptop), neueste zuerst."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    return JSONResponse({"liste": sicherung.auto_liste(SICHERUNG_DIR)})


@app.post("/api/sicherungen/zurueck/{name}")
async def sicherung_zurueckholen(request: Request, name: str):
    """Eine automatische Sicherung einspielen. Vorher wird der JETZIGE Stand
    selbst gesichert - wer die falsche erwischt, kommt so wieder zurück."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    pfad = SICHERUNG_DIR / name
    if not sicherung.AUTO_NAME.match(name) or not pfad.is_file():
        return JSONResponse({"error": "nicht_da"}, status_code=404)
    try:
        roh = pfad.read_bytes()
        data, bilder = sicherung.lies_sicherung(roh, UPLOAD_DIR)
    except (OSError, ValueError):
        return JSONResponse({"error": "kaputt"}, status_code=400)
    # Vorher-Stand sichern, aber ohne die Sicherung, die gerade zurückkommt,
    # aus der Liste zu schieben (darum einen Platz mehr behalten).
    sicherung.auto_sichern(game.export_data(), UPLOAD_DIR, SICHERUNG_DIR, immer=True,
                           behalten=sicherung.AUTO_BEHALTEN + 1)
    bericht = game.import_data(data) if isinstance(data, dict) else {"ok": False, "fehler": "Unbekanntes Format."}
    if bericht.get("ok"):
        bericht.setdefault("uebernommen", {})["Bilder"] = bilder
        diag.log(f"AUTO-SICHERUNG zurueckgeholt: {name}")
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


# --- Spielabend-Protokolle -----------------------------------------------------
# Im Zustand stehen nur Titel/Stand; den Text holt jedes Gerät hier einzeln.
# Handys bekommen nur Freigegebenes, der Laptop (SL) alles.

@app.get("/api/protokoll/{pid}")
async def protokoll_lesen(request: Request, pid: str):
    p = game.protokoll_text(pid, fuer_spieler=not _is_loopback(request))
    if p is None:
        return JSONResponse({"error": "nicht_da"}, status_code=404)
    return JSONResponse(p, headers={"Cache-Control": "no-store"})


@app.get("/api/notiz-namen")
async def notiz_namen(request: Request):
    """Namen für die Vorschläge beim Notiz-Tippen (einmal je Handy geholt -
    im Zustand gingen sie sonst bei jedem Update mit)."""
    return JSONResponse(game.namen_fuer_notizen(fuer_spieler=not _is_loopback(request)),
                        headers={"Cache-Control": "no-store"})


# --- Spielabend aufnehmen (nur SL/Laptop) -------------------------------------
# Der Browser des Laptops nimmt auf und schickt Stücke, siehe server/aufnahme.py.

aufnahmen = Aufnahmen(DATA_DIR / "aufnahmen")
# Modelle in data/: das Aktualisieren tauscht nur die Programmdateien.
sprache = Sprache(DATA_DIR / "modelle", aufnahmen)
# Eigennamen fürs Verbessern der Mitschrift (server/namen.py) und wie viele
# Leute am Tisch sitzen (Spieler-Figuren mit verschiedenen Spielern + SL).
sprache.namen_quelle = lambda: namen_aus_spiel(game)
aufnahmen.begriffe_quelle = sprache.begriffe
aufnahmen.vorgeschichte_quelle = game.protokoll_vorher


def _leute_am_tisch() -> int:
    leute = {str(c.get("playerName") or c.get("name") or "").strip().lower()
             for c in game.combatants if c.get("kind") == "player" and not c.get("benched")}
    leute.discard("")
    return len(leute) + 1 if leute else 0


sprache.personen_quelle = _leute_am_tisch


@app.get("/api/aufnahme")
async def aufnahme_status(request: Request):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    return JSONResponse({**aufnahmen.status(), "sprache": sprache.status()})


@app.post("/api/aufnahme/start")
async def aufnahme_start(request: Request):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        body = await request.json()
    except ValueError:
        body = {}
    alt = aufnahmen.aktiv["name"] if aufnahmen.aktiv else None
    meta = aufnahmen.starten(str((body or {}).get("mime") or ""), game)
    if alt:
        # Unterbrochene Aufnahme (Seite neu geladen): ihr Teil wird nach dem
        # Ende der neuen genau transkribiert.
        sprache.nach_aufnahme(alt)
    diag.log(f"AUFNAHME gestartet: {meta['name']}{meta['endung']}")
    sprache.aufnahme_laeuft()
    return JSONResponse({"name": meta["name"]})


@app.post("/api/aufnahme/stueck")
async def aufnahme_stueck(request: Request, name: str = ""):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    daten = await request.body()
    if not aufnahmen.stueck(name, daten):
        # 409: Browser nimmt für eine Aufnahme auf, die der Server nicht (mehr)
        # führt (Server neu gestartet) -> er startet eine neue.
        return JSONResponse({"error": "nicht_aktiv"}, status_code=409)
    return JSONResponse({"ok": True})


@app.post("/api/aufnahme/stop")
async def aufnahme_stop(request: Request):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    meta = aufnahmen.stoppen(game)
    if meta:
        diag.log(f"AUFNAHME beendet: {meta['name']} ({meta['dauerMs'] // 60000} min)")
        sprache.nach_aufnahme(meta["name"])
    return JSONResponse({**aufnahmen.status(), "sprache": sprache.status()})


@app.post("/api/aufnahme/marke")
async def aufnahme_marke(request: Request):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        body = await request.json()
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    if body.get("nachtragen"):
        return JSONResponse({"ok": aufnahmen.marke_text(str(body.get("text") or ""))})
    return JSONResponse({"ok": aufnahmen.marke(str(body.get("text") or ""))})


@app.post("/api/aufnahme/stimme")
async def aufnahme_stimme(request: Request):
    """Stimm-Anmeldung: „jetzt spricht Korgo" (siehe Aufnahmen.stimme)."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        body = await request.json()
    except ValueError:
        body = {}
    ok = aufnahmen.stimme(str((body or {}).get("figur") or ""))
    return JSONResponse({"ok": ok, **aufnahmen.status()})


@app.get("/api/aufnahme/live")
async def aufnahme_live_lesen(request: Request, ab: int = 0):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    return JSONResponse(aufnahmen.live_ab(ab))


@app.post("/api/aufnahme/prompt-aus/{name}")
async def aufnahme_prompt_aus(request: Request, name: str, quelle: str = "genau", extra: str = ""):
    """Prompt aus dem gespeicherten Transkript (genau) oder der Live-Mitschrift."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    prompt = aufnahmen.prompt_aus(name, quelle, extra)
    if prompt is None:
        return JSONResponse({"error": "leer"}, status_code=400)
    return JSONResponse({"prompt": prompt})


# Spracherkennung (server/sprache.py): Modelle laden, live an/aus, genau.

@app.post("/api/sprache/modelle")
async def sprache_modelle(request: Request):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    sprache.modelle_holen()
    return JSONResponse(sprache.status())


@app.post("/api/sprache/einstellen")
async def sprache_einstellen(request: Request):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        body = await request.json()
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    try:
        personen = int(body["personen"]) if "personen" in body else None
    except (TypeError, ValueError):
        personen = None
    begriffe = body.get("begriffe") if isinstance(body.get("begriffe"), str) else None
    if begriffe is not None and len(begriffe) > 20000:
        return JSONResponse({"error": "too_large"}, status_code=413)
    sprache.einstellen(live=body.get("live") if isinstance(body.get("live"), bool) else None,
                       personen=personen, begriffe=begriffe)
    return JSONResponse(sprache.status())


@app.get("/api/aufnahme/sprecher/{name}")
async def aufnahme_sprecher(request: Request, name: str, quelle: str = "genau"):
    """„Wer ist wer?": Sprecher mit Beispielsätzen und bisheriger Zuordnung."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    erg = aufnahmen.sprecher(name, quelle)
    if erg is None:
        return JSONResponse({"error": "leer"}, status_code=404)
    return JSONResponse(erg)


@app.post("/api/aufnahme/sprecher/{name}")
async def aufnahme_sprecher_benennen(request: Request, name: str, quelle: str = "genau"):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        body = await request.json()
    except ValueError:
        body = {}
    ok = aufnahmen.sprecher_benennen(name, quelle, (body or {}).get("namen") if isinstance(body, dict) else None)
    return JSONResponse({"ok": ok}, status_code=200 if ok else 400)


@app.post("/api/sprache/genau/{name}")
async def sprache_genau(request: Request, name: str):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if sprache.genau(name):
        diag.log(f"TRANSKRIPTION gestartet: {name}")
    return JSONResponse(sprache.status())


@app.post("/api/sprache/abbrechen")
async def sprache_abbrechen(request: Request):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    sprache.genau_abbrechen()
    return JSONResponse(sprache.status())


@app.get("/api/aufnahme/datei/{name}")
async def aufnahme_datei(request: Request, name: str):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    pfad = aufnahmen.audio_pfad(name)
    if not pfad:
        return Response(status_code=404)
    return FileResponse(pfad, filename=f"spielabend-{pfad.name}")


@app.post("/api/aufnahme/prompt/{name}")
async def aufnahme_prompt(request: Request, name: str, file: UploadFile, extra: str = ""):
    """Transkript (aus noScribe) rein, fertiger Claude-Prompt raus."""
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    roh = await file.read()
    if len(roh) > MAX_TRANSKRIPT:
        return JSONResponse({"error": "too_large"}, status_code=413)
    text = roh.decode("utf-8", errors="replace")
    prompt = aufnahmen.prompt(name, text, extra)
    if prompt is None:
        return JSONResponse({"error": "leer"}, status_code=400)
    return JSONResponse({"prompt": prompt})


@app.post("/api/aufnahme/loeschen/{name}")
async def aufnahme_loeschen(request: Request, name: str):
    if not _is_loopback(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    ok = aufnahmen.loeschen(name)
    if ok:
        diag.log(f"AUFNAHME gelöscht: {name}")
    return JSONResponse({"ok": ok})


# So heißen hochgeladene Bilder (siehe /api/upload). Alles andere gibt es hier
# nicht: vorher prüfte die Route nur auf „..". Unter Windows hängt pathlib aber
# einen absoluten Namen nicht an, sondern ERSETZT den Pfad - jedes Handy im WLAN
# konnte mit /uploads/C:%5CUsers%5C… beliebige Dateien des Laptops lesen
# (Prüfung 05.11.2026).
UPLOAD_NAME = re.compile(r"^[0-9A-Za-z_-]{1,80}\.(png|jpg|jpeg|gif|webp)$", re.IGNORECASE)


@app.get("/uploads/{name}")
async def serve_upload(name: str):
    if not UPLOAD_NAME.match(name):
        return Response(status_code=404)
    path = UPLOAD_DIR / name
    if not path.is_file():
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
    # Version mitschicken: offene Tabs mit altem Code (nach einem Update) laden
    # sich daran selbst neu, statt mit veralteter Logik weiterzulaufen.
    await ws.send_json({"type": "hello", "role": meta["role"], "version": APP_VERSION})
    await ws.send_json({"type": "state",
                        "state": game.snapshot(fuer_spieler=meta["role"] != "gm",
                                               player_id=meta.get("playerId"))})

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
        await hub.remove(ws)
        # Nur offline, wenn KEINE andere Leitung dieses Spielers mehr da ist:
        # das Handy hat sich oft schon neu verbunden, bevor die alte Leitung
        # hier endgueltig stirbt - sonst stand es beim SL faelschlich „offline"
        # und sein Charakter war fuer andere Geraete frei.
        pid = meta.get("playerId")
        if pid and not any(m.get("playerId") == pid for m in list(hub.sockets.values())):
            game.set_player_connected(pid, False)
            game.save_session()
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
        # Fremde Spieler-ID ohne den passenden Geräte-Schlüssel: nicht dieses
        # Gerät (siehe Game.schluessel_passt). Still beitreten geht dann nicht,
        # ein Beitritt per Tipp läuft wie bei einem neuen Gerät - mit dem
        # Charakter wie gewohnt, solange der nicht gerade gespielt wird.
        if not game.schluessel_passt(msg.get("playerId"), msg.get("schluessel")):
            diag.log(f"SCHLUESSEL passt nicht: {str(msg.get('name') or '?')[:40]!r} "
                     f"(ip={meta.get('ip', '?')}) - als neues Gerät behandelt")
            if msg.get("auto"):
                await ws.send_json({"type": "joinError", "grund": "unbekannt", "message": ""})
                return
            msg = {**msg, "playerId": None, "schluessel": None}
        # Stilles Wiederbeitreten (Handy verbindet sich neu, ohne dass jemand
        # etwas angetippt hat) nur für Geräte, die dieser Server kennt. Sonst
        # tauchten Browser mit gemerkter ID aus alten Installationen ungefragt
        # als Gast auf. Das Handy vergisst die alte ID und zeigt die Beitrittsseite.
        if msg.get("auto") and not game.spieler_bekannt(msg.get("playerId")):
            diag.log(f"AUTO-BEITRITT verworfen: unbekanntes Gerät "
                     f"({str(msg.get('name') or '?')[:40]!r}, ip={meta.get('ip', '?')})")
            await ws.send_json({"type": "joinError", "grund": "unbekannt", "message": ""})
            return
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

        # Ohne Charakter kein Beitritt (kein „Gast", der dann als Figur überall
        # mitspielt). Ausnahme: das Gerät hat schon eine Figur im Kampf.
        if not msg.get("characterId") and not game.hat_eigene_figur(msg.get("playerId")):
            diag.log(f"BEITRITT ABGELEHNT: ohne Charakter "
                     f"({str(msg.get('name') or '?')[:40]!r}, ip={meta.get('ip', '?')})")
            await ws.send_json({
                "type": "joinError",
                "grund": "ohne-charakter",
                # Beim stillen Wiederbeitreten keine Meldung - das Handy zeigt
                # einfach die Charakterwahl, niemand hat etwas falsch gemacht.
                "message": "" if msg.get("auto") else "Bitte einen Charakter wählen oder neu erstellen.",
            })
            return

        # Spieler tritt mit seinem Charakter bei (aus der Liste oder neu angelegt).
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
        schluessel = game.schluessel_fuer(player, msg.get("schluessel"))
        diag.log(f"BEIGETRETEN  {player.get('name', '?')} (ip={meta.get('ip', '?')})")
        game.save_session()
        await ws.send_json({"type": "joined", "playerId": player["id"], "schluessel": schluessel})
        await hub.broadcast_state()
        return

    if mtype == "leave":
        # Spieler verlässt bewusst: eigenen Teilnehmer + Spielereintrag entfernen.
        pid = meta.get("playerId")
        own = next((c for c in game.combatants if c.get("playerId") == pid), None) if pid else None
        if own and game.resume_available:
            # Wartet „Fortsetzen?" noch, wäre remove_combatant die „erste
            # Aktion" und hätte die gespeicherte Sitzung verworfen - ein Handy,
            # das nach dem Neustart „Verlassen" tippt, kostete den ganzen Kampf.
            # Nur den vorläufigen Eintrag lösen; im gespeicherten Kampf steht
            # die Figur nach dem Fortsetzen wie bei einem Gerät, das weg ist.
            diag.log(f"VERLASSEN    {own.get('name', '?')} (vor dem Fortsetzen)")
            game.combatants = [c for c in game.combatants if c.get("playerId") != pid]
            game.set_player_connected(pid, False)
        elif own:
            diag.log(f"VERLASSEN    {own.get('name', '?')} (ip={meta.get('ip', '?')})")
            game.apply({"type": "remove_combatant", "id": own["id"]})
        elif pid:
            # Ohne Figur blieb der Eintrag sonst für immer „verbunden" stehen.
            game.set_player_connected(pid, False)
        meta["playerId"] = None
        await hub.broadcast_state()
        return

    if mtype == "gm_action":
        action = msg.get("action") or {}
        if not isinstance(action, dict):
            return
        atype = action.get("type")

        if meta["role"] == "gm":
            # Der Laptop hat volle Kontrolle.
            if atype == "resume_session":
                if not game.resume_session():
                    diag.log("FORTSETZEN gescheitert: gespeicherte Sitzung unlesbar - frischer Kampf")
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

        # Spieler dürfen nur eng begrenzte Aktionen für den eigenen Charakter.
        pid = meta.get("playerId")
        # Ohne Beitritt (Beitrittsseite, nach „Verlassen") gehört dem Handy
        # nichts. Vorher passte playerId None auf jede Figur OHNE Handy - Gegner
        # und vom SL eingesetzte Charaktere: so ein Handy konnte deren Zug
        # beenden, Karte aufdecken, Zone ändern und als „Ork" Gruppen-Notizen
        # schreiben (Komplett-Test 04.11.2026).
        if not pid:
            return
        own = next((c for c in game.combatants if c.get("playerId") == pid), None)
        if not own:
            return
        # Notizen hängen am Charakter bzw. in gruppen_notizen.json, nicht am
        # Kampf - sie gehen deshalb auch, solange „Fortsetzen?" noch offen ist.
        # Vorher wurden sie dann still verworfen: die 👥 Notiz tauchte nirgends
        # auf, die eigene stand nur scheinbar da (Handy-Fassung) und war nach
        # dem Neuladen weg (Kalle, 04.11.2026: „Notizen für alle … sehe keine").
        if atype == "notizen_setzen":
            # Eigene Notizen - nur am eigenen Charakter, nur dieses Handy sieht sie.
            # "eintraege" seit 1.5.36; "text" = altes Handy mit Freitext-Feld.
            neu = action.get("eintraege") if "eintraege" in action else action.get("text")
            if game.notizen_setzen(own["id"], neu):
                await hub.broadcast_state()
            return
        if atype == "gruppen_notiz":
            # 👥 Notiz für alle Spieler - Schreiber ist immer der eigene Charakter.
            if game.gruppen_notiz(own["id"], action):
                await hub.broadcast_state()
            return
        # Wartet noch eine gespeicherte Sitzung auf „Fortsetzen?", zählen die
        # übrigen Spieler-Aktionen nicht: sie träfen nur den vorläufigen
        # Neustart-Stand und würden (als erste Aktion) die Fortsetzen-
        # Möglichkeit wegwerfen.
        if game.resume_available:
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
        elif atype == "set_figur_rueckseite":
            # Kartenrückseite NUR der eigenen Figur (Standard/Profil/eigenes Bild).
            game.apply({"type": "set_figur_rueckseite", "id": own["id"], "wert": action.get("wert")})
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
        elif atype == "timer_halt":
            # Spieler hat „Angreifen" getippt: eigene Uhr anhalten (nur wenn dran).
            game.apply({"type": "timer_halt", "id": own["id"]})
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
