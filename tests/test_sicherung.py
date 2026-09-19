"""Sicherung als Zip mit Bildern (server/sicherung.py)."""

import io
import json
import zipfile

import pytest

from server import sicherung

BILD = "0123456789abcdef0123456789abcdef.png"


def _daten():
    return {
        "type": "sundered-skies-backup", "version": 1,
        "roster": [{"id": "c1", "name": "Tessa", "image": f"/uploads/{BILD}"}],
        "bestiary": [{"id": "n1", "name": "Ork", "image": "/uploads/fehlt0000000000000000000000000000.png"}],
        "allies": [], "encounters": [],
    }


def test_zip_hin_und_zurueck_mit_bild(tmp_path):
    quelle = tmp_path / "alt"
    quelle.mkdir()
    (quelle / BILD).write_bytes(b"\x89PNG-bilddaten")
    roh, anzahl = sicherung.baue_zip(_daten(), quelle)
    assert anzahl == 1                                   # fehlendes Bild still übersprungen

    ziel = tmp_path / "neu"
    daten, neu = sicherung.lies_sicherung(roh, ziel)
    assert daten["roster"][0]["name"] == "Tessa"
    assert neu == 1 and (ziel / BILD).read_bytes() == b"\x89PNG-bilddaten"

    _, nochmal = sicherung.lies_sicherung(roh, ziel)     # zweiter Import: nichts doppelt
    assert nochmal == 0


def test_alte_json_sicherung_geht_weiter(tmp_path):
    roh = json.dumps(_daten()).encode("utf-8")
    daten, neu = sicherung.lies_sicherung(roh, tmp_path)
    assert daten["roster"][0]["name"] == "Tessa" and neu == 0


def test_manipulierte_zip_schreibt_nichts_ausserhalb(tmp_path):
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        z.writestr(sicherung.JSON_NAME, json.dumps(_daten()))
        z.writestr("uploads/../../boese.png", b"x")
        z.writestr("uploads/boese.exe", b"x")
        z.writestr(f"andere/{BILD}", b"x")
    ziel = tmp_path / "uploads"
    _, neu = sicherung.lies_sicherung(puffer.getvalue(), ziel)
    assert neu == 0
    assert not (tmp_path / "boese.png").exists()
    assert list(ziel.iterdir()) == []


def test_unbrauchbare_datei_meldet_fehler(tmp_path):
    with pytest.raises(ValueError):
        sicherung.lies_sicherung(b"das ist nichts", tmp_path)
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        z.writestr("irgendwas.txt", "x")
    with pytest.raises(ValueError):
        sicherung.lies_sicherung(puffer.getvalue(), tmp_path)
