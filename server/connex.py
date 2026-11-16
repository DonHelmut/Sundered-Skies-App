"""Sitzplatz-Erkennung einrichten: SSL-Treiber fürs Tischmikro holen.

Kalle (16.11.2026): „Der Treiber fürs SSL soll ins Game mit rein für den SL."
Mitliefern geht nicht - die SSL-Lizenz verbietet, die Software an andere
weiterzugeben oder in andere Programme einzubauen (General End User License
Agreement, Abschnitt 6), und Repo wie Releases sind öffentlich. Darum der
kürzeste erlaubte Weg (Kalle wählte „Ein Klick, mit Anleitung als Rückfall"):

- Die App zeigt im Aufnahme-Panel, was noch fehlt: Mikro da? Kapseln einzeln
  zu sehen (Immersive)? Nur die Kapseln zählen - Windows' eigener USB-Treiber
  gibt sie oft schon her, dann braucht es SSLs Treiber gar nicht.
- „Treiber installieren": der SL stimmt in der App der SSL-Lizenz zu (bei SSL
  steht vor dem Download dieselbe Zustimmung), dann lädt die App den
  Installer DIREKT von SSL und startet ihn. Der Link steht auf SSLs
  Connex-Seite; die App liest ihn dort frisch ab, damit ein neuer Treiber
  ohne App-Update ankommt.
- Geht irgendetwas davon nicht (kein Internet, Seite umgebaut, Datei nicht
  von SSL signiert): Anleitung mit Knopf zur SSL-Seite.

Nur Windows - nur dort braucht es den Treiber.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Optional

from . import richtung

SEITE = "https://support.solidstatelogic.com/hc/en-gb/articles/6994863464861-Connex-User-Documents-and-Downloads"
LIZENZ = "https://solidstatelogic.com/legal/general-end-user-license-agreement"
_SEITE_API = "https://support.solidstatelogic.com/api/v2/help_center/en-gb/articles/6994863464861.json"
# Nur von hier wird je etwas geladen und gestartet: SSLs eigener Download-Speicher.
_ERLAUBT = "https://s3.eu-west-2.amazonaws.com/zendesk.download.solidstatelogic.com/"
_DATEI = re.compile(r"^SolidStateLogic_UsbAudio_v[\d.]+_[\d-]+_setup\.exe$")
# Stand 16.11.2026 auf SSLs Connex-Seite - falls sich die Seite nicht lesen lässt.
_BEKANNT = (_ERLAUBT + "Audio%20Interfaces/SSL2%20and%20plus/"
            "SolidStateLogic_UsbAudio_v5.58.05_2023-08-24_setup.exe")
MAX_BYTES = 200 * 1024 * 1024      # der Installer hat ein paar MB; alles darüber ist nicht er


def link_erlaubt(url: str) -> bool:
    """Nur https, nur SSLs Speicher, nur der Treiber-Installer."""
    if not isinstance(url, str) or not url.startswith(_ERLAUBT):
        return False
    pfad = urllib.parse.unquote(urllib.parse.urlsplit(url).path)
    return ".." not in pfad and bool(_DATEI.match(pfad.rsplit("/", 1)[-1]))


def _holen(url: str, timeout: float = 15) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(2 * 1024 * 1024)


def treiber_link(holen: Callable[[str], bytes] = _holen) -> str:
    """Den Download-Link von SSLs Connex-Seite ablesen (Knopf „Download SSL
    Windows ASIO/WDM Driver", Attribut data-link). Sonst der bekannte."""
    try:
        html = json.loads(holen(_SEITE_API).decode("utf-8", "replace"))["article"]["body"]
        for url in re.findall(r'data-link="([^"]+)"', html):
            url = url.replace("&amp;", "&").replace(" ", "%20")
            if link_erlaubt(url):
                return url
    except Exception:   # noqa: BLE001 - Seite weg/umgebaut: der bekannte Link
        pass
    return _BEKANNT


def treiber_da() -> bool:
    """Ist ein SSL-ASIO-Treiber angemeldet? (Windows-Registry, dort tragen
    sich ASIO-Treiber ein.)"""
    if sys.platform != "win32":
        return False
    try:
        import winreg
    except ImportError:
        return False
    for ast in (r"SOFTWARE\ASIO", r"SOFTWARE\WOW6432Node\ASIO"):
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, ast) as k:
                for i in range(winreg.QueryInfoKey(k)[0]):
                    name = winreg.EnumKey(k, i).lower()
                    if "ssl" in name or "solid state" in name:
                        return True
        except OSError:
            continue
    return False


