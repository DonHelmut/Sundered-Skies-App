"""🩹 Heilen-Runde nach dem Kampf (Kalle, 25.11.2026, Variante A): K.O.-Probe,
Verletzungstabelle, Heilen in der Goldenen Stunde, 5 Tage Rast."""
from server.game import Game, verletzung_aus


def _spieler(g, name):
    g.apply({"type": "roster_upsert", "name": name})
    p = g.register_player(name=name, character_id=g.roster[-1]["id"], existing_player_id=None)
    return p, next(c for c in g.combatants if c.get("playerId") == p["id"])


def _runde(g):
    pt, tessa = _spieler(g, "Tessa")
    pk, korgo = _spieler(g, "Korgo")
    _, mira = _spieler(g, "Mira")
    g.apply({"type": "set_status", "id": tessa["id"], "wounds": 2, "shaken": True})
    g.apply({"type": "set_status", "id": korgo["id"], "wounds": 3, "out": True})
    g.apply({"type": "heilrunde_start"})
    return pt, pk, tessa, korgo, mira


def _c(g, c):
    return g._combatant(c["id"])


def test_start_nur_verletzte_und_angeschlagen_weg(fresh_game):
    g = fresh_game
    _, _, tessa, korgo, mira = _runde(g)
    assert g.heilrunde["ids"] == [tessa["id"], korgo["id"]]
    assert not _c(g, tessa)["status"]["shaken"]
    assert g.snapshot(fuer_spieler=True)["heilrunde"]["goldene"]


def test_heilen_je_heiler_einmal(fresh_game):
    g = fresh_game
    pt, _, tessa, korgo, mira = _runde(g)
    g.apply({"type": "heil_wurf", "id": tessa["id"], "heiler": mira["id"], "erg": "1"})
    assert _c(g, tessa)["status"]["wounds"] == 1
    g.apply({"type": "heil_wurf", "id": tessa["id"], "heiler": mira["id"], "erg": "2"})
    assert _c(g, tessa)["status"]["wounds"] == 1      # Mira war schon dran
    m = g.snapshot(fuer_spieler=True, player_id=pt["id"])["messages"][-1]
    assert m["text"] == "🩹 Mira hat dich geheilt\nNoch 1 Wunde · −1 auf Proben"


def test_ko_probe_verletzung_und_aufwecken(fresh_game):
    g = fresh_game
    _, pk, tessa, korgo, mira = _runde(g)
    g.apply({"type": "heil_verletzung", "id": korgo["id"]})
    assert not _c(g, korgo).get("verletzungen")         # erst die Probe
    g.apply({"type": "heil_ko", "id": korgo["id"], "erg": "ja"})
    g.apply({"type": "heil_verletzung", "id": korgo["id"]})
    g.apply({"type": "heil_verletzung", "id": korgo["id"]})   # nur einmal
    v = _c(g, korgo)["verletzungen"]
    assert len(v) == 1 and v[0]["dauer"] == "wunden"
    char = next(r for r in g.roster if r["id"] == korgo["characterId"])
    assert char["verletzungen"] == v                       # übersteht den Abend
    assert "🦴 Verletzung" in g.snapshot(fuer_spieler=True, player_id=pk["id"])["messages"][-1]["text"]
    # Heilen weckt zuerst auf, Wunden bleiben
    g.apply({"type": "heil_wurf", "id": korgo["id"], "heiler": mira["id"], "erg": "2"})
    st = _c(g, korgo)["status"]
    assert not st["out"] and st["wounds"] == 3
    # Alle Wunden weg -> „bis alle Wunden heil" verschwindet von selbst
    g.apply({"type": "set_status", "id": korgo["id"], "wounds": 0})
    assert _c(g, korgo)["verletzungen"] == []


def test_fehlschlag_bleibt_fuer_immer(fresh_game):
    g = fresh_game
    _, _, tessa, korgo, mira = _runde(g)
    g.apply({"type": "heil_ko", "id": korgo["id"], "erg": "nein"})
    assert g.heilrunde["e"][korgo["id"]]["blutet"]
    g.apply({"type": "heil_verletzung", "id": korgo["id"]})
    g.apply({"type": "heal_players"})
    assert _c(g, korgo)["verletzungen"][0]["dauer"] == "immer"
    vid = _c(g, korgo)["verletzungen"][0]["id"]
    g.apply({"type": "verletzung_weg", "id": korgo["id"], "vid": vid})
    assert _c(g, korgo)["verletzungen"] == []


def test_rast(fresh_game):
    g = fresh_game
    _, _, tessa, korgo, mira = _runde(g)
    g.apply({"type": "heil_rast_wurf", "id": tessa["id"], "erg": "1"})
    assert _c(g, tessa)["status"]["wounds"] == 2            # erst Rast starten
    g.apply({"type": "heil_ko", "id": korgo["id"], "erg": "steig"})
    g.apply({"type": "heil_verletzung", "id": korgo["id"]})
    g.apply({"type": "heil_rast"})
    assert not g.heilrunde["goldene"]
    assert _c(g, korgo)["verletzungen"] == []               # 24 Stunden sind um
    g.apply({"type": "heil_wurf", "id": tessa["id"], "heiler": mira["id"], "erg": "1"})
    assert _c(g, tessa)["status"]["wounds"] == 2            # Goldene Stunde vorbei
    g.apply({"type": "heil_rast_wurf", "id": tessa["id"], "erg": "patzer"})
    assert _c(g, tessa)["status"]["wounds"] == 3
    g.apply({"type": "heil_rast_wurf", "id": korgo["id"], "erg": "2"})
    st = _c(g, korgo)["status"]
    assert not st["out"] and st["wounds"] == 2               # wach + eine Wunde


def test_undo_und_neustart(fresh_game):
    g = fresh_game
    _, _, tessa, korgo, mira = _runde(g)
    g.apply({"type": "heil_wurf", "id": tessa["id"], "heiler": mira["id"], "erg": "1"})
    g.apply({"type": "undo"})
    assert g.heilrunde["e"][tessa["id"]]["heiler"] == []
    g.save_session()
    neu = Game()
    assert neu.resume_session()
    assert neu.heilrunde["ids"] == [tessa["id"], korgo["id"]]
    g.apply({"type": "heilrunde_ende"})
    assert g.heilrunde is None


def test_tabelle():
    assert verletzung_aus(2, 1)[0] == "Unterleib"
    assert verletzung_aus(4, 1, "linker") == ("Arm", "Linker Arm nicht nutzbar")
    assert verletzung_aus(7, 5) == ("Bauch", "Stärke −1 Würfel")
    assert verletzung_aus(10, 1)[0] == "Bein"
    assert verletzung_aus(12, 3) == ("Kopf", "Ein Auge blind")
