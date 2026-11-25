"""Kampfbeginn (Kalle, 25.11.2026): der Server zählt jeden Kampf, damit die
Handys einmal je Kampf auf den Reiter ⚔ Kampf springen."""


def _austeilen(g):
    g.apply({"type": "new_round"})


def test_zaehlt_nur_den_beginn(fresh_game):
    g = fresh_game
    assert g.snapshot(fuer_spieler=True)["kampfNr"] == 0
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    _austeilen(g)
    assert g.snapshot(fuer_spieler=True)["kampfNr"] == 1
    # Weitere Runden im selben Kampf: gleiche Nummer.
    _austeilen(g)
    _austeilen(g)
    assert g.kampf_nr == 1
    # Kampf beenden, neuer Kampf: neue Nummer.
    g.apply({"type": "end_combat"})
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    _austeilen(g)
    assert g.kampf_nr == 2


def test_ueberlebt_neustart(fresh_game):
    """Sonst sprängen nach „Fortsetzen" alle Handys erneut auf ⚔ Kampf."""
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    _austeilen(g)
    g.save_session()
    g.kampf_nr = 0                     # so, als wäre die App neu gestartet
    assert g.resume_session()
    assert g.kampf_nr == 1
