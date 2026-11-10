"""Durchleuchtung 10.11.2026: was das ↶ des SL den Spielern wegnahm, ungeprüfte
Anfragen vom Handy, fremder Host-Name, unvollständige Sicherung."""
import asyncio
from types import SimpleNamespace

from server import app as A
from server import sicherung as S


def _beigetreten(g, name):
    char = g.charakter_anlegen(name)
    p = g.register_player(name, char["id"], None)
    return char, p, next(c for c in g.combatants if c.get("playerId") == p["id"])


# --- ↶ des SL und was die Spieler selbst pflegen --------------------------------

def test_undo_loescht_keinen_vom_spieler_angelegten_charakter(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork"})          # SL-Aktion VOR dem Beitritt
    char, p, c = _beigetreten(g, "Tessa")
    g.bogen_setzen(c["id"], {"parade": "6"})
    g.notizen_setzen(c["id"], [{"id": "a", "text": "Der Wirt lügt"}])
    g.apply({"type": "undo"})
    tessa = next((r for r in g.roster if r["name"] == "Tessa"), None)
    assert tessa is not None, "Charakter aus der Liste gelöscht"
    assert tessa["bogen"]["parade"] == "6" and tessa["notizen"][0]["text"] == "Der Wirt lügt"
    # Der Ork ist zurückgenommen, die Spielerin sitzt weiter an ihrer Figur.
    assert [x["name"] for x in g.combatants] == ["Tessa"]
    assert g.combatants[0]["playerId"] == p["id"]


def test_undo_laesst_talente_und_bild_des_spielers(fresh_game):
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgo"})
    char = g.roster[-1]
    p = g.register_player("Korgo", char["id"], None)
    c = next(x for x in g.combatants if x.get("playerId") == p["id"])
    g.apply({"type": "add_npc", "name": "Ork"})
    g.talente_setzen(c["id"], ["schnell"], True, False)
    g.bild_vom_spieler(c["id"], "/uploads/" + "a" * 32 + ".png")
    tiefe = len(g._history)
    g.apply({"type": "undo"})                            # nimmt den Ork zurück …
    assert len(g._history) == tiefe - 1
    assert not any(x["name"].startswith("Ork") for x in g.combatants)
    korgo = next(r for r in g.roster if r["name"] == "Korgo")
    figur = next(x for x in g.combatants if x.get("characterId") == char["id"])
    for wo in (korgo, figur):                            # … nicht Korgos eigene Sachen
        assert wo["talents"] == ["schnell"] and wo["gluck"] is True
        assert wo["image"].endswith(".png")


def test_bild_vom_spieler_ist_kein_rueckgaengig_schritt(fresh_game):
    g = fresh_game
    _, _, c = _beigetreten(g, "Mira")
    vorher = len(g._history)
    g.bild_vom_spieler(c["id"], "/uploads/" + "b" * 32 + ".jpg")
    g.bild_vom_spieler(c["id"], "https://fremd.example/x.png")     # fremde Adresse: nichts
    assert len(g._history) == vorher
    assert c["image"].endswith(".jpg")


def test_undo_des_sl_nimmt_seine_eigene_charakter_aenderung_weiter_zurueck(fresh_game):
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgo"})
    cid = g.roster[-1]["id"]
    g.apply({"type": "roster_upsert", "id": cid, "name": "Korgo der Starke", "talents": ["schnell"]})
    g.apply({"type": "undo"})
    assert g.roster[-1]["name"] == "Korgo" and g.roster[-1]["talents"] == []


# --- Anfragen vom Handy ------------------------------------------------------------

def test_anfrage_vom_handy_wird_geprueft(fresh_game):
    g = fresh_game
    _, _, c = _beigetreten(g, "Tessa")
    an = lambda **a: g.apply({"type": "request", "combatantId": c["id"], **a})
    an(kind="benny", detail="kein Objekt", label="x")
    an(kind="erfunden", detail={}, label="x")
    an(kind="benny", detail={"delta": 10 ** 9}, label="x")
    an(kind="benny", detail={"delta": {"tief": 1}}, label="x")
    assert g.requests == []
    an(kind="benny", detail={"delta": -1}, label="A" * 500000)
    assert len(g.requests) == 1 and len(g.requests[0]["label"]) <= 120
    g.apply({"type": "resolve_request", "id": g.requests[0]["id"], "apply": True})
    assert g.requests == [] and c["bennies"] == 2


def test_anfragen_sammeln_sich_nicht_endlos(fresh_game):
    from server import game as gmod
    g = fresh_game
    _, _, c = _beigetreten(g, "Tessa")
    for i in range(gmod.MAX_ANFRAGEN + 20):
        g.apply({"type": "request", "combatantId": c["id"], "kind": "status",
                 "detail": {"woundsDelta": 1, "n": i}, "label": "Wunde"})
    assert len(g.requests) == gmod.MAX_ANFRAGEN


def test_alte_kaputte_anfrage_laesst_sich_annehmen(fresh_game):
    g = fresh_game
    _, _, c = _beigetreten(g, "Tessa")
    g.requests.append({"id": "req-alt", "combatantId": c["id"], "kind": "benny", "detail": "x", "label": ""})
    g.apply({"type": "resolve_request", "id": "req-alt", "apply": True})
    assert g.requests == []


# --- Fremder Host-Name -------------------------------------------------------------

def _anfrage(host=None, origin=None, von="127.0.0.1"):
    kopf = {k: v for k, v in (("host", host), ("origin", origin)) if v}
    return SimpleNamespace(client=SimpleNamespace(host=von), headers=kopf)


def test_fremder_host_name_ist_nicht_der_spielleiter():
    for gut in ("localhost:8000", "127.0.0.1:8000", "[::1]:8001", "localhost", None):
        assert A._is_loopback(_anfrage(gut)), gut
    for boese in ("boese.example:8000", "boese.example", "127.0.0.1.boese.example:8000",
                  "192.168.178.20:8000", "pnp.local:8000"):
        assert not A._is_loopback(_anfrage(boese)), boese
    assert not A._is_loopback(_anfrage("localhost:8000", von="192.168.178.33"))
    assert not A._is_loopback(_anfrage("localhost:8000", origin="http://boese.example"))


# --- Sicherung vollständig -----------------------------------------------------------

def test_sicherung_nimmt_alle_einstellungen_mit(fresh_game, tmp_path):
    g = fresh_game
    bild = "c" * 32 + ".png"
    (tmp_path / bild).write_bytes(b"\x89PNG")
    g.apply({"type": "set_funktionen", "werte": {"zonen": False, "bennies": False, "anfragen": False}})
    g.apply({"type": "set_kampfhilfe", "name": "gruppenKarte", "on": True})
    g.apply({"type": "set_benny_to_gm", "on": False})
    g.apply({"type": "set_rueckseite", "url": f"/uploads/{bild}"})
    daten = g.export_data()
    assert bild in S.bilder_der_sicherung(daten)
    roh, bilder = S.baue_zip(daten, tmp_path)
    assert bilder == 1
    # Auf dem „neuen Laptop": alles zurück auf Anfang, dann einspielen.
    g.apply({"type": "set_funktionen", "werte": {"zonen": True, "bennies": True, "anfragen": True}})
    g.apply({"type": "set_kampfhilfe", "name": "gruppenKarte", "on": False})
    g.apply({"type": "set_benny_to_gm", "on": True})
    g.apply({"type": "set_rueckseite", "url": None})
    gelesen, _ = S.lies_sicherung(roh, tmp_path / "neu")
    assert g.import_data(gelesen)["ok"]
    assert g.funktionen["zonen"] is False and g.funktionen["bennies"] is False
    assert g.requests_enabled is False and g.gruppen_karte is True and g.benny_to_gm is False
    assert g.rueckseite_bild == f"/uploads/{bild}"
    assert (tmp_path / "neu" / bild).is_file()


def test_alte_sicherung_laesst_neue_schalter_in_ruhe(fresh_game):
    g = fresh_game
    g.apply({"type": "set_funktionen", "werte": {"zonen": False}})
    g.apply({"type": "set_rueckseite", "url": "gruen"})
    assert g.import_data({"roster": [], "settings": {"bennyStart": 4, "timerSeconds": 9}})["ok"]
    assert g.benny_start == 4 and g.funktionen["zonen"] is False and g.rueckseite_bild == "gruen"


def test_gemerkte_stimmen_reisen_in_der_sicherung_mit(fresh_game, tmp_path, monkeypatch):
    from server.aufnahme import Aufnahmen
    alt, neu = Aufnahmen(tmp_path / "alt" / "aufnahmen"), Aufnahmen(tmp_path / "neu" / "aufnahmen")
    alt._profile_schreiben({"Korgo": {"v": [0.6, 0.8] * 8, "n": 3, "stand": 1}})
    monkeypatch.setattr(A, "game", fresh_game)
    monkeypatch.setattr(A, "aufnahmen", alt)
    daten = A._sicherung_daten()
    assert "Korgo" in daten["stimmprofile"]
    monkeypatch.setattr(A, "aufnahmen", neu)
    bericht = A._sicherung_einspielen(daten)
    assert bericht["ok"] and bericht["uebernommen"]["Gemerkte Stimmen"] == 1
    assert neu.stimmprofile()["Korgo"]["n"] == 3
    # Müll wird nicht zu einem Profil.
    assert neu.stimmprofile_einspielen({"x": {"v": "nein"}, "": {"v": [1.0] * 16}, "y": 3}) == 0
    assert "Korgo" in neu.stimmprofile()
