"""Prüfung 05.11.2026 („Überprüfe, was noch nicht geprüft wurde"): Lücken im
LAN-Schutz, die die bisherigen Tests nicht abgedeckt haben."""
import asyncio

from server import app as A


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)


def _beitreten(game, name, msg_extra=None):
    ws = FakeWS()
    meta = {"role": "player", "playerId": None, "ip": "10.0.0.9"}
    char = next(r for r in game.roster if r["name"] == name)
    asyncio.run(A.handle_message(ws, meta, {"type": "join", "name": name, "characterId": char["id"],
                                            **(msg_extra or {})}))
    return ws, meta


# --- /uploads: nur echte Bildnamen -----------------------------------------------

def test_uploads_liefert_nur_bildnamen(tmp_path, monkeypatch):
    """Unter Windows ersetzt pathlib bei „ordner / 'C:\\…'" den ganzen Pfad -
    die alte Prüfung (nur „..") ließ so jede Datei des Laptops raus."""
    monkeypatch.setattr(A, "UPLOAD_DIR", tmp_path)
    (tmp_path / ("a" * 32 + ".png")).write_bytes(b"\x89PNG")
    (tmp_path / "geheim.json").write_text("{}")
    # Direkt aufrufen statt TestClient (braucht ein Zusatzpaket, das auf
    # GitHub fehlt). Starlette reicht den Namen schon entschlüsselt durch.
    holen = lambda name: asyncio.run(A.serve_upload(name)).status_code
    assert holen("a" * 32 + ".png") == 200
    for boese in ("geheim.json", "C:\\Windows\\win.ini", "\\Windows\\win.ini",
                  "..\\..\\session.json", "x.png\x00.json", ".png"):
        assert holen(boese) == 404, boese


def test_upload_name_muster():
    assert A.UPLOAD_NAME.match("0123456789abcdef0123456789abcdef.webp")
    for boese in (r"C:\Windows\win.ini", r"\Users\x.png", "../x.png", "a/b.png", "x.svg", "x.html"):
        assert not A.UPLOAD_NAME.match(boese), boese


# --- Fremde Webseite im Browser des SL ist nicht der SL -------------------------

class _Anfrage:
    def __init__(self, host, origin=None):
        self.client = type("C", (), {"host": host})()
        self.headers = {"origin": origin} if origin else {}


def test_fremde_webseite_auf_dem_laptop_ist_kein_sl():
    assert A._is_loopback(_Anfrage("127.0.0.1"))
    assert A._is_loopback(_Anfrage("127.0.0.1", "http://localhost:8000"))
    assert A._is_loopback(_Anfrage("::1", "http://127.0.0.1:8001"))
    assert A._is_loopback(_Anfrage("127.0.0.1", "http://[::1]:8000"))
    assert not A._is_loopback(_Anfrage("127.0.0.1", "https://boese.example"))
    assert not A._is_loopback(_Anfrage("127.0.0.1", "null"))
    assert not A._is_loopback(_Anfrage("192.168.0.5"))


def test_fremde_webseite_kann_nichts_einspielen():
    r = asyncio.run(A.aufnahme_loeschen(_Anfrage("127.0.0.1", "https://boese.example"), "2026-01-01_20-00"))
    assert r.status_code == 403


# --- Spieler-ID allein reicht nicht zum Übernehmen -------------------------------

def test_fremde_spieler_id_uebernimmt_keine_figur(fresh_game, monkeypatch):
    """Jedes Handy sieht die Spieler-IDs aller (an den Figuren). Wer sie im
    Browser gegen die eines anderen tauschte, wurde zu diesem Spieler -
    mit dessen Geflüstertem und privaten Notizen."""
    monkeypatch.setattr(A, "game", fresh_game)
    fresh_game.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    fresh_game.apply({"type": "roster_upsert", "name": "Tessa", "isWildCard": True})
    ws_k, _ = _beitreten(fresh_game, "Korgo")
    korgo_id = ws_k.sent[-1]["playerId"]
    _beitreten(fresh_game, "Tessa")

    # Schlüssel steht nirgends im Zustand.
    for fuer_spieler in (True, False):
        assert all("schluessel" not in p for p in fresh_game.snapshot(fuer_spieler=fuer_spieler)["players"])

    # Tessas Handy gibt sich als Korgo aus - still und per Tipp.
    ws, meta = FakeWS(), {"role": "player", "playerId": None, "ip": "10.0.0.66"}
    asyncio.run(A.handle_message(ws, meta, {"type": "join", "name": "x", "characterId": None,
                                            "playerId": korgo_id, "auto": True}))
    assert ws.sent[-1]["type"] == "joinError" and meta["playerId"] is None
    asyncio.run(A.handle_message(ws, meta, {"type": "join", "name": "x", "characterId": None,
                                            "playerId": korgo_id, "schluessel": "falsch" * 4}))
    assert meta["playerId"] != korgo_id
    korgo_fig = next(c for c in fresh_game.combatants if c["name"] == "Korgo")
    assert korgo_fig["playerId"] == korgo_id


