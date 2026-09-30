"""Sicherung als Zip-Datei: die Daten (JSON) PLUS alle Bilder, die darin benutzt
werden.

Vorher war die Sicherung nur JSON mit Verweisen wie „/uploads/abc.png" - beim
Umzug auf einen anderen Laptop fehlten danach alle Charakter- und Gegnerbilder.
Alte JSON-Sicherungen lassen sich weiter einspielen (siehe lies_sicherung).
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

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
