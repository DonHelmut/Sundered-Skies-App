"""🎛 Teile der App an/aus („Was nutzen wir heute?", Kalle 08.11.2026)."""
from server import game as gmod


def _held_und_feind(g):
    g.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    g.apply({"type": "add_from_roster", "id": g.roster[-1]["id"]})
    held = g.combatants[-1]
    g.apply({"type": "add_npc", "name": "Feind"})
    return held, g.combatants[-1]


def test_standard_alles_an(fresh_game):
    f = fresh_game.snapshot()["funktionen"]
    assert set(f) == set(gmod.FUNKTIONEN) and all(f.values())


def test_nur_reihenfolge_bleibt_gespeichert(fresh_game):
    nur = {"zonen": True, "angriff": False, "wunden": False, "zustaende": False,
           "bennies": False, "anfragen": False, "regeln": False}
    fresh_game.apply({"type": "set_funktionen", "werte": nur})
    snap = fresh_game.snapshot()
    assert snap["funktionen"]["angriff"] is False and snap["funktionen"]["wunden"] is False
    assert snap["funktionen"]["aufnahme"] is True            # nicht Teil der Vorlage
    assert snap["conditionsEnabled"] is False and snap["requestsEnabled"] is False
    # Neustart: kommt aus settings.json zurück.
    neu = gmod.Game()
    assert neu.funktionen["angriff"] is False and neu.funktionen["bennies"] is False
    assert neu.conditions_enabled is False
    # Unbekanntes wird ignoriert, Unsinn bricht nichts.
    fresh_game.apply({"type": "set_funktionen", "werte": {"unsinn": True}})
    fresh_game.apply({"type": "set_funktionen", "werte": "kaputt"})
    assert "unsinn" not in fresh_game.snapshot()["funktionen"]


def test_treffer_braucht_wunden(fresh_game):
    fresh_game.apply({"type": "set_funktionen", "werte": {"wunden": False}})
    assert fresh_game.funktionen["angriff"] is False
    fresh_game.apply({"type": "set_funktionen", "werte": {"angriff": True}})
    assert fresh_game.funktionen["wunden"] is True


def test_angriff_aus_keine_angriffe_vom_handy(fresh_game):
    held, feind = _held_und_feind(fresh_game)
    angriff = {"type": "request", "combatantId": held["id"], "kind": "attack", "detail": {"targetId": feind["id"]}}
    fresh_game.apply(angriff)
    assert [r["kind"] for r in fresh_game.requests] == ["attack"]
    fresh_game.apply({"type": "set_funktionen", "werte": {"angriff": False}})
    assert fresh_game.requests == []                          # offene Angriffe weg
    fresh_game.apply(angriff)
    assert fresh_game.requests == []


def test_timer_aus_zug_ohne_uhr(fresh_game):
    held, _ = _held_und_feind(fresh_game)
    fresh_game.apply({"type": "new_round"})
    fresh_game.apply({"type": "set_active", "id": held["id"]})
    fresh_game.apply({"type": "release"})
    assert fresh_game.timer_ends_at is not None
    fresh_game.apply({"type": "set_funktionen", "werte": {"timer": False}})
    assert fresh_game.timer_ends_at is None and fresh_game.phase == "running"
    fresh_game.apply({"type": "confirm_turn"})
    fresh_game.apply({"type": "release"})
    assert fresh_game.phase == "running" and fresh_game.timer_ends_at is None


def test_umschalten_ist_kein_spielzug(fresh_game):
    """Vor „Fortsetzen?" umschalten darf den gespeicherten Kampf nicht verwerfen
    und landet nicht im Rückgängig."""
    fresh_game.resume_available = True
    fresh_game.apply({"type": "set_funktionen", "werte": {"angriff": False}})
    assert fresh_game.resume_available is True
    assert fresh_game.snapshot()["canUndo"] is False
