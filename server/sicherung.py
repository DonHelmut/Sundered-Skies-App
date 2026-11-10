"""Sicherung als Zip-Datei: die Daten (JSON) PLUS alle Bilder, die darin benutzt
werden.

Vorher war die Sicherung nur JSON mit Verweisen wie „/uploads/abc.png" - beim
Umzug auf einen anderen Laptop fehlten danach alle Charakter- und Gegnerbilder.
Alte JSON-Sicherungen lassen sich weiter einspielen (siehe lies_sicherung).
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import time
import zipfile
from pathlib import Path
from typing import Optional

JSON_NAME = "sicherung.json"
# So benennt /api/upload die Dateien (uuid4.hex + Endung). Alles andere aus
# einer Zip-Datei wird ignoriert - kein Pfad-Trick kann so ausserhalb des
# Upload-Ordners schreiben.
BILD_NAME = re.compile(r"^[0-9a-f]{32}\.(png|jpg|jpeg|gif|webp)$")
MAX_BILD = 16 * 1024 * 1024          # je Bild
MAX_GESAMT = 400 * 1024 * 1024       # ausgepackt insgesamt (Schutz vor Zip-Bomben)


def bilder_der_sicherung(data: dict) -> set[str]:
    """Dateinamen aller Bilder, auf die die Sicherung verweist."""
    namen: set[str] = set()

    def merke(eintrag):
        if not isinstance(eintrag, dict):
            return
        for feld in ("image", "rueckseite"):     # eigene Kartenrückseite gehört mit rein
            url = eintrag.get(feld)
            if isinstance(url, str) and url.startswith("/uploads/"):
                name = url.rsplit("/", 1)[-1]
                if BILD_NAME.match(name):
                    namen.add(name)

    for feld in ("roster", "bestiary", "allies"):
        for e in data.get(feld) or []:
            merke(e)
    for begegnung in data.get("encounters") or []:
        for m in (begegnung.get("members") or []) if isinstance(begegnung, dict) else []:
            merke(m)
    # Die Kartenrückseite des Tisches (eigenes Bild des SL) steht bei den
    # Einstellungen - ohne sie zeigte der neue Laptop auf ein Bild, das fehlt.
    einst = data.get("settings")
    if isinstance(einst, dict):
        merke({"rueckseite": einst.get("rueckseiteBild")})
    return namen


def baue_zip(data: dict, upload_dir: Path) -> tuple[bytes, int]:
    """Zip mit sicherung.json + uploads/<bild>. Liefert (Bytes, Anzahl Bilder).
    Bilder, die es auf der Platte nicht (mehr) gibt, werden still übersprungen."""
    puffer = io.BytesIO()
    anzahl = 0
    with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(JSON_NAME, json.dumps(data, ensure_ascii=False, indent=2))
        for name in sorted(bilder_der_sicherung(data)):
            pfad = upload_dir / name
            if pfad.is_file():
                # Bilder sind schon komprimiert - nochmal packen kostet nur Zeit.
                z.write(pfad, f"uploads/{name}", compress_type=zipfile.ZIP_STORED)
                anzahl += 1
    return puffer.getvalue(), anzahl


def lies_sicherung(roh: bytes, upload_dir: Path) -> tuple[dict, int]:
    """Zip ODER alte JSON-Sicherung einlesen. Bilder aus der Zip landen im
    Upload-Ordner (vorhandene gleichen Namens bleiben - der Name ist eine
    Zufalls-ID, gleiches Bild). Liefert (Daten, Anzahl neu abgelegter Bilder).
    Wirft ValueError bei unbrauchbarer Datei."""
    if not roh.startswith(b"PK"):
        try:
            return json.loads(roh.decode("utf-8")), 0
        except Exception as exc:
            raise ValueError("keine gültige Sicherung") from exc
    try:
        z = zipfile.ZipFile(io.BytesIO(roh))
    except zipfile.BadZipFile as exc:
        raise ValueError("kaputte Zip-Datei") from exc
    with z:
        try:
            data = json.loads(z.read(JSON_NAME).decode("utf-8"))
        except KeyError as exc:
            raise ValueError("keine Sicherung (sicherung.json fehlt)") from exc
        except Exception as exc:
            raise ValueError("sicherung.json unlesbar") from exc
        gesamt = 0
        neu = 0
        upload_dir.mkdir(parents=True, exist_ok=True)
        for info in z.infolist():
            teile = info.filename.replace("\\", "/").split("/")
            if len(teile) != 2 or teile[0] != "uploads" or not BILD_NAME.match(teile[1]):
                continue
            if info.file_size > MAX_BILD:
                continue
            gesamt += info.file_size
            if gesamt > MAX_GESAMT:
                break
            ziel = upload_dir / teile[1]
            if ziel.exists():
                continue
            ziel.write_bytes(z.read(info))
            neu += 1
    return data, neu


# --- Automatische Sicherung ----------------------------------------------------
# Kalle (04.11.2026): still im Hintergrund, etwa stündlich, ältere fliegen raus
# - der Ordner soll nicht stetig wachsen. Schützt vor Bedienfehlern (Charakter
# gelöscht, falsche Sicherung eingespielt), gegen die .bak und OneDrive nicht
# helfen: die überschreiben den Fehler beim nächsten Speichern brav mit.

AUTO_BEHALTEN = 10
AUTO_NAME = re.compile(r"^auto-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(-\d+)?\.zip$")
_STAND_DATEI = ".letzter-stand"


def _stand(data: dict) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def auto_sichern(data: dict, upload_dir: Path, ordner: Path, immer: bool = False,
                 behalten: int = AUTO_BEHALTEN) -> Optional[Path]:
    """Legt eine Zip-Sicherung in ``ordner`` an - nur wenn sich seit der
    letzten etwas geändert hat (sonst wären nach einem ruhigen Wochenende
    alle zehn Plätze mit demselben Stand belegt und die ältere, vielleicht
    gesuchte Fassung weg). ``immer`` = trotzdem (vor einem Zurückholen)."""
    ordner.mkdir(parents=True, exist_ok=True)
    stand = _stand(data)
    stand_datei = ordner / _STAND_DATEI
    try:
        alt = stand_datei.read_text(encoding="utf-8").strip()
    except OSError:
        alt = ""
    if stand == alt and not immer:
        return None
    body, _ = baue_zip(data, upload_dir)
    name = time.strftime("auto-%Y-%m-%d_%H-%M")
    ziel, n = ordner / f"{name}.zip", 1
    while ziel.exists():
        n += 1
        ziel = ordner / f"{name}-{n}.zip"
    tmp = ziel.with_suffix(".tmp")
    tmp.write_bytes(body)
    tmp.replace(ziel)
    stand_datei.write_text(stand, encoding="utf-8")
    auto_aufraeumen(ordner, behalten)
    return ziel


def auto_liste(ordner: Path) -> list[dict]:
    """Automatische Sicherungen, neueste zuerst."""
    if not ordner.is_dir():
        return []
    raus = []
    for p in ordner.iterdir():
        if p.is_file() and AUTO_NAME.match(p.name):
            st = p.stat()
            raus.append({"name": p.name, "bytes": st.st_size, "zeit": int(st.st_mtime * 1000)})
    return sorted(raus, key=_reihenfolge, reverse=True)


def _reihenfolge(e: dict) -> tuple:
    """Nach Zeit, bei gleicher Zeit nach Name - die laufende Nummer aber als
    ZAHL: als Text stand „…-9" nach „…-13", und das Aufräumen löschte bei
    mehreren Sicherungen in derselben Minute die neuere (wackelnder Test
    test_auto_sicherung_…, Prüfung 05.11.2026)."""
    m = re.match(r"^(auto-\d{4}-\d{2}-\d{2}_\d{2}-\d{2})(?:-(\d+))?\.zip$", e["name"])
    basis, nr = (m.group(1), int(m.group(2) or 1)) if m else (e["name"], 0)
    return (e["zeit"], basis, nr)


def auto_aufraeumen(ordner: Path, behalten: int = AUTO_BEHALTEN) -> int:
    weg = 0
    for e in auto_liste(ordner)[behalten:]:
        try:
            (ordner / e["name"]).unlink()
            weg += 1
        except OSError:
            pass
    return weg
