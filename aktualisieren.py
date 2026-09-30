"""Aktualisieren.exe – holt die neueste Version von GitHub (Releases) und tauscht
nur die Programmdateien aus. Der Ordner ``data`` (Charaktere, Bilder,
Spielstand) bleibt unangetastet: man bleibt für immer im selben Ordner, statt
jedes Mal ein neues Zip zu entpacken und den Spielstand zu suchen.

Gebaut als Ordnerversion wie die App (Aktualisieren.spec, eigener Unterordner
``_aktualisieren``) – Einzeldatei-.exe starten aus %TEMP% und werden auf
Firmen-Laptops blockiert.

Sich selbst kann ein laufendes Programm nicht überschreiben (Windows sperrt
die geladenen Dateien). Neue Updater-Dateien landen deshalb als ``*.neu``
daneben; die App tauscht sie beim nächsten Start aus (``updater_nachziehen``),
dann läuft der Updater nicht.

Nur Standardbibliothek: die .exe bleibt klein.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPO = "DonHelmut/Sundered-Skies-App"
APP_EXE = "SunderedSkiesInitiative.exe"
ZIP_NAME = "SunderedSkies-App.zip"
SELBST_EXE = "Aktualisieren.exe"
SELBST_ORDNER = "_aktualisieren"
# Nie anfassen: der Spielstand.
BEHALTEN = {"data"}
# Vorgänger des Updaters (1.4.1) – fliegen raus, sobald es die .exe gibt.
AUSGEMUSTERT = ("Aktualisieren.bat", "Aktualisieren.ps1")


# --- Reine Hilfsfunktionen (getestet) ---------------------------------------

def version_tupel(text: str | None) -> tuple[int, ...] | None:
    """„1.4.1" -> (1, 4, 1). Zahlen statt Text, sonst wäre 1.10 < 1.9."""
    if not text:
        return None
    m = re.match(r"^\s*v?(\d+(?:\.\d+)*)", text)
    return tuple(int(t) for t in m.group(1).split(".")) if m else None


def ist_neuer(neu: str | None, lokal: str | None) -> bool:
    n, l = version_tupel(neu), version_tupel(lokal)
    if n is None:
        return False
    if l is None:
        return True           # Version unbekannt -> lieber aktualisieren
    laenge = max(len(n), len(l))  # 1.4 == 1.4.0
    return n + (0,) * (laenge - len(n)) > l + (0,) * (laenge - len(l))


def version_aus_starthier(ordner: Path) -> str | None:
    """Die installierte Version steht in der ersten Zeile von START-HIER.txt
    (wird bei jedem Release mitgezogen)."""
    datei = ordner / "START-HIER.txt"
    try:
        zeile = datei.read_text(encoding="utf-8", errors="replace").splitlines()[0]
    except (OSError, IndexError):
        return None
    m = re.search(r"Version\s+(\d+(?:\.\d+)*)", zeile)
    return m.group(1) if m else None


def app_laeuft(ordner: Path) -> bool:
    """Läuft die App aus DIESEM Ordner? Ihre python*.dll ist dann geladen und
    lässt sich nicht zum Schreiben öffnen (Windows sperrt geladene DLLs)."""
    intern = ordner / "_internal"
    for dll in intern.glob("python3*.dll"):
        try:
            with open(dll, "r+b"):
                pass
        except PermissionError:
            return True
        except OSError:
            pass
    return False


def austauschen(quelle: Path, ordner: Path) -> list[str]:
    """Neue Version aus ``quelle`` nach ``ordner`` bringen. ``data`` bleibt,
    ``_internal`` wird vorher ganz geleert (sonst blieben Dateien der alten
    Version liegen). Die eigenen Dateien des Updaters kommen als ``*.neu``
    daneben. Rückgabe: Liste der erledigten Einträge (für die Anzeige/Tests)."""
    erledigt = []
    for eintrag in sorted(quelle.iterdir()):
        name = eintrag.name
        if name in BEHALTEN:
            continue
        if name in (SELBST_EXE, SELBST_ORDNER):
            ziel = ordner / (name + ".neu")
        else:
            ziel = ordner / name
        if ziel.is_dir():
            shutil.rmtree(ziel)
        elif ziel.exists():
            ziel.unlink()
        if eintrag.is_dir():
            shutil.copytree(eintrag, ziel)
        else:
            shutil.copy2(eintrag, ziel)
        erledigt.append(ziel.name)
    return erledigt


def updater_nachziehen(ordner: Path) -> bool:
    """Liegen neue Updater-Dateien (*.neu) bereit, jetzt einsetzen. Läuft beim
    Start der App (dann ist der Updater nicht offen). Räumt außerdem den
    Vorgänger (Aktualisieren.bat/.ps1) weg. Rückgabe: ob etwas getauscht wurde."""
    getauscht = False
    neu_ordner = ordner / (SELBST_ORDNER + ".neu")
    neu_exe = ordner / (SELBST_EXE + ".neu")
    try:
        if neu_ordner.is_dir():
            alt = ordner / SELBST_ORDNER
            if alt.is_dir():
                shutil.rmtree(alt)
            neu_ordner.rename(alt)
            getauscht = True
        if neu_exe.is_file():
            alt = ordner / SELBST_EXE
            if alt.exists():
                alt.unlink()
            neu_exe.rename(alt)
            getauscht = True
        if (ordner / SELBST_EXE).is_file():
            for name in AUSGEMUSTERT:
                (ordner / name).unlink(missing_ok=True)
    except OSError:
        pass  # Updater gerade offen o. Ä. - beim nächsten Start wieder
    return getauscht


