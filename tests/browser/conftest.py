"""Browser-Tests: echte App im echten Browser, SL-Laptop + Handys.

Laufen nur, wenn Playwright da ist (sonst still übersprungen - fürs normale
Entwickeln reicht ``pytest`` wie bisher):

    .venv\\Scripts\\python -m pip install playwright
    .venv\\Scripts\\python -m playwright install chromium
    .venv\\Scripts\\python -m pytest tests/browser

Jeder Test bekommt einen eigenen Server mit leerem Datenordner (echter
Prozess, echter Port) - so stört kein Test den nächsten und nie den echten
Spielstand in data/. Der SL ist ein Browser über 127.0.0.1, Handys sind
Browser mit Handy-Größe und dem Test-Cookie (siehe testserver.py).

Jede Seite sammelt JavaScript-Fehler. Gab es welche, schlägt der Test am Ende
fehl - auch wenn die eigentliche Prüfung durchging. Genau das fanden die
Handtests sonst nie: ein Fehler im Hintergrund, der erst beim dritten Knopf
etwas kaputt macht.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

try:
    from playwright import sync_api
except ImportError:          # normales Entwickeln: Browser-Tests still weglassen
    sync_api = None
    collect_ignore_glob = ["test_*.py"]

WURZEL = Path(__file__).resolve().parents[2]

# Handy-Größen (CSS-Pixel): kleines altes Android, iPhone SE, iPhone 14,
# großes Android, Tablet hochkant.
HANDYS = {
    "klein": {"width": 320, "height": 568},
    "se": {"width": 375, "height": 667},
    "iphone": {"width": 390, "height": 844},
    "gross": {"width": 412, "height": 915},
    "tablet": {"width": 768, "height": 1024},
}


def _freier_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _chromium_pfad():
    """Eigener Chromium, falls gesetzt (SWI_CHROMIUM) - sonst der von
    ``playwright install``. In der Cloud-Umgebung liegt einer fest bereit."""
    pfad = os.environ.get("SWI_CHROMIUM")
    if pfad:
        return pfad
    vorrat = Path("/opt/pw-browsers/chromium")
    return str(vorrat) if vorrat.exists() else None


# Pro Datei statt pro Lauf: Playwright hält eine eigene Ereignisschleife offen,
# solange es läuft - danach kommende Server-Tests mit asyncio.run() schlugen
# dann mit „cannot be called from a running event loop" fehl.
@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch(executable_path=_chromium_pfad())
        except Exception as e:  # noqa: BLE001
            pytest.skip(f"Kein Chromium für Playwright ({e.__class__.__name__}) - "
                        f"`python -m playwright install chromium`")
        yield b
        b.close()


class Server:
    """Ein echter App-Prozess mit eigenem Datenordner."""

    def __init__(self, daten: Path):
        self.daten = daten
        self.port = _freier_port()
        self.url = f"http://127.0.0.1:{self.port}/"
        self.proc = None

    def start(self):
        env = {**os.environ, "SWI_DATA_DIR": str(self.daten), "PYTHONUTF8": "1"}
        self.log = open(self.daten.parent / f"server-{self.port}.log", "ab")
        self.proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name("testserver.py")), str(self.port)],
            cwd=str(WURZEL), env=env, stdout=self.log, stderr=subprocess.STDOUT)
        frist = time.monotonic() + 30
        while time.monotonic() < frist:
            try:
                urllib.request.urlopen(self.url + "api/gm-token", timeout=1).read()
                return self
            except Exception:  # noqa: BLE001
                if self.proc.poll() is not None:
                    raise RuntimeError("Testserver ist beim Start abgestürzt - siehe "
                                       + str(self.daten.parent))
                time.sleep(0.1)
        raise RuntimeError("Testserver kam nicht hoch")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.log.close()

    def neustart(self):
        """Wie Laptop zu und wieder auf: gleicher Datenordner, gleicher Port."""
        self.stop()
        self.start()

    def json(self, pfad: str):
        return json.loads(urllib.request.urlopen(self.url + pfad, timeout=5).read())


class Seite:
    """Eine Browser-Seite (SL oder Handy) samt gesammelter JS-Fehler."""

    def __init__(self, ctx, page, name: str):
        self.ctx, self.page, self.name = ctx, page, name
        self.fehler: list[str] = []
        page.on("pageerror", lambda e: self.fehler.append(f"{name}: {e}"))
        page.on("console", self._konsole)

    def _konsole(self, m):
        # 404 auf favicon & Co. sind keine Programmfehler.
        if m.type == "error" and "Failed to load resource" not in m.text:
            self.fehler.append(f"{self.name} (Konsole): {m.text}")

    # Kurzformen für die Tests
    def __getattr__(self, k):
        return getattr(self.page, k)

    def js(self, ausdruck: str, arg=None):
        return self.page.evaluate(ausdruck, arg)

    def state(self) -> dict:
        return self.page.evaluate("App.state")

    def warte_bis(self, ausdruck: str, arg=None, frist: float = 5000):
        """Wartet, bis ``ausdruck`` (JS, Funktion von arg) wahr ist. Wirft der
        Ausdruck (Seite lädt gerade neu, App.state noch leer), gilt das als
        „noch nicht" - nicht als Fehler der App."""
        sicher = f"(arg) => {{ try {{ return ({ausdruck})(arg); }} catch (e) {{ return false; }} }}"
        self.page.wait_for_function(sicher, arg=arg, timeout=frist)

    def text(self) -> str:
        return self.page.inner_text("body")

    def klick(self, selektor: str):
        self.page.locator(selektor).first.click()

    def dialog_knopf(self, text: str):
        """Knopf im eigenen Dialog (frage/hinweis/eingabe) drücken."""
        self.page.locator(".app-dialog-hg button", has_text=text).first.click()

    def kein_waagrechtes_scrollen(self, wo: str = ""):
        breite = self.page.evaluate(
            "[document.documentElement.scrollWidth, window.innerWidth]")
        assert breite[0] <= breite[1] + 1, (
            f"{self.name} {wo}: Seite ist {breite[0]} px breit bei {breite[1]} px Bildschirm "
            f"- man müsste seitwärts wischen. Zu breit: {self.zu_breit()}")

    def zu_breit(self):
        return self.page.evaluate("""() => {
          const w = window.innerWidth, aus = [];
          for (const e of document.querySelectorAll('#app *')) {
            const r = e.getBoundingClientRect();
            if (r.width && r.right > w + 1 && getComputedStyle(e).position !== 'fixed')
              aus.push((e.className || e.tagName) + ' ' + Math.round(r.right));
            if (aus.length > 6) break;
          }
          return aus;
        }""")


