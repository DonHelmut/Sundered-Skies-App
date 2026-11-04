"""Funde aus dem Stresstest vor 2.0 (04.11.2026)."""
import asyncio

from server import app as A
from server import game as G


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)


def _figur(g, name, pid):
    g.apply({"type": "roster_upsert", "name": name, "isWildCard": True})
    return g.add_combatant_from_character(g.roster[-1], pid)


def test_rueckgaengig_nimmt_spieler_notizen_und_bogen_nicht_mit(fresh_game):
    """Das ↶ des SL stellte die ganze Charakterliste von vor seiner letzten
    Aktion wieder her - Notizen und Bogen, die ein Handy seitdem gespeichert
    hatte, waren weg."""
    g = fresh_game
    c = _figur(g, "Korgo", "p1")
    g.apply({"type": "add_npc", "name": "Ork"})
    g.notizen_setzen(c["id"], [{"id": "n1", "text": "Der Wirt lügt"}])
    g.bogen_setzen(c["id"], {"parade": "7"})
    g.figur_rueckseite_setzen(c["id"], "profil")
    g.apply({"type": "undo"})
    char = g.roster[-1]
    assert [n["text"] for n in char["notizen"]] == ["Der Wirt lügt"]
    assert char["bogen"]["parade"] == "7" and g._combatant(c["id"])["bogen"]["parade"] == "7"
    assert char["rueckseite"] == "profil" and g._combatant(c["id"])["rueckseite"] == "profil"
    # Der Ork (die eigentliche SL-Aktion) ist trotzdem zurückgenommen.
    assert not any(x.get("kind") == "npc" for x in g.combatants)


def test_doppeltes_zug_ende_ueberspringt_niemanden(fresh_game):
    g = fresh_game
    _figur(g, "A", "pa")
    _figur(g, "B", "pb")
    _figur(g, "C", "pc")
    g.apply({"type": "new_round", "runde": 0})
    erster = g.active_id
    g.apply({"type": "release"})
    ende = g.timer_ends_at
    # Spieler beendet selbst, im selben Moment läuft beim SL der Timer ab
    # und er drückt auch noch die Leertaste.
    g.apply({"type": "confirm_turn", "fuer": erster})
    zweiter = g.active_id
    g.apply({"type": "timeout", "fuer": erster, "endsAt": ende})
    g.apply({"type": "confirm_turn", "fuer": erster})
    assert g.active_id == zweiter and not g._combatant(zweiter)["done"]


def test_timeout_eines_angehaltenen_oder_alten_timers_zaehlt_nicht(fresh_game):
    g = fresh_game
    _figur(g, "A", "pa")
    _figur(g, "B", "pb")
    g.apply({"type": "new_round"})
    erster = g.active_id
    g.apply({"type": "release"})
    g.apply({"type": "timeout", "fuer": erster, "endsAt": 123})   # alte Uhr
    assert g.active_id == erster
    g.apply({"type": "timeout", "fuer": erster, "endsAt": g.timer_ends_at})
    assert g.active_id != erster


def test_neue_runde_doppelt_geklickt_zaehlt_einmal(fresh_game):
    g = fresh_game
    _figur(g, "A", "pa")
    g.apply({"type": "new_round", "runde": 0})
    g.apply({"type": "new_round", "runde": 0})
    assert g.round == 1
    g.apply({"type": "new_round"})          # altes Gerät ohne Angabe: wie bisher
    assert g.round == 2


def test_verlassen_vor_dem_fortsetzen_kostet_nicht_den_kampf(fresh_game, monkeypatch):
    monkeypatch.setattr(A, "game", fresh_game)
    g = fresh_game
    c = _figur(g, "Korgo", "plr-1")
    g.players.append({"id": "plr-1", "name": "Stefan", "connected": True, "characterId": c["characterId"]})
    g.apply({"type": "add_npc", "name": "Ork"})
    g.save_session()
    # Neustart: Sitzung wartet auf „Fortsetzen?", das Handy meldet sich wieder an.
    g2 = G.Game()
    monkeypatch.setattr(A, "game", g2)
    assert g2.resume_available
    ws, meta = FakeWS(), {"role": "player", "playerId": None, "ip": "10.0.0.5"}
    asyncio.run(A.handle_message(ws, meta, {"type": "join", "name": "Stefan",
                                            "characterId": c["characterId"], "playerId": "plr-1"}))
    asyncio.run(A.handle_message(ws, meta, {"type": "leave"}))
    assert g2.resume_available
    assert g2.resume_session()
    assert any(x.get("name") == "Ork" for x in g2.combatants)
    assert not next(p for p in g2.players if p["id"] == "plr-1")["connected"]


def test_auto_sicherung_nur_bei_aenderung_und_hoechstens_zehn(tmp_path, monkeypatch):
    """Kalle: etwa stündlich, still, ältere löschen - nicht stetig wachsen."""
    from server import sicherung as S
    ordner, uploads = tmp_path / "sicherungen", tmp_path / "uploads"
    uploads.mkdir()
    daten = {"roster": [{"id": "c1", "name": "Korgo"}]}
    assert S.auto_sichern(daten, uploads, ordner) is not None
    assert S.auto_sichern(daten, uploads, ordner) is None      # nichts geändert
    for i in range(14):
        daten = {"roster": [{"id": "c1", "name": f"Korgo {i}"}]}
        assert S.auto_sichern(daten, uploads, ordner)
    liste = S.auto_liste(ordner)
    assert len(liste) == S.AUTO_BEHALTEN
    neueste, _ = S.lies_sicherung((ordner / liste[0]["name"]).read_bytes(), uploads)
    assert neueste["roster"][0]["name"] == "Korgo 13"


def test_sicherung_zurueckholen_sichert_vorher_den_jetzigen_stand(fresh_game, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import sicherung as S
    monkeypatch.setattr(A, "game", fresh_game)
    monkeypatch.setattr(A, "SICHERUNG_DIR", tmp_path / "sich")
    monkeypatch.setattr(A, "UPLOAD_DIR", tmp_path)
    fresh_game.apply({"type": "roster_upsert", "name": "Korgo"})
    alt = S.auto_sichern(fresh_game.export_data(), tmp_path, tmp_path / "sich")
    fresh_game.apply({"type": "roster_delete", "id": fresh_game.roster[0]["id"]})   # Bedienfehler
    c = TestClient(A.app, client=("127.0.0.1", 5000))   # = der SL-Laptop
    assert [e["name"] for e in c.get("/api/sicherungen").json()["liste"]] == [alt.name]
    assert c.post(f"/api/sicherungen/zurueck/{alt.name}").json()["ok"]
    assert [r["name"] for r in fresh_game.roster] == ["Korgo"]
    assert len(S.auto_liste(tmp_path / "sich")) == 2                # Stand davor gesichert
    assert c.post("/api/sicherungen/zurueck/session.json").status_code == 404   # nur auto-*.zip
