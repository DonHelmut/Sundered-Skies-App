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
