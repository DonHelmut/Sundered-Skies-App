"""Komplett-Test nach 2.0 (04.11.2026): Lücken der Server-Tests.

- SL-Aktionen, die bisher kein Test anfasste.
- Rechte: ein Handy darf nur die eigene Figur ändern und keine SL-Aktionen.
- Was Handys und Beamer NICHT bekommen dürfen (SL-Notizen, Vorbereitung …).
"""
import asyncio
import json

import pytest

from server import app as A


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)


def _figur(g, name, pid):
    g.apply({"type": "roster_upsert", "name": name, "isWildCard": True})
    return g.add_combatant_from_character(g.roster[-1], pid)


# --- bisher ungetestete SL-Aktionen ------------------------------------------

def test_kampf_loeschen_umbenennen_bild(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork"})
    g.apply({"type": "save_encounter", "name": "Hinterhalt"})
    eid = g.encounters[0]["id"]
    g.apply({"type": "delete_encounter", "id": eid})
    assert g.encounters == []

    ork = g.combatants[0]
    g.apply({"type": "group_create", "ids": [ork["id"]]})
    gid = g.groups[0]["id"]
    g.apply({"type": "group_rename", "group": gid, "name": "  Vorhut  "})
    assert g.groups[0]["name"] == "Vorhut"
    g.apply({"type": "group_rename", "group": gid, "name": "   "})
    assert g.groups[0]["name"] == "Vorhut"          # leer = bleibt

    g.apply({"type": "set_image", "id": ork["id"], "url": "/uploads/ork.png"})
    assert g._combatant(ork["id"])["image"] == "/uploads/ork.png"
    # Nur eigene Uploads - keine fremden Adressen, die jedes Handy lädt.
    g.apply({"type": "set_image", "id": ork["id"], "url": "http://evil.example/x.png"})
    assert g._combatant(ork["id"])["image"] == "/uploads/ork.png"


def test_bild_am_charakter_landet_im_roster(fresh_game):
    g = fresh_game
    c = _figur(g, "Tessa", "p1")
    g.apply({"type": "set_image", "id": c["id"], "url": "/uploads/t.png"})
    assert g.roster[0]["image"] == "/uploads/t.png"


def test_mischen_timer_bennystart_slpool(fresh_game):
    g = fresh_game
    _figur(g, "Tessa", "p1")
    g.apply({"type": "new_round", "runde": 0})
    karten = len(g.deck) + len(g.discard)
    g.apply({"type": "new_round", "runde": 1})
    g.apply({"type": "reshuffle"})
    assert g.discard == [] and len(g.deck) >= karten - 2

    g.apply({"type": "set_timer", "seconds": 9999})
    assert g.timer_seconds == 600
    g.apply({"type": "set_timer", "seconds": "quatsch"})
    assert g.timer_seconds == 600
    g.apply({"type": "set_benny_start", "value": 5})
    assert g.benny_start == 5
    g.apply({"type": "set_benny_start", "value": -3})
    assert g.benny_start == 0

    g.apply({"type": "sl_benny_adjust", "delta": 2})
    g.apply({"type": "sl_benny_adjust", "delta": -5})
    assert g.sl_bennies == 0                         # nie negativ
    g.apply({"type": "sl_benny_adjust", "delta": "x"})
    assert g.sl_bennies == 0


def test_timer_aendern_verlaengert_laufenden_zug(fresh_game):
    g = fresh_game
    _figur(g, "Tessa", "p1")
    g.apply({"type": "new_round", "runde": 0})
    g.apply({"type": "release"})
    alt = g.timer_ends_at
    g.apply({"type": "set_timer", "seconds": 120})
    assert g.timer_ends_at > alt


def test_verlauf_und_beamerbild_leeren(fresh_game):
    g = fresh_game
    g.apply({"type": "message", "target": "all", "text": "Hallo"})
    g.apply({"type": "message", "target": "beamer", "text": "Karte", "imageUrl": "/uploads/k.png"})
    assert g.messages and g.tv_image
    g.apply({"type": "clear_messages"})
    g.apply({"type": "clear_tv_image"})
    assert g.messages == [] and g.tv_image is None


def test_beamerbild_landet_nicht_im_chat(fresh_game):
    g = fresh_game
    g.apply({"type": "message", "target": "beamer", "text": "Nur TV"})
    assert g.messages == [] and g.tv_image["text"] == "Nur TV"


def test_sl_bewegt_frei_spieler_nur_einmal(fresh_game):
    g = fresh_game
    c = _figur(g, "Tessa", "p1")
    start = c["zone"]
    g.apply({"type": "move_zone", "id": c["id"], "dir": 1, "byPlayer": True})
    g.apply({"type": "move_zone", "id": c["id"], "dir": 1, "byPlayer": True})
    nach_spieler = g._combatant(c["id"])["zone"]
    assert nach_spieler != start
    g.apply({"type": "move_zone", "id": c["id"], "dir": 1, "byPlayer": True})
    assert g._combatant(c["id"])["zone"] == nach_spieler          # einmal pro Runde
    g.apply({"type": "move_zone", "id": c["id"], "dir": -1})
    g.apply({"type": "move_zone", "id": c["id"], "dir": -1})
    assert g._combatant(c["id"])["zone"] != nach_spieler          # SL darf immer
    for _ in range(20):
        g.apply({"type": "move_zone", "id": c["id"], "dir": 1})
    rand = g._combatant(c["id"])["zone"]
    g.apply({"type": "move_zone", "id": c["id"], "dir": 1})
    assert g._combatant(c["id"])["zone"] == rand                  # nicht über den Rand


# --- Was Handys und Beamer nicht sehen dürfen --------------------------------

def test_sl_notiz_an_figuren_geht_nicht_an_handys(fresh_game):
    """Bug bis 2.0.0: die SL-Kurznotiz („flieht bei 2 Wunden") stand im Zustand
    jedes Handys und des Beamers - nur die Anzeige war SL-only."""
    g = fresh_game
    c = _figur(g, "Tessa", "p1")
    g.apply({"type": "add_npc", "name": "Ork"})
    ork = next(x for x in g.combatants if x["kind"] == "npc")
    g.apply({"type": "set_note", "id": ork["id"], "note": "flieht bei 2 Wunden"})
    g.apply({"type": "set_note", "id": c["id"], "note": "hat den Schlüssel"})
    sl = json.dumps(g.snapshot(), ensure_ascii=False)
    handy = json.dumps(g.snapshot(fuer_spieler=True, player_id="p1"), ensure_ascii=False)
    assert "flieht bei 2 Wunden" in sl and "hat den Schlüssel" in sl
    assert "flieht" not in handy and "Schlüssel" not in handy
    # Die SL-Fassung bleibt dabei unberührt (keine geteilte Kopie verändert).
    assert g._combatant(ork["id"])["note"] == "flieht bei 2 Wunden"


def test_handy_bekommt_keine_vorbereitung_und_keine_gegnerwerte(fresh_game):
    g = fresh_game
    _figur(g, "Tessa", "p1")
    g.apply({"type": "bestiary_upsert", "name": "Drache", "isWildCard": True})
    g.apply({"type": "add_npc_from_bestiary", "id": g.bestiary[0]["id"], "anon": True})
    g.apply({"type": "save_encounter", "name": "Geheimer Hinterhalt"})
    handy = json.dumps(g.snapshot(fuer_spieler=True, player_id="p1"), ensure_ascii=False)
    assert "Drache" not in handy and "Geheimer Hinterhalt" not in handy


def test_handy_bekommt_nur_eigene_notizen_und_gefluestertes(fresh_game):
    g = fresh_game
    a = _figur(g, "Tessa", "p1")
    _figur(g, "Korgo", "p2")
    g.notizen_setzen(a["id"], [{"id": "n1", "text": "geheim von Tessa"}])
    g.apply({"type": "message", "target": "p1", "text": "nur Tessa"})
    g.apply({"type": "message", "target": ["p1", "p2"], "text": "beide"})
    korgo = json.dumps(g.snapshot(fuer_spieler=True, player_id="p2"), ensure_ascii=False)
    tv = json.dumps(g.snapshot(fuer_spieler=True, player_id=None), ensure_ascii=False)
    assert "geheim von Tessa" not in korgo and "nur Tessa" not in korgo and "beide" in korgo
    assert "nur Tessa" not in tv and "beide" not in tv and "geheim" not in tv


# --- Rechte: Handy darf nur die eigene Figur ---------------------------------

@pytest.fixture
def zwei_handys(fresh_game, monkeypatch):
    monkeypatch.setattr(A, "game", fresh_game)
    g = fresh_game
    tessa = _figur(g, "Tessa", "p1")
    korgo = _figur(g, "Korgo", "p2")
    g.apply({"type": "add_npc", "name": "Ork"})
    g.apply({"type": "new_round", "runde": 0})
    g.resume_available = False
    return g, tessa, korgo


def _als_handy(pid, aktion):
    ws = FakeWS()
    asyncio.run(A.handle_message(ws, {"role": "player", "playerId": pid, "ip": "10.0.0.9"},
                                 {"type": "gm_action", "action": aktion}))


@pytest.mark.parametrize("aktion", [
    {"type": "reveal"},
    {"type": "move_zone", "dir": -1},
    {"type": "set_image", "url": "/uploads/x.png"},
    {"type": "hold"},
])
def test_handy_kann_fremde_figur_nicht_aendern(zwei_handys, aktion):
    g, tessa, korgo = zwei_handys
    vorher = json.dumps(g._combatant(korgo["id"]), sort_keys=True)
    _als_handy("p1", {**aktion, "id": korgo["id"]})
    assert json.dumps(g._combatant(korgo["id"]), sort_keys=True) == vorher


def test_handy_bogen_und_talente_gehen_immer_an_die_eigene_figur(zwei_handys):
    g, tessa, korgo = zwei_handys
    _als_handy("p1", {"type": "sheet_update", "id": korgo["id"], "bogen": {"parade": "9"}})
    _als_handy("p1", {"type": "talents_update", "id": korgo["id"], "talents": ["Schnell"]})
    assert (g._combatant(korgo["id"]).get("bogen") or {}).get("parade") != "9"
    assert "Schnell" not in g._combatant(korgo["id"])["talents"]
    assert g._combatant(tessa["id"])["bogen"]["parade"] == "9"


@pytest.mark.parametrize("aktion", [
    {"type": "add_npc", "name": "Eingeschleust"},
    {"type": "apply_hit"},
    {"type": "message", "target": "all", "text": "Ich bin der SL"},
    {"type": "reset"},
    {"type": "clear_all"},
    {"type": "roster_delete"},
    {"type": "benny_adjust", "delta": 5},
    {"type": "set_active"},
    {"type": "release"},
    {"type": "new_round"},
    {"type": "protokoll_speichern", "text": "Fake"},
    {"type": "undo"},
])
def test_handy_darf_keine_sl_aktionen(zwei_handys, aktion):
    g, tessa, korgo = zwei_handys
    vorher = json.dumps(g.snapshot(), sort_keys=True, default=str)
    _als_handy("p1", {**aktion, "id": korgo["id"]})
    nachher = json.dumps(g.snapshot(), sort_keys=True, default=str)
    # serverNow ändert sich immer - der Rest muss gleich sein.
    weg = lambda s: {k: v for k, v in json.loads(s).items() if k != "serverNow"}  # noqa: E731
    assert weg(nachher) == weg(vorher)


def test_handy_ohne_figur_darf_gar_nichts(zwei_handys):
    """Bug bis 2.0.0: ein Handy ohne Beitritt (playerId None) galt als Besitzer
    der ersten Figur ohne Handy - hier des Orks."""
    g, tessa, korgo = zwei_handys
    ork = next(c for c in g.combatants if c["kind"] == "npc")
    g.apply({"type": "set_active", "id": ork["id"]})
    g.apply({"type": "release"})
    _als_handy(None, {"type": "confirm_turn"})
    zone = g._combatant(ork["id"])["zone"]
    _als_handy(None, {"type": "move_zone", "id": ork["id"], "dir": -1})
    _als_handy(None, {"type": "hold", "id": ork["id"]})
    assert g.active_id == ork["id"] and g._combatant(ork["id"])["zone"] == zone
    assert not g._combatant(ork["id"]).get("held")
    _als_handy("fremd", {"type": "confirm_turn"})
    _als_handy(None, {"type": "notizen_setzen", "eintraege": [{"id": "x", "text": "y"}]})
    _als_handy(None, {"type": "gruppen_notiz", "op": "neu", "eintrag": {"id": "g", "text": "y"}})
    assert g.gruppen_notizen == []


def test_zug_beenden_nur_wer_dran_ist(zwei_handys):
    g, tessa, korgo = zwei_handys
    g.apply({"type": "set_active", "id": tessa["id"]})
    g.apply({"type": "release"})
    _als_handy("p2", {"type": "confirm_turn"})
    assert g.active_id == tessa["id"]
    _als_handy("p1", {"type": "confirm_turn"})
    assert g.active_id != tessa["id"]


def test_kaputte_aktionen_vom_handy_brechen_nichts(zwei_handys):
    g, tessa, korgo = zwei_handys
    for kaputt in [None, [], "x", {"type": None}, {"type": "move_zone", "id": tessa["id"], "dir": "?"},
                   {"type": "sheet_update", "bogen": "kein dict"},
                   {"type": "notizen_setzen", "eintraege": "kein array"},
                   {"type": "gruppen_notiz", "op": "aendern", "id": "gibtsnicht"},
                   {"type": "request", "kind": "attack", "detail": "kaputt"}]:
        try:
            _als_handy("p1", kaputt)
        except Exception as e:  # noqa: BLE001
            pytest.fail(f"{kaputt!r} warf {e!r}")
    assert len(g.combatants) == 3
