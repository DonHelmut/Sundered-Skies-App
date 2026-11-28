"""Geldbörse je Charakter + Gruppenkasse (18.11.2026): Fater, Lose, Münzen.
Lose sind Scheine (bezahlen wie mit Geld), die App rechnet nicht um."""
import json

from server import geld as G
from server.game import Game


def _zwei(g):
    g.apply({"type": "roster_upsert", "id": "char_mira", "name": "Mira", "isWildCard": True})
    g.apply({"type": "roster_upsert", "id": "char_korgo", "name": "Korgo", "isWildCard": True})
    mira = g.register_player("Anna", "char_mira", None)
    korgo = g.register_player("Tim", "char_korgo", None)
    fig = lambda n: next(c for c in g.combatants if c["name"] == n)["id"]  # noqa: E731
    return mira, korgo, fig("Mira"), fig("Korgo")


def _gib(g, char, art, anzahl, nenner=None, wofuer=""):
    """Neues Geld kommt nur vom SL (Spieler können sich nichts selbst geben)."""
    a = {"type": "geld", "was": "geben", "ziele": [char], "art": art, "anzahl": anzahl, "wofuer": wofuer}
    if nenner:
        a["nenner"] = nenner
    g.apply(a)


def _stand(g, pid):
    return g.geld_fuer(pid)["stand"]


def test_spieler_kann_sich_kein_geld_geben(fresh_game):
    """Kalle 20.11.2026: „Spieler können sich selber Geld geben - macht keinen
    Sinn." Weder das alte „einstecken" noch SL-Aktionen gehen vom Handy."""
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    for a in ({"was": "einstecken", "art": "muenzen", "anzahl": 340},
              {"was": "einstecken", "art": "los", "nenner": 1000, "anzahl": 3},
              {"was": "einstecken", "art": "fater", "anzahl": 1},
              {"was": "geben", "ziele": ["char_mira"], "art": "fater", "anzahl": 1},
              {"was": "herausnehmen", "art": "muenzen", "anzahl": 5},   # Kasse leer
              {"was": "einlegen", "art": "muenzen", "anzahl": -5}):     # „negativ einlegen"
        assert not g.geld_spieler(m, a), a
    assert _stand(g, mira["id"]) == G.leerer_stand()
    assert g.gruppenkasse["stand"] == G.leerer_stand()


def test_spieler_aktion_geld_geht_nicht_an_geld_sl():
    """Über den WebSocket landet „type: geld" vom Handy nur in geld_spieler,
    nie in Game.apply (dort wäre es das SL-„geben")."""
    import inspect
    from server import app
    quelle = inspect.getsource(app)
    block = quelle[quelle.index('if atype == "geld":'):][:400]
    assert "game.geld_spieler(" in block and "game.apply(" not in block


def test_bezahlen_und_nie_ins_minus(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "muenzen", 340, wofuer="Lohn")
    _gib(g, "char_mira", "los", 3, nenner=1000)
    _gib(g, "char_mira", "fater", 1)
    assert g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 1000, "anzahl": 2, "wofuer": "Ersatzsegel"})
    assert g.geld_spieler(m, {"was": "bezahlen", "art": "muenzen", "anzahl": 54, "wofuer": "Tanken"})
    s = _stand(g, mira["id"])
    assert s == {"fater": 1, "lose": {"1000": 1}, "muenzen": 286}
    # Mehr bezahlen als da ist: nichts passiert.
    assert not g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 1000, "anzahl": 2})
    assert not g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 2, "anzahl": 1})
    assert not g.geld_spieler(m, {"was": "bezahlen", "art": "fater", "anzahl": 2})
    assert _stand(g, mira["id"]) == s
    # Letztes Los weg -> Wert verschwindet aus der Liste.
    assert g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 1000, "anzahl": 1})
    assert _stand(g, mira["id"])["lose"] == {}
    vl = g.geld_fuer(mira["id"])["verlauf"]
    assert [e["n"] for e in vl] == [340, 3, 1, -2, -54, -1]
    assert vl[3]["wofuer"] == "Ersatzsegel" and vl[3]["nenner"] == 1000 and vl[3]["von"] == "Mira"
    assert _stand(g, korgo["id"]) == G.leerer_stand()