def test_eigenes_handy_kommt_mit_schluessel_wieder(fresh_game, monkeypatch):
    monkeypatch.setattr(A, "game", fresh_game)
    fresh_game.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    ws, _ = _beitreten(fresh_game, "Korgo")
    pid, schl = ws.sent[-1]["playerId"], ws.sent[-1]["schluessel"]
    assert len(schl) >= 16
    ws2, meta2 = FakeWS(), {"role": "player", "playerId": None, "ip": "10.0.0.9"}
    asyncio.run(A.handle_message(ws2, meta2, {"type": "join", "name": "Korgo", "characterId": None,
                                              "playerId": pid, "schluessel": schl, "auto": True}))
    assert ws2.sent[-1] == {"type": "joined", "playerId": pid, "schluessel": schl}


def test_alte_handys_ohne_schluessel_bekommen_einen(fresh_game, monkeypatch):
    """Spieler von vor 2.0.2 (Sitzung ohne Schlüssel) kommen nach dem Update
    normal wieder rein und sind ab dann geschützt."""
    monkeypatch.setattr(A, "game", fresh_game)
    fresh_game.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    korgo = fresh_game.roster[-1]
    fresh_game.players.append({"id": "plr-alt", "name": "Kalle", "connected": False, "characterId": korgo["id"]})
    fresh_game.add_combatant_from_character(korgo, "plr-alt")
    ws, meta = FakeWS(), {"role": "player", "playerId": None, "ip": "10.0.0.9"}
    asyncio.run(A.handle_message(ws, meta, {"type": "join", "name": "Kalle", "characterId": korgo["id"],
                                            "playerId": "plr-alt", "auto": True}))
    assert ws.sent[-1]["type"] == "joined" and ws.sent[-1]["playerId"] == "plr-alt"
    assert fresh_game.players[0]["schluessel"] == ws.sent[-1]["schluessel"]
    assert not fresh_game.schluessel_passt("plr-alt", None)


def test_schluessel_ueberlebt_neustart_und_fortsetzen(fresh_game, monkeypatch):
    """Nach dem Neustart meldet sich das Handy vor dem „Fortsetzen" mit seinem
    Schlüssel - gegen die gespeicherte Sitzung geprüft - und behält ihn."""
    monkeypatch.setattr(A, "game", fresh_game)
    fresh_game.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    ws, _ = _beitreten(fresh_game, "Korgo")
    pid, schl = ws.sent[-1]["playerId"], ws.sent[-1]["schluessel"]
    fresh_game.save_session()
    # „Neustart": leerer Stand, Sitzung wartet auf Fortsetzen.
    fresh_game.players, fresh_game.combatants = [], []
    fresh_game.resume_available = True
    assert not fresh_game.schluessel_passt(pid, "falsch" * 4)
    ws2, meta2 = FakeWS(), {"role": "player", "playerId": None, "ip": "10.0.0.9"}
    asyncio.run(A.handle_message(ws2, meta2, {"type": "join", "name": "Korgo", "characterId": fresh_game.roster[-1]["id"],
                                              "playerId": pid, "schluessel": schl, "auto": True}))
    assert ws2.sent[-1]["type"] == "joined" and ws2.sent[-1]["schluessel"] == schl
    assert fresh_game.resume_session()
    assert fresh_game.schluessel_passt(pid, schl)
    p = next(x for x in fresh_game.players if x["id"] == pid)
    assert p["connected"] and p["schluessel"] == schl
