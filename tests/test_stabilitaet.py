"""Stabilitätstest Runde 2: Verbindungsabbrüche, hängende Handys, kaputte Dateien."""
import asyncio
import json

from fastapi.testclient import TestClient

from server import app as A
from server import game as G


class FakeWS:
    def __init__(self, haengt=False):
        self.sent = []
        self.haengt = haengt
        self.geschlossen = False

    async def send_json(self, data):
        if self.haengt:
            await asyncio.sleep(3600)     # Handy nimmt nichts mehr an
        self.sent.append(data)

    async def close(self):
        self.geschlossen = True


def test_haengendes_handy_bremst_die_anderen_nicht(fresh_game, monkeypatch):
    """Ein Handy, dessen Leitung nichts mehr annimmt, liess vorher JEDES
    Verteilen des Spielstands haengen - der ganze Tisch stand still."""
    monkeypatch.setattr(A, "game", fresh_game)
    monkeypatch.setattr(A, "hub", A.Hub())
    monkeypatch.setattr(A, "SENDE_FRIST", 0.2)
    fresh_game.players.append({"id": "plr-weg", "name": "Tessa", "connected": True})
    gut, weg = FakeWS(), FakeWS(haengt=True)

    async def ablauf():
        await A.hub.add(weg, {"role": "player", "playerId": "plr-weg"})
        await A.hub.add(gut, {"role": "player", "playerId": None})
        await asyncio.wait_for(A.hub.broadcast_state(), 2)
        await asyncio.wait_for(A.hub.broadcast_state(), 2)
        await asyncio.sleep(0)

    asyncio.run(ablauf())
    assert len(gut.sent) == 2
    assert weg not in A.hub.sockets                  # aufgegeben, verbindet sich neu
    assert fresh_game.players[0]["connected"] is False


def _client(fresh_game, monkeypatch):
    monkeypatch.setattr(A, "game", fresh_game)
    monkeypatch.setattr(A, "hub", A.Hub())
    fresh_game.resume_available = False
    return TestClient(A.app)


def _bis(ws, typ):
    while True:
        m = ws.receive_json()
        if m.get("type") == typ:
            return m


def test_alte_leitung_stirbt_nach_neuverbinden_spieler_bleibt_online(fresh_game, monkeypatch):
    """Handy verbindet sich neu, BEVOR der Server die alte Leitung beerdigt.
    Deren Ende setzte den Spieler auf „offline" - obwohl er gerade spielt, und
    sein Charakter war fuer jedes andere Geraet frei."""
    with _client(fresh_game, monkeypatch) as c:
        with c.websocket_connect("/ws") as alt:
            alt.send_json({"type": "join", "name": "Tessa", "neuerCharakter": "Tessa"})
            pid = _bis(alt, "joined")["playerId"]
            with c.websocket_connect("/ws") as neu:
                neu.send_json({"type": "join", "name": "Tessa", "playerId": pid, "auto": True,
                               "characterId": fresh_game.roster[0]["id"]})
                _bis(neu, "joined")
                alt.close()
                neu.send_json({"type": "ping"})
                _bis(neu, "pong")
                spieler = [p for p in fresh_game.players if p["id"] == pid]
                assert spieler and spieler[0]["connected"] is True


def test_kaputte_charakterliste_nimmt_die_sicherung(fresh_game):
    """Strom weg beim Speichern: roster.json voller Nullbytes. Vorher startete
    die App mit leerer Liste, und die erste Aenderung ueberschrieb auch noch die
    .bak - alle Charaktere weg."""
    for name in ("Tessa", "Korgo", "Brakk"):
        fresh_game.apply({"type": "roster_upsert", "name": name})
    G.ROSTER_FILE.write_bytes(b"\x00" * 300)

    neu = G.Game()
    assert [r["name"] for r in neu.roster] == ["Tessa", "Korgo"]   # Stand der .bak
    neu.resume_available = False
    neu.apply({"type": "roster_upsert", "name": "Vex"})
    gerettet = json.loads(G.ROSTER_FILE.with_suffix(".json.bak").read_text("utf-8"))
    assert [r["name"] for r in gerettet] == ["Tessa", "Korgo"]       # kein Muell in der .bak
    assert G.ROSTER_FILE.with_suffix(".json.kaputt").exists()


def test_leere_charakterliste_bleibt_leer(fresh_game):
    """Absichtlich geleert ist nicht kaputt: die .bak darf dann nicht zurueckkommen."""
    fresh_game.apply({"type": "roster_upsert", "name": "Tessa"})
    fresh_game.apply({"type": "roster_delete", "id": fresh_game.roster[0]["id"]})
    assert G.Game().roster == []


def test_unlesbare_sitzung_beendet_die_fortsetzen_frage(fresh_game):
    """Sonst blieb „Fortsetzen?" stehen, Spieleraktionen zaehlten nicht, und
    gespeichert wurde den ganzen Abend nichts."""
    for kaputt in ("", "[]", "{nicht json"):
        G.SESSION_FILE.write_text(kaputt, encoding="utf-8")
        g = G.Game()
        assert g.resume_available is True
        assert g.spieler_bekannt("plr-x") is False
        assert g.resume_session() is False
        assert g.resume_available is False
        g.apply({"type": "add_npc", "name": "Ork"})
        assert json.loads(G.SESSION_FILE.read_text("utf-8"))["combatants"]