class Tisch:
    """Ein Spieltisch: ein Server, ein SL-Laptop, beliebig viele Handys."""

    def __init__(self, browser, server: Server):
        self.browser, self.server = browser, server
        self.seiten: list[Seite] = []
        self._sl = None

    def _neue_seite(self, name, viewport, spieler, mobil):
        ctx = self.browser.new_context(viewport=viewport, is_mobile=mobil, has_touch=mobil,
                                       accept_downloads=True, locale="de-DE")
        if spieler:
            ctx.add_cookies([{"name": "swi_test_rolle", "value": "spieler", "url": self.server.url}])
        ctx.set_default_timeout(10000)
        s = Seite(ctx, ctx.new_page(), name)
        self.seiten.append(s)
        return s

    @property
    def url(self):
        return self.server.url

    def sl(self, breite=1400, hoehe=900) -> Seite:
        """Der SL-Laptop (einmal pro Tisch)."""
        if self._sl is None:
            s = self._neue_seite("SL", {"width": breite, "height": hoehe}, False, False)
            s.goto(self.url)
            s.warte_bis("() => App.state && App.role === 'gm'")
            self._sl = s
        return self._sl

    def gm(self, aktion: dict):
        """SL-Aktion direkt über die Leitung des SL-Browsers (zum Vorbereiten)."""
        sl = self.sl()
        vorher = sl.js("JSON.stringify(App.state)")
        sl.js("(a) => gmAction(a)", aktion)
        # Auf den neuen Stand warten (es kommt immer einer zurück).
        try:
            sl.warte_bis("(v) => JSON.stringify(App.state) !== v", vorher, frist=3000)
        except Exception:  # noqa: BLE001 - manche Aktionen ändern nichts Sichtbares
            pass

    def handy(self, charakter: str, groesse: str = "iphone", spieler: str = "") -> Seite:
        """Ein Handy, das einen NEUEN Charakter anlegt und beitritt."""
        s = self.handy_offen(groesse, name=charakter)
        knopf = s.page.locator("[data-act=join-modus][data-modus=neu]")
        if knopf.count():
            knopf.first.click()
        s.fill("#joinneu", charakter)
        if spieler:
            s.fill("#joinname", spieler)
        s.klick("[data-act=join-neu]")
        s.warte_bis("() => App.joined && App.state && App.state.combatants.some("
                    "c => c.playerId === App.myPlayerId)")
        return s

    def handy_offen(self, groesse: str = "iphone", name: str = "Handy") -> Seite:
        """Ein Handy auf der Beitrittsseite (noch nicht beigetreten)."""
        s = self._neue_seite(name, HANDYS[groesse], True, True)
        s.goto(self.url)
        s.warte_bis("() => App.state && App.role === 'player'")
        return s

    def alle_fehler(self) -> list[str]:
        return [f for s in self.seiten for f in s.fehler]

    def schliessen(self):
        for s in self.seiten:
            try:
                s.ctx.close()
            except Exception:  # noqa: BLE001
                pass


@pytest.fixture
def server(tmp_path):
    srv = Server(tmp_path / "data").start()
    yield srv
    srv.stop()


@pytest.fixture
def tisch(browser, server, request):
    t = Tisch(browser, server)
    yield t
    fehler = t.alle_fehler()
    if os.environ.get("SWI_SCREENSHOTS"):
        ziel = Path(os.environ["SWI_SCREENSHOTS"]) / request.node.name
        ziel.mkdir(parents=True, exist_ok=True)
        for i, s in enumerate(t.seiten):
            try:
                s.screenshot(path=str(ziel / f"{i}_{s.name}.png"), full_page=True)
            except Exception:  # noqa: BLE001
                pass
    t.schliessen()
    if fehler and not getattr(request.node, "_fehler_erlaubt", False):
        pytest.fail("JavaScript-Fehler im Browser:\n  " + "\n  ".join(fehler[:20]))