def test_unsinn_wird_abgelehnt(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "muenzen", 10)
    _gib(g, "char_mira", "los", 1, nenner=2)
    for a in ({"was": "bezahlen", "art": "gold", "anzahl": 1},
              {"was": "bezahlen", "art": "muenzen", "anzahl": 0},
              {"was": "bezahlen", "art": "muenzen", "anzahl": -5},
              {"was": "bezahlen", "art": "muenzen", "anzahl": 1.5},
              {"was": "bezahlen", "art": "muenzen", "anzahl": True},
              {"was": "bezahlen", "art": "los", "nenner": 1, "anzahl": 1},
              {"was": "bezahlen", "art": "los", "anzahl": 1},
              {"was": "zaubern", "art": "muenzen", "anzahl": 1}):
        assert not g.geld_spieler(m, a), a
    assert not g.geld_spieler("gibtsnicht", {"was": "bezahlen", "art": "muenzen", "anzahl": 1})
    assert _stand(g, mira["id"]) == {"fater": 0, "lose": {"2": 1}, "muenzen": 10}


def test_gruppenkasse_einlegen_herausnehmen_bezahlen(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "los", 12, nenner=100000)
    assert g.geld_spieler(m, {"was": "einlegen", "art": "los", "nenner": 100000, "anzahl": 10})
    assert not g.geld_spieler(m, {"was": "einlegen", "art": "los", "nenner": 100000, "anzahl": 3})
    assert g.gruppenkasse["stand"]["lose"] == {"100000": 10}
    # Korgo nimmt heraus und bezahlt direkt aus der Kasse.
    assert g.geld_spieler(k, {"was": "herausnehmen", "art": "los", "nenner": 100000, "anzahl": 4})
    assert g.geld_spieler(k, {"was": "kasse_bezahlen", "art": "los", "nenner": 100000, "anzahl": 5, "wofuer": "Reparatur"})
    assert not g.geld_spieler(k, {"was": "kasse_bezahlen", "art": "los", "nenner": 100000, "anzahl": 2})
    assert g.gruppenkasse["stand"]["lose"] == {"100000": 1}
    assert _stand(g, korgo["id"])["lose"] == {"100000": 4}
    assert _stand(g, mira["id"])["lose"] == {"100000": 2}
    kv = g.gruppenkasse["verlauf"]
    assert [(e["von"], e["n"]) for e in kv] == [("Mira", 10), ("Korgo", -4), ("Korgo", -5)]
    assert g.geld_fuer(mira["id"])["verlauf"][-1]["wofuer"] == "In die Gruppenkasse"


def test_spieler_sieht_nur_eigene_boerse_sl_alle(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "muenzen", 777, wofuer="Geheimversteck")
    snap_k = g.snapshot(fuer_spieler=True, player_id=korgo["id"])
    assert "Geheimversteck" not in json.dumps(snap_k, ensure_ascii=False)
    assert "777" not in json.dumps(snap_k["roster"])
    assert snap_k["meinGeld"]["stand"]["muenzen"] == 0 and snap_k["geldAlle"] == {}
    snap_m = g.snapshot(fuer_spieler=True, player_id=mira["id"])
    assert snap_m["meinGeld"]["stand"]["muenzen"] == 777
    sl = g.snapshot()
    assert sl["geldAlle"]["char_mira"]["stand"]["muenzen"] == 777
    assert "gruppenkasse" in snap_k and snap_k["muenzName"] == "Münzen"


def test_sl_gibt_an_jeden_und_nimmt_alles_oder_nichts(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    g.apply({"type": "geld", "was": "geben", "ziele": ["char_mira", "char_korgo", "gruppe"],
             "art": "los", "nenner": 1000, "anzahl": 2, "wofuer": "Beute: Piratenkapitän"})
    assert _stand(g, mira["id"])["lose"] == {"1000": 2} == _stand(g, korgo["id"])["lose"]
    assert g.gruppenkasse["stand"]["lose"] == {"1000": 2}
    assert g.geld_fuer(korgo["id"])["verlauf"][-1]["von"] == "Spielleiter"
    g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 1000, "anzahl": 2})
    # Mira hat keins mehr -> beim Nehmen von beiden passiert gar nichts.
    g.apply({"type": "geld", "was": "nehmen", "ziele": ["char_mira", "char_korgo"],
             "art": "los", "nenner": 1000, "anzahl": 1})
    assert _stand(g, korgo["id"])["lose"] == {"1000": 2}


