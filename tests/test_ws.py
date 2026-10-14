"""WebSocket-Nachrichtenverarbeitung: Heartbeat + Robustheit gegen Unsinn."""
import asyncio

from server import app as A


class FakeWS:
    """Minimaler WebSocket-Ersatz, der gesendete Nachrichten mitschreibt."""
    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)


def test_ping_returns_pong():
    ws = FakeWS()
    meta = {"role": "gm", "playerId": None}
    asyncio.run(A.handle_message(ws, meta, {"type": "ping"}))
    assert ws.sent == [{"type": "pong"}]


def test_unknown_message_does_not_crash_or_send():
    ws = FakeWS()
    meta = {"role": "gm", "playerId": None}
    # Darf weder werfen noch etwas an den Client schicken.
    asyncio.run(A.handle_message(ws, meta, {"type": "totaler_quatsch", "x": 1}))
    assert ws.sent == []


def test_ping_ignores_extra_fields():
    ws = FakeWS()
    meta = {"role": "player", "playerId": None}
    asyncio.run(A.handle_message(ws, meta, {"type": "ping", "junk": [1, 2, 3]}))
    assert ws.sent == [{"type": "pong"}]


def test_clientlog_is_swallowed_and_silent():
    # Handy-Ausfall-Meldung: darf nichts an den Client senden und nicht crashen.
    ws = FakeWS()
    meta = {"role": "player", "playerId": None, "ip": "192.168.0.5"}
    asyncio.run(A.handle_message(ws, meta, {"type": "clientlog", "event": "wieder verbunden", "gapMs": 8200}))
    assert ws.sent == []


def test_stilles_wiederbeitreten_nur_fuer_bekannte_geraete(fresh_game, monkeypatch):
    """Ein Browser mit gemerkter ID aus einer anderen Installation darf nicht
    ungefragt als Gast auftauchen – ein bekanntes Gerät kommt wieder rein."""
    monkeypatch.setattr(A, "game", fresh_game)
    ws = FakeWS()
    meta = {"role": "player", "playerId": None, "ip": "10.0.0.5"}
    fremd = {"type": "join", "name": "Probe Schnell", "characterId": None, "playerId": "plr-alt", "auto": True}
    asyncio.run(A.handle_message(ws, meta, fremd))
    assert ws.sent[-1] == {"type": "joinError", "grund": "unbekannt", "message": ""}
    assert fresh_game.combatants == [] and fresh_game.players == []

    # Von Hand beitreten (ohne auto) geht, und danach klappt auch das stille Wiederkommen.
    fresh_game.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    fremd["characterId"] = fresh_game.roster[-1]["id"]
    asyncio.run(A.handle_message(ws, meta, {**fremd, "auto": False}))
    assert ws.sent[-1]["type"] == "joined"
    pid = ws.sent[-1]["playerId"]
    ws2 = FakeWS()
    asyncio.run(A.handle_message(ws2, {"role": "player", "playerId": None, "ip": "10.0.0.5"},
                                 {**fremd, "playerId": pid}))
    assert ws2.sent[-1] == {"type": "joined", "playerId": pid}


def test_spieler_setzt_nur_die_eigene_rueckseite(fresh_game, monkeypatch):
    """Die ID kommt vom Server: ein Handy kann nicht die Rückseite eines
    anderen Spielers umstellen, auch wenn es dessen ID schickt."""
    monkeypatch.setattr(A, "game", fresh_game)
    fresh_game.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    fresh_game.apply({"type": "roster_upsert", "name": "Tessa", "isWildCard": True})
    korgo, tessa = fresh_game.roster[-2], fresh_game.roster[-1]
    ich = fresh_game.add_combatant_from_character(korgo, "plr-ich")
    andere = fresh_game.add_combatant_from_character(tessa, "plr-andere")
    meta = {"role": "player", "playerId": "plr-ich", "ip": "10.0.0.5"}
    asyncio.run(A.handle_message(FakeWS(), meta, {"type": "gm_action", "action": {
        "type": "set_figur_rueckseite", "id": andere["id"], "wert": "profil"}}))
    assert ich["rueckseite"] == "profil" and andere["rueckseite"] is None


def test_beitritt_ohne_charakter_abgelehnt(fresh_game, monkeypatch):
    """Kein „Nur zuschauen"/Gast mehr: ohne Charakter wird niemand Figur."""
    monkeypatch.setattr(A, "game", fresh_game)
    ws = FakeWS()
    meta = {"role": "player", "playerId": None, "ip": "10.0.0.6"}
    asyncio.run(A.handle_message(ws, meta, {"type": "join", "name": "Gast", "characterId": None, "playerId": None}))
    assert ws.sent[-1]["type"] == "joinError" and ws.sent[-1]["grund"] == "ohne-charakter"
    assert ws.sent[-1]["message"]
    assert fresh_game.combatants == [] and fresh_game.players == []


def test_stilles_wiederbeitreten_ohne_charakter_ohne_meldung(fresh_game, monkeypatch):
    """Bekanntes Geraet ohne Figur und ohne Charakter-ID (z. B. Charakter
    vergessen): zurueck zur Auswahl, aber ohne Fehlermeldung."""
    monkeypatch.setattr(A, "game", fresh_game)
    fresh_game.players.append({"id": "plr-da", "name": "Stefan", "connected": False, "characterId": None})
    ws = FakeWS()
    meta = {"role": "player", "playerId": None, "ip": "10.0.0.7"}
    asyncio.run(A.handle_message(ws, meta, {"type": "join", "name": "Stefan", "characterId": None,
                                            "playerId": "plr-da", "auto": True}))
    assert ws.sent[-1] == {"type": "joinError", "grund": "ohne-charakter", "message": ""}
    assert fresh_game.combatants == []