# --- Netz ---------------------------------------------------------------------

def _anfrage(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": "SunderedSkies-Aktualisieren"})


def neueste_version() -> tuple[str, str, int]:
    """(Version, Download-Adresse, Größe) des neuesten Releases."""
    with urllib.request.urlopen(_anfrage(f"https://api.github.com/repos/{REPO}/releases/latest"), timeout=20) as r:
        info = json.load(r)
    zip_ = next((a for a in info.get("assets", []) if a.get("name") == ZIP_NAME), None)
    if not zip_:
        raise RuntimeError(f"Im neuesten Release fehlt {ZIP_NAME}.")
    return info.get("tag_name", "").lstrip("v"), zip_["browser_download_url"], int(zip_.get("size") or 0)


def herunterladen(url: str, ziel: Path, groesse: int) -> None:
    with urllib.request.urlopen(_anfrage(url), timeout=60) as r, open(ziel, "wb") as f:
        geladen, zuletzt = 0, -1
        while True:
            stueck = r.read(256 * 1024)
            if not stueck:
                break
            f.write(stueck)
            geladen += len(stueck)
            if groesse:
                prozent = min(100, geladen * 100 // groesse)
                if prozent // 10 != zuletzt:
                    zuletzt = prozent // 10
                    print(f"  … {prozent} %", flush=True)


# --- Ablauf -------------------------------------------------------------------

def _ende(code: int) -> None:
    print()
    if not os.environ.get("SWS_OHNE_PAUSE"):          # (Tests)
        try:
            input("Enter drücken zum Schließen … ")
        except EOFError:
            pass
    sys.exit(code)


def main() -> None:
    ordner = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path.cwd()
    print("============================================")
    print("  Sundered Skies – Initiative: Aktualisieren")
    print("============================================")
    print()
    if not (ordner / APP_EXE).is_file():
        print(f"Hier liegt keine {APP_EXE} – Aktualisieren.exe gehört in den App-Ordner.")
        _ende(1)

    lokal = version_aus_starthier(ordner)
    try:
        neu, url, groesse = neueste_version()
    except Exception as fehler:  # kein Netz, GitHub down, Proxy …
        print("Keine Verbindung zu GitHub. Ist der Laptop im Internet?")
        print(f"({fehler})")
        _ende(1)
    print(f"Installiert: {lokal or 'unbekannt'}")
    print(f"Neueste:     {neu}")
    print()
    if not ist_neuer(neu, lokal):
        print("Du hast schon die neueste Version. Nichts zu tun.")
        _ende(0)

    if app_laeuft(ordner):
        print("Die App läuft noch. Sie muss zum Aktualisieren kurz beendet werden.")
        # Nur den ersten Buchstaben werten - unsichtbare Zeichen (BOM aus
        # umgeleiteter Eingabe, Leerzeichen) dürfen kein „Nein" erzeugen.
        antwort = re.sub(r"[^a-z]", "", input("Jetzt beenden? (j/n) ").lower())
        if not antwort.startswith(("j", "y")):
            print("Abgebrochen – nichts geändert.")
            _ende(1)
        subprocess.run(["taskkill", "/F", "/IM", APP_EXE], capture_output=True)
        import time
        for _ in range(20):
            time.sleep(0.5)
            if not app_laeuft(ordner):
                break

    with tempfile.TemporaryDirectory(prefix="sws-update-") as tmp:
        tmp = Path(tmp)
        datei = tmp / "app.zip"
        try:
            print(f"Lade Version {neu} herunter ({round(groesse / 1024 / 1024)} MB) …")
            herunterladen(url, datei, groesse)
            print("Entpacke …")
            with zipfile.ZipFile(datei) as z:
                z.extractall(tmp / "neu")
            quelle = next((p.parent for p in (tmp / "neu").rglob(APP_EXE)), None)
            if quelle is None:
                raise RuntimeError(f"Im Download fehlt {APP_EXE}.")
            print("Tausche Programmdateien aus (data bleibt) …")
            austauschen(quelle, ordner)
        except Exception as fehler:
            print()
            print(f"FEHLER: {fehler}")
            print("Falls die App jetzt nicht startet: neueste SunderedSkies-App.zip von")
            print(f"https://github.com/{REPO}/releases/latest holen und den Ordner data hineinkopieren.")
            _ende(1)

    print()
    print(f"Fertig – jetzt Version {neu}. Starten wie immer mit START.bat")
    print(f"oder {APP_EXE}.")
    _ende(0)


if __name__ == "__main__":
    main()
