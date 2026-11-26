"""⏳ Countdown für alle (Kalle, 23.11.2026): SL setzt „Schiff bricht · 3",
der Server zählt bei jeder neuen Runde runter, alle sehen ihn."""
from server.game import Game


def _kampf(g):
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    g.apply({"type": "new_round"})


def test_zaehlt_pro_runde_runter_und_bleibt_bei_null(fresh_game):
    g = fresh_game
    _kampf(g)
    g.apply({"type": "countdown_setzen", "text": "  Schiff   bricht ", "runden": 2})
    assert g.snapshot()["countdown"] == {"text": "Schiff bricht", "runden": 2}
    g.apply({"type": "new_round"})
    assert g.countdown["runden"] == 1
    g.apply({"type": "new_round"})
    g.apply({"type": "new_round"})
    # Bei 0 bleibt er als „jetzt!" stehen, bis der SL ihn wegnimmt.
    assert g.countdown == {"text": "Schiff bricht", "runden": 0}
    g.apply({"type": "countdown_weg"})
    assert g.snapshot()["countdown"] is None


def test_handys_sehen_ihn(fresh_game):
    g = fresh_game
    _kampf(g)
    g.apply({"type": "countdown_setzen", "text": "Sturm", "runden": 3})
    assert g.snapshot(fuer_spieler=True)["countdown"] == {"text": "Sturm", "runden": 3}


def test_stellen_und_grenzen(fresh_game):
    g = fresh_game
    _kampf(g)
    for falsch in (0, -1, 100, "drei", None, True):
        g.apply({"type": "countdown_setzen", "text": "X", "runden": falsch})
        assert g.countdown is None, falsch
    g.apply({"type": "countdown_setzen", "text": "", "runden": 1})
    assert g.countdown == {"text": "Countdown", "runden": 1}
    g.apply({"type": "countdown_stellen", "delta": -1})
    g.apply({"type": "countdown_stellen", "delta": -1})
    assert g.countdown["runden"] == 0
    g.apply({"type": "countdown_stellen", "delta": 1})
    assert g.countdown["runden"] == 1
    g.apply({"type": "countdown_setzen", "text": "x" * 80, "runden": 5})
    assert len(g.countdown["text"]) == 40


def test_rueckgaengig_und_kampf_beenden(fresh_game):
    g = fresh_game
    _kampf(g)
    g.apply({"type": "countdown_setzen", "text": "Sturm", "runden": 3})
    g.apply({"type": "new_round"})
    g.apply({"type": "undo"})
    assert g.countdown["runden"] == 3
    # Runden gibt es nur im Kampf - im nächsten Kampf liefe er sonst weiter.
    g.apply({"type": "end_combat"})
    assert g.countdown is None


def test_ueberlebt_neustart(fresh_game):
    g = fresh_game
    _kampf(g)
    g.apply({"type": "countdown_setzen", "text": "Sturm", "runden": 4})
    g.save_session()
    neu = Game()
    assert neu.resume_session()
    assert neu.countdown == {"text": "Sturm", "runden": 4}


def test_vor_dem_ersten_austeilen_gesetzt_zaehlt_ab_runde_zwei(fresh_game):
    """Der ⏳ steht schon da, sobald Gegner am Tisch sind. Vor dem Austeilen
    gesetzt („Schiff bricht · 3") stand er in Runde 1 schon auf 2."""
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    g.apply({"type": "countdown_setzen", "text": "Schiff bricht", "runden": 3})
    g.apply({"type": "new_round"})
    assert g.round == 1 and g.countdown["runden"] == 3
    g.apply({"type": "new_round"})
    assert g.countdown["runden"] == 2


def test_effekt_vor_dem_austeilen_verliert_keine_runde(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    pid = g.combatants[0]["id"]
    g.apply({"type": "effect_add", "id": pid, "name": "Gebannt", "runden": 2})
    g.apply({"type": "new_round"})
    assert g.combatants[0]["effekte"][0]["runden"] == 2