def test_undo_des_sl_laesst_geld_stehen(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "fater", 2)
    g.apply({"type": "add_npc", "name": "Pirat"})          # ein echter Spielzug (Undo-Ziel)
    g.geld_spieler(m, {"was": "bezahlen", "art": "fater", "anzahl": 1})
    g.apply({"type": "undo"})
    assert _stand(g, mira["id"])["fater"] == 1
    assert not any(c["name"] == "Pirat" for c in g.combatants)


def test_bleibt_nach_neustart_und_beim_bearbeiten(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "muenzen", 5)
    g.geld_spieler(m, {"was": "einlegen", "art": "muenzen", "anzahl": 2})
    g.apply({"type": "set_muenz_name", "name": "  Kupferlinge "})
    g.apply({"type": "roster_upsert", "id": "char_mira", "name": "Mira die Flinke", "isWildCard": True})
    neu = Game()
    assert next(r for r in neu.roster if r["id"] == "char_mira")["geld"]["muenzen"] == 3
    assert neu.gruppenkasse["stand"]["muenzen"] == 2
    assert neu.muenz_name == "Kupferlinge"
    g.apply({"type": "set_muenz_name", "name": ""})
    assert g.muenz_name == "Münzen"


def test_sicherung_nimmt_geld_mit(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "los", 1, nenner=2)
    g.geld_spieler(m, {"was": "einlegen", "art": "los", "nenner": 2, "anzahl": 1})
    daten = json.loads(json.dumps(g.export_data()))
    g.gruppenkasse = G.kasse(None)
    g.import_data(daten)
    assert g.gruppenkasse["stand"]["lose"] == {"2": 1}


def test_stand_bereinigt_kaputte_daten():
    assert G.stand({"fater": -3, "lose": {"1": 4, "x": 2, "20": 0, "50": "3"}, "muenzen": "12"}) == \
        {"fater": 0, "lose": {"50": 3}, "muenzen": 12}
    assert G.stand("Unsinn") == G.leerer_stand()


# --- Stufen je 100 (Kalle 28.11.2026) ---------------------------------------------

def test_geld_ist_ein_betrag_in_funken_wechselgeld_von_selbst(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    _gib(g, "char_mira", "muenzen", 2 * 100 ** 3)                  # 2 Schicksal
    # 5 Dreher bezahlen = 50.000 Funken; Rest 1 Schicksal 95 Dreher.
    assert g.geld_spieler(m, {"was": "bezahlen", "art": "muenzen", "anzahl": 5 * 100 ** 2})
    assert _stand(g, mira["id"])["muenzen"] == 1_950_000
    # Mehr als 1.000 Schicksal am Stück: Tippfehler, abgelehnt.
    assert not g.geld_spieler(m, {"was": "bezahlen", "art": "muenzen", "anzahl": G.MAX_FUNKEN + 1})


def test_lose_auf_stufen(fresh_game):
    g = fresh_game
    mira, korgo, m, k = _zwei(g)
    g.apply({"type": "geld", "was": "geben", "ziele": ["char_mira"], "art": "los", "nenner": 10,
             "stufe": "dreher", "anzahl": 2})
    _gib(g, "char_mira", "los", 1, nenner=10)                      # 1/10 Fater - ein anderer Schein
    assert _stand(g, mira["id"])["lose"] == {"10@dreher": 2, "10": 1}
    assert g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 10, "stufe": "dreher", "anzahl": 2})
    assert not g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 10, "stufe": "dreher", "anzahl": 1})
    assert _stand(g, mira["id"])["lose"] == {"10": 1}
    vl = g.geld_fuer(mira["id"])["verlauf"]
    assert vl[0]["stufe"] == "dreher" and vl[0]["nenner"] == 10 and "stufe" not in vl[1]
    # Unbekannte Stufe: nichts.
    assert not g.geld_spieler(m, {"was": "bezahlen", "art": "los", "nenner": 10, "stufe": "gold", "anzahl": 1})


def test_stand_aus_datei_mit_stufen_losen():
    s = G.stand({"fater": 1, "muenzen": 340, "lose": {"10@dreher": 2, "1000": 3, "5@gold": 1, "x": 2}})
    assert s == {"fater": 1, "muenzen": 340, "lose": {"10@dreher": 2, "1000": 3}}
