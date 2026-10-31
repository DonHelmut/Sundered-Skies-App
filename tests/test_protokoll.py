"""Spielabend-Protokolle: SL fügt ein, gibt frei - Handys sehen nur Freigegebenes."""


def _neu(g, text="## Abend 1\nDie Crew landet auf Kogo.", **mehr):
    g.apply({"type": "protokoll_speichern", "name": "Abend 1", "text": text, **mehr})
    return g.protokolle[0]


def test_neues_protokoll_ist_erst_nur_beim_sl(fresh_game):
    p = _neu(fresh_game)
    assert p["freigegeben"] is False
    assert [x["id"] for x in fresh_game.snapshot()["protokolle"]] == [p["id"]]
    assert fresh_game.snapshot(fuer_spieler=True)["protokolle"] == []
    assert fresh_game.protokoll_text(p["id"], fuer_spieler=True) is None
    assert "Kogo" in fresh_game.protokoll_text(p["id"], fuer_spieler=False)["text"]


def test_freigeben_und_zurueckziehen(fresh_game):
    p = _neu(fresh_game)
    fresh_game.apply({"type": "protokoll_freigeben", "id": p["id"], "an": True})
    liste = fresh_game.snapshot(fuer_spieler=True)["protokolle"]
    assert [x["id"] for x in liste] == [p["id"]]
    # Der Text steht NICHT im Zustand (ginge sonst bei jedem Update an jedes Handy).
    assert "text" not in liste[0]
    assert "Kogo" in fresh_game.protokoll_text(p["id"], fuer_spieler=True)["text"]
    fresh_game.apply({"type": "protokoll_freigeben", "id": p["id"], "an": False})
    assert fresh_game.snapshot(fuer_spieler=True)["protokolle"] == []


def test_neuestes_zuerst_und_bearbeiten_behaelt_id(fresh_game):
    a = _neu(fresh_game)
    fresh_game.apply({"type": "protokoll_speichern", "name": "Abend 2", "text": "Zweiter Abend"})
    assert [p["name"] for p in fresh_game.protokolle] == ["Abend 2", "Abend 1"]
    fresh_game.apply({"type": "protokoll_speichern", "id": a["id"], "name": "Abend 1 (neu)", "text": "geändert"})
    assert len(fresh_game.protokolle) == 2
    assert fresh_game.protokoll_text(a["id"], False)["text"] == "geändert"


def test_leerer_text_wird_nicht_gespeichert_und_titel_kommt_von_selbst(fresh_game):
    fresh_game.apply({"type": "protokoll_speichern", "name": "x", "text": "   "})
    assert fresh_game.protokolle == []
    fresh_game.apply({"type": "protokoll_speichern", "name": "", "text": "Text"})
    assert fresh_game.protokolle[0]["name"].startswith("Spielabend ")


def test_protokoll_verwirft_gespeicherte_sitzung_nicht(fresh_game):
    # Wer vor dem „Fortsetzen" das Protokoll vom letzten Mal freigibt, darf
    # den gespeicherten Kampf nicht verlieren.
    fresh_game.resume_available = True
    p = _neu(fresh_game, freigegeben=True)
    assert fresh_game.resume_available is True
    assert p["freigegeben"] is True
    assert fresh_game.snapshot()["canUndo"] is False


def test_loeschen_und_dauerhaft_gespeichert(fresh_game):
    from server import game as gmod
    p = _neu(fresh_game)
    zweites = gmod.Game()
    assert [x["id"] for x in zweites.protokolle] == [p["id"]]
    fresh_game.apply({"type": "protokoll_loeschen", "id": p["id"]})
    assert gmod.Game().protokolle == []


def test_protokolle_in_der_sicherung(fresh_game):
    _neu(fresh_game)
    import copy
    daten = copy.deepcopy(fresh_game.export_data())   # wie als Datei gesichert
    fresh_game.apply({"type": "protokoll_loeschen", "id": fresh_game.protokolle[0]["id"]})
    bericht = fresh_game.import_data(daten)
    assert bericht["ok"] and bericht["uebernommen"]["Protokolle"] == 1
    assert fresh_game.protokolle[0]["name"] == "Abend 1"


def test_handy_kommt_nicht_an_unfreigegebenes(fresh_game, monkeypatch):
    import asyncio
    from server import app as appmod

    monkeypatch.setattr(appmod, "game", fresh_game)
    p = _neu(fresh_game)

    class Anfrage:
        def __init__(self, host):
            self.client = type("C", (), {"host": host})()

    async def lesen(host):
        return await appmod.protokoll_lesen(Anfrage(host), p["id"])

    assert asyncio.run(lesen("192.168.1.20")).status_code == 404
    assert asyncio.run(lesen("127.0.0.1")).status_code == 200
    fresh_game.apply({"type": "protokoll_freigeben", "id": p["id"]})
    assert asyncio.run(lesen("192.168.1.20")).status_code == 200
