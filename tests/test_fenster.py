"""App-Fenster + Symbol neben der Uhr (server/fenster.py, seit 2.0.6).

Echte Fenster gibt es im Test nicht - geprüft wird, welcher Browser gewählt
wird und dass die .exe ohne Konsole nicht an uvicorn scheitert."""
import io
import sys
from pathlib import Path

from server import fenster


UMG = {"ProgramFiles": r"C:\PF", "ProgramFiles(x86)": r"C:\PF86", "LOCALAPPDATA": r"C:\LAD"}
CHROME = Path(r"C:\PF") / "Google" / "Chrome" / "Application" / "chrome.exe"
EDGE = Path(r"C:\PF86") / "Microsoft" / "Edge" / "Application" / "msedge.exe"


def test_standardbrowser_chrome_zuerst():
    # Dort liegt schon die Mikrofon-Freigabe für localhost.
    gibt = {CHROME, EDGE}
    assert fenster.browser_finden("ChromeHTML", UMG, gibt.__contains__) == CHROME


def test_sonst_edge_zuerst():
    gibt = {CHROME, EDGE}
    assert fenster.browser_finden("FirefoxURL-123", UMG, gibt.__contains__) == EDGE
    assert fenster.browser_finden("", UMG, gibt.__contains__) == EDGE


def test_rueckfall_auf_den_anderen_browser():
    assert fenster.browser_finden("ChromeHTML", UMG, {EDGE}.__contains__) == EDGE
    assert fenster.browser_finden("MSEdgeHTM", UMG, {CHROME}.__contains__) == CHROME


def test_kein_browser_gefunden():
    assert fenster.browser_finden("ChromeHTML", UMG, lambda p: False) is None


def test_ohne_konsole_wird_umgeleitet(monkeypatch):
    # uvicorn fragt sys.stdout.isatty() - mit None stürzte die .exe sofort ab.
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    fenster.ausgaben_umleiten()
    assert sys.stdout is not None and sys.stderr is not None
    # Nur aufrufbar muss es sein (Windows meldet „nul" als Gerät → True).
    sys.stdout.isatty()
    print("geht ins Leere")


def test_mit_konsole_bleibt_alles(monkeypatch):
    puffer = io.StringIO()
    monkeypatch.setattr(sys, "stdout", puffer)
    fenster.ausgaben_umleiten()
    assert sys.stdout is puffer


def test_starthinweise_nur_fuer_den_sl():
    # Ohne TestClient (braucht httpx, fehlt in CI): Anfrage von Hand bauen.
    import asyncio
    import json
    from starlette.requests import Request
    from server import app as app_modul

    def info(ip):
        anfrage = Request({"type": "http", "method": "GET", "path": "/api/info",
                           "headers": [(b"host", b"localhost:8000")], "query_string": b"",
                           "client": (ip, 5555), "server": ("x", 8000), "scheme": "http"})
        return json.loads(asyncio.run(app_modul.api_info(anfrage)).body)

    app_modul.START_HINWEISE[:] = ["⚠ Die App liegt in OneDrive."]
    try:
        assert info("192.168.1.50")["startHinweise"] == []          # Handy
        assert info("127.0.0.1")["startHinweise"] == ["⚠ Die App liegt in OneDrive."]  # SL
    finally:
        app_modul.START_HINWEISE.clear()


def test_symbol_und_manifest_liegen_bei():
    web = Path(__file__).resolve().parents[1] / "web"
    for name in ("icon.svg", "icon-64.png", "icon-192.png", "icon-512.png",
                 "apple-touch-icon.png", "app.ico", "manifest.json", "beitritt.html"):
        assert (web / "static" / name).is_file(), name
    kopf = (web / "index.html").read_text(encoding="utf-8")
    assert 'rel="manifest"' in kopf and "apple-touch-icon" in kopf
