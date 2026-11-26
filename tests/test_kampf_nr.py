"""Kampfbeginn (Kalle, 25.11.2026): der Server zählt jeden Kampf, damit die
Handys einmal je Kampf auf den Reiter ⚔ Kampf springen."""


def _austeilen(g):
    g.apply({"type": "new_round"})


def test_zaehlt_nur_den_beginn(fresh_game):
    g = fresh_game
    assert g.snapshot(fuer_spieler=True)["kampfNr"] == 0
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    _austeilen(g)
    erster = g.snapshot(fuer_spieler=True)["kampfNr"]
    assert erster > 0
    # Weitere Runden im selben Kampf: gleiche Nummer.
    _austeilen(g)
    _austeilen(g)
    assert g.kampf_nr == erster
    # Kampf beenden, neuer Kampf: neue Nummer.
    g.apply({"type": "end_combat"})
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    _austeilen(g)
    assert g.kampf_nr > erster


def test_neuer_abend_ohne_fortsetzen_neue_nummer(fresh_game, monkeypatch):
    """Nach „Neu" statt „Fortsetzen" fing der Zähler wieder bei 1 an: ein
    Handy, das „1" vom letzten Abend kannte, sprang nicht auf ⚔ Kampf."""
    from server import game as gmod
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    _austeilen(g)
    alt = g.kampf_nr
    spaeter = gmod.now_ms() + 7 * 24 * 3600 * 1000
    monkeypatch.setattr(gmod, "now_ms", lambda: spaeter)   # eine Woche später
    neu = gmod.Game()                  # App neu gestartet, alte Sitzung verworfen
    neu.discard_saved_session()
    neu.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    neu.apply({"type": "new_round"})
    assert neu.kampf_nr != alt


def test_ueberlebt_neustart(fresh_game):
    """Sonst sprängen nach „Fortsetzen" alle Handys erneut auf ⚔ Kampf."""
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Pirat", "count": 1})
    _austeilen(g)
    g.save_session()
    nr = g.kampf_nr
    g.kampf_nr = 0                     # so, als wäre die App neu gestartet
    assert g.resume_session()
    assert g.kampf_nr == nr
