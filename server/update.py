"""Update-Hinweis in der App und Aktualisieren auf einen Klick.

Vorgeschichte: Updates gab es nur, wenn der SL von selbst daran dachte, die
Aktualisieren.exe im Ordner doppelzuklicken - die Kumpels spielten monatelang
mit alten Versionen, behobene Fehler inklusive (Durchleuchtung 10.11.2026,
Kalle wählte: Dialog einmal je Version, danach ein Knopf in der Kopfleiste).

Die App fragt beim Start EINMAL im Hintergrund nach (nie im Spiel, nie
blockierend - ohne Internet passiert einfach nichts). Das Aktualisieren selbst
macht weiter die Aktualisieren.exe (``aktualisieren.py --auto``): die App kann
ihre eigenen, geladenen Dateien nicht tauschen.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import urllib.request
from pathlib import Path
from typing import Callable

from .paths import APP_VERSION

# Was die Nachfrage ergab. "neu" bleibt None, solange nichts bekannt ist
# (noch nicht gefragt, kein Internet) - dann zeigt die App nichts.
stand: dict = {"neu": None, "titel": ""}


def _titel_holen(repo: str) -> str:
    """Titel des neuesten Releases („… 2.0.7 – was sich geändert hat"), nur als
    Dreingabe für den Dialog. Über die GitHub-API (60 Abfragen/Stunde je
    Anschluss) - scheitert sie, fehlt eben nur diese eine Zeile."""
    anfrage = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/latest",
                                     headers={"User-Agent": "SunderedSkies-Initiative"})
    with urllib.request.urlopen(anfrage, timeout=10) as r:
        return str(json.load(r).get("name") or "")


def was_neu(titel: str) -> str:
    """Aus „Sundered Skies Initiative 2.0.7 – Handy bleibt wach" den Teil
    hinter dem Strich; ohne Strich nichts (dann sagt der Titel nichts)."""
    for strich in (" – ", " - ", " — "):
        if strich in titel:
            return titel.split(strich, 1)[1].strip()[:300]
    return ""


def pruefen(holen: Callable[[], tuple] | None = None, titel_holen: Callable[[str], str] | None = None) -> dict:
    """Fragt GitHub nach der neuesten Version. Wirft nie - ein Update-Hinweis
    darf den Spielabend nicht stören."""
    try:
        if holen is None:
            import aktualisieren
            holen = aktualisieren.neueste_version
            repo = aktualisieren.REPO
        else:
            repo = ""
        neu = str(holen()[0] or "")
        stand["neu"] = neu or None
        if neu and verfuegbar():
            try:
                stand["titel"] = was_neu((titel_holen or _titel_holen)(repo))
            except Exception:  # noqa: BLE001
                stand["titel"] = ""
    except Exception:  # noqa: BLE001 - kein Internet, GitHub weg, Proxy …
        pass
    return stand


def pruefen_im_hintergrund() -> None:
    # SWI_NEUESTE_VERSION: für Tests und zum Ansehen des Hinweises ohne echtes
    # Release - dann wird GitHub gar nicht gefragt.
    fest = os.environ.get("SWI_NEUESTE_VERSION")
    if fest is not None:
        # Titel wie beim echten Release kürzen - sonst stand im Dialog
        # „Neu: Sundered Skies Initiative 9.9.9 – …" statt nur dem Neuen.
        stand.update({"neu": fest or None, "titel": was_neu(os.environ.get("SWI_NEUESTE_TITEL", ""))})
        return
    threading.Thread(target=pruefen, daemon=True).start()


def verfuegbar() -> bool:
    try:
        import aktualisieren
        return bool(stand["neu"]) and aktualisieren.ist_neuer(stand["neu"], APP_VERSION)
    except Exception:  # noqa: BLE001
        return False


def updater_pfad(basis: Path) -> Path | None:
    """Aktualisieren.exe neben der App - nur im fertigen Paket unter Windows.
    Beim Entwickeln (python -m server.run) gibt es sie nicht; dann zeigt die
    App nur den Link zum Herunterladen."""
    exe = basis / "Aktualisieren.exe"
    return exe if os.name == "nt" and exe.is_file() else None


def auskunft(basis: Path) -> dict:
    return {"lokal": APP_VERSION, "neu": stand["neu"], "verfuegbar": verfuegbar(),
            "titel": stand["titel"], "kann": updater_pfad(basis) is not None}


def starten(basis: Path, ausfuehren: Callable | None = None) -> bool:
    """Startet Aktualisieren.exe im eigenen Fenster. Sie beendet diese App,
    tauscht die Dateien und startet die App neu (``--auto``)."""
    exe = updater_pfad(basis)
    if not exe:
        return False
    try:
        # Eigenes Konsolenfenster + eigene Prozessgruppe: der Updater muss
        # weiterleben, wenn er gleich diese App beendet.
        flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        (ausfuehren or subprocess.Popen)([str(exe), "--auto"], cwd=str(basis), close_fds=True, creationflags=flags)
        return True
    except Exception:  # noqa: BLE001
        return False