def signatur_gueltig(pfad: Path) -> bool:
    """Trägt die Datei eine gültige Hersteller-Signatur (Windows prüft)? Ohne
    sie startet die App nichts, was sie aus dem Netz geladen hat."""
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "(Get-AuthenticodeSignature -LiteralPath $env:SWI_PRUEF_DATEI).Status"],
            capture_output=True, text=True, timeout=60, env=dict(os.environ, SWI_PRUEF_DATEI=str(pfad)),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode == 0 and r.stdout.strip() == "Valid"
    except (OSError, subprocess.SubprocessError):
        return False


class Einrichtung:
    """Stand der Sitzplatz-Erkennung + der Ein-Klick-Weg zum Treiber."""

    def __init__(self, ordner: Path, windows: Optional[bool] = None) -> None:
        self.ordner = ordner                      # hierhin kommt der Installer
        self.windows = sys.platform == "win32" if windows is None else windows
        self._geraete: Optional[dict] = None      # {"connex", "kapseln"} - None: noch nie geschaut
        self.laden: Optional[dict] = None         # {"anteil", "schritt", "fehler"}
        self._sperre = threading.Lock()
        # Für Tests austauschbar.
        self.geraete_lesen: Callable[[bool], dict] = richtung.uebersicht
        self.treiber_da: Callable[[], bool] = treiber_da
        self.signatur_gueltig: Callable[[Path], bool] = signatur_gueltig
        self.starten: Callable[[Path], None] = lambda p: os.startfile(str(p))   # noqa: S606 - geprüfter SSL-Installer
        self.holen: Callable[[str], bytes] = _holen
        self.oeffnen: Callable = urllib.request.urlopen

    def pruefen(self, neu: bool = True) -> None:
        """Geräte neu ansehen. neu=True liest die Liste frisch ein (Mikro
        eben eingesteckt, Immersive eben eingeschaltet) - nicht während die
        Kapseln gerade mitgehört werden."""
        if self.windows:
            self._geraete = self.geraete_lesen(neu)

    def zustand(self) -> Optional[dict]:
        """Für die Anzeige. None: hier gibt es nichts einzurichten (kein
        Windows) oder es wurde noch nicht nachgesehen."""
        if not self.windows or self._geraete is None:
            return None
        g = self._geraete
        laden = self.laden
        return {"connex": bool(g.get("connex")), "kapseln": bool(g.get("kapseln")),
                # Nur was wirklich in der Registry steht. Früher galt „Kapseln zu
                # sehen = Treiber da" - falsch: Windows' eigener USB-Treiber
                # gibt sie auch her (Jonsbo, 16.11.2026).
                "treiber": self.treiber_da(),
                "laden": dict(laden) if laden else None, "seite": SEITE, "lizenz": LIZENZ}

    def treiber_holen(self) -> bool:
        """Installer von SSL laden und starten (im Hintergrund). False: läuft
        schon oder nicht Windows."""
        if not self.windows:
            return False
        with self._sperre:
            if self.laden and not self.laden.get("fehler") and self.laden.get("schritt") != "gestartet":
                return False
            zustand = {"anteil": 0.0, "schritt": "laden", "fehler": None}
            self.laden = zustand

        def los() -> None:
            from . import diag
            try:
                url = treiber_link(self.holen)
                if not link_erlaubt(url):
                    raise ValueError("Link")
                self.ordner.mkdir(parents=True, exist_ok=True)
                ziel = self.ordner / urllib.parse.unquote(url.rsplit("/", 1)[-1])
                tmp = ziel.with_suffix(".teil")
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with self.oeffnen(req, timeout=30) as r, open(tmp, "wb") as f:
                    gesamt = int(r.headers.get("Content-Length") or 0)
                    da = 0
                    while True:
                        block = r.read(256 * 1024)
                        if not block:
                            break
                        da += len(block)
                        if da > MAX_BYTES:
                            raise ValueError("zu groß")
                        f.write(block)
                        zustand["anteil"] = round(da / gesamt, 3) if gesamt else 0.0
                tmp.replace(ziel)
                zustand["schritt"] = "pruefen"
                if not self.signatur_gueltig(ziel):
                    ziel.unlink(missing_ok=True)
                    raise ValueError("Signatur")
                self.starten(ziel)
                zustand["schritt"] = "gestartet"
                diag.log(f"CONNEX-TREIBER: Installer gestartet ({ziel.name})")
            except Exception as e:   # noqa: BLE001 - dann zeigt die App die Anleitung
                zustand["fehler"] = e.__class__.__name__ if not isinstance(e, ValueError) else str(e)
                diag.log(f"CONNEX-TREIBER: ging nicht ({zustand['fehler']})")
        threading.Thread(target=los, daemon=True, name="connex-treiber").start()
        return True
