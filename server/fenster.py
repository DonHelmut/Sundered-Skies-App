"""Die SL-Ansicht als eigenes Programmfenster - und das Symbol neben der Uhr.

Warum: Bis 2.0.5 öffnete die App einen ganz normalen Browser-Tab (Adressleiste,
Tabs, „localhost:8000") plus ein schwarzes Konsolenfenster, das offen bleiben
musste. Das wirkte wie eine Webseite, und wer das schwarze Fenster für Müll
hielt und schloss, hatte den Spielabend beendet (Kalle, 09.11.2026: „mehr wie
ein festes Programm").

Jetzt (Variante B):
- Edge/Chrome im App-Modus (``--app=URL``): eigenes Fenster ohne Adressleiste
  und Tabs, eigenes Symbol in der Taskleiste. Mikrofon, Downloads und
  gespeicherte Freigaben verhalten sich wie bisher im Browser - bewusst KEIN
  eingebettetes WebView (Variante C, pywebview), dort müssten Aufnahme und
  Downloads erst neu zum Laufen gebracht werden.
- Das normale Browser-Profil wird benutzt, kein eigenes: sonst fragt der
  Browser die Mikrofon-Freigabe neu ab, und im App-Ordner wüchse ein
  Profil-Ordner. Auf Kumpel-Laptops wird nichts dauerhaft verändert.
- Statt Konsole ein Symbol im Infobereich (pystray). Fenster zu = die Handys
  spielen weiter; beendet wird über Rechtsklick → Beenden.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Callable


# --- Browser finden -----------------------------------------------------------

def _standard_progid() -> str:
    """ProgId des Standard-Browsers (z. B. ``ChromeHTML``, ``MSEdgeHTM``)."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\Shell\Associations"
                            r"\UrlAssociations\http\UserChoice") as k:
            return str(winreg.QueryValueEx(k, "ProgId")[0])
    except Exception:
        return ""


def _kandidaten(umgebung: dict | None = None) -> dict[str, list[Path]]:
    env = umgebung if umgebung is not None else os.environ
    pf = [env.get("ProgramFiles"), env.get("ProgramFiles(x86)"), env.get("LOCALAPPDATA")]
    pf = [Path(p) for p in pf if p]
    return {
        "chrome": [p / "Google" / "Chrome" / "Application" / "chrome.exe" for p in pf],
        "edge": [p / "Microsoft" / "Edge" / "Application" / "msedge.exe" for p in pf],
    }


def reihenfolge(progid: str) -> list[str]:
    """Erst der Standard-Browser (dort liegt schon die Mikrofon-Freigabe für
    localhost), dann Edge (ist auf jedem Windows 10/11), dann Chrome."""
    p = (progid or "").lower()
    if p.startswith("chrome"):
        return ["chrome", "edge"]
    return ["edge", "chrome"]


def browser_finden(progid: str | None = None, umgebung: dict | None = None,
                   gibt_es: Callable[[Path], bool] = Path.is_file) -> Path | None:
    """Pfad zu Edge/Chrome oder None (dann bleibt nur der normale Browser-Tab)."""
    if os.name != "nt" and umgebung is None:
        return None
    pfade = _kandidaten(umgebung)
    for name in reihenfolge(_standard_progid() if progid is None else progid):
        for p in pfade[name]:
            if gibt_es(p):
                return p
    return None


def app_fenster_oeffnen(url: str) -> str:
    """Öffnet ``url`` als App-Fenster; Rückfall: normaler Browser-Tab.
    Rückgabe für das Log: womit geöffnet wurde."""
    exe = browser_finden()
    if exe:
        try:
            subprocess.Popen([str(exe), f"--app={url}"], close_fds=True,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            return f"App-Fenster ({exe.name})"
        except Exception:
            pass
    try:
        webbrowser.open(url)
        return "Browser-Tab"
    except Exception:
        return "nichts (kein Browser gefunden)"


# --- Ohne Konsole ---------------------------------------------------------------

# True in der .exe ohne schwarzes Fenster (PyInstaller ``console=False``): dort
# ist ``sys.stdout`` None. Beim IMPORT festgehalten - ausgaben_umleiten() füllt
# stdout danach, dann wäre es nicht mehr zu erkennen.
OHNE_KONSOLE = sys.stdout is None or sys.stderr is None


def ausgaben_umleiten() -> None:
    """Ohne Konsole sind stdout/stderr None. uvicorn fragt beim Start
    ``sys.stdout.isatty()`` ab und stürzt dann ab - also ins Nichts umleiten.
    Was wichtig ist, steht ohnehin in data/log.txt (diag.log)."""
    leer = None
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            if leer is None:
                leer = open(os.devnull, "w", encoding="utf-8")
            setattr(sys, name, leer)


def meldung(text: str, titel: str = "Sundered Skies Initiative", fehler: bool = False) -> None:
    """Windows-Meldungsfenster - ohne Konsole der einzige Weg, etwas zu sagen,
    bevor der Server (und damit die SL-Ansicht) läuft."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, titel, 0x10 if fehler else 0x40)
    except Exception:
        pass


# --- Symbol neben der Uhr ---------------------------------------------------------

class Infobereich:
    """Symbol im Infobereich mit Menü. Läuft in eigenem Thread; ``beenden``
    wird aufgerufen, wenn jemand „Beenden" wählt."""

    def __init__(self, url: str, daten_ordner: Path, icon_pfad: Path,
                 beenden: Callable[[], None], version: str = ""):
        self.url, self.daten, self.icon_pfad = url, daten_ordner, icon_pfad
        self._beenden, self.version = beenden, version
        self.icon = None

    def starten(self) -> bool:
        try:
            import pystray
            from PIL import Image
        except Exception:
            return False
        bild = Image.open(self.icon_pfad)
        M = pystray.MenuItem
        menue = pystray.Menu(
            M(f"Sundered Skies Initiative {self.version}".strip(), None, enabled=False),
            pystray.Menu.SEPARATOR,
            # default=True: Doppelklick aufs Symbol öffnet das Fenster.
            M("Fenster öffnen", lambda *_: app_fenster_oeffnen(self.url), default=True),
            M("Handy-QR-Code zeigen",
              lambda *_: app_fenster_oeffnen(self.url.rstrip("/") + "/static/beitritt.html")),
            M("Ordner mit Spielstand und Log öffnen", lambda *_: self._ordner()),
            pystray.Menu.SEPARATOR,
            M("Beenden", lambda *_: self._ende()),
        )
        self.icon = pystray.Icon("SunderedSkies", bild, "Sundered Skies Initiative", menue)
        threading.Thread(target=self.icon.run, daemon=True).start()
        return True

    def hinweis(self, text: str) -> None:
        """Windows-Benachrichtigung (unten rechts)."""
        try:
            if self.icon:
                self.icon.notify(text, "Sundered Skies Initiative")
        except Exception:
            pass

    def _ordner(self) -> None:
        try:
            os.startfile(str(self.daten))  # type: ignore[attr-defined]
        except Exception:
            pass

    def _ende(self) -> None:
        try:
            if self.icon:
                self.icon.stop()
        finally:
            self._beenden()
