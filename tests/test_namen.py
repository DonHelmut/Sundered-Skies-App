"""Eigennamen-Korrektur der Mitschrift (server/namen.py)."""
from server.namen import Namenskorrektur, koelner, namen_aus_spiel, namen_bereinigen

NAMEN = ["Korgo", "Tessa", "Mira", "Sturmvogel", "Krauzern", "Kapitän Branok", "Vexmoor",
         "Skrael", "Aldric", "Ork 3", "Wolkenhai", "Darius", "Thorin"]


def test_hoerfehler_werden_zu_namen():
    k = Namenskorrektur(NAMEN)
    # Echte Hörfehler aus dem Test mit erzeugten Stimmen / vom Jonsbo.
    assert k.korrigieren("Kogo stellt sich an den Bug.") == "Korgo stellt sich an den Bug."
    assert k.korrigieren("Die Sturm Vogel gleitet.") == "Die Sturmvogel gleitet."
    assert k.korrigieren("Kapitän Branno kratzt sich.") == "Kapitän Branok kratzt sich."
    assert k.korrigieren("Wechsmoor hat uns geschickt") == "Vexmoor hat uns geschickt"
    assert k.korrigieren("auf Krautzern gelandet") == "auf Krauzern gelandet"
    assert k.korrigieren("Kogos Axt") == "Korgos Axt"          # Genitiv bleibt


def test_echte_woerter_bleiben_stehen():
    k = Namenskorrektur(NAMEN)
    # Ohne Wörterbuch wurden genau diese zu Namen (Mira, Darius, Krauzern …).
    satz = "Mir ist kalt. Daraus folgt nichts. Der Kreuzer kommt. Wolken ziehen. Theorien gibt es. Tasse Tee."
    assert k.korrigieren(satz) == satz
    assert k.korrigieren("korgo klein geschrieben") == "korgo klein geschrieben"


def test_koelner_phonetik():
    assert koelner("Meier") == koelner("Mayr") == "67"
    assert koelner("Wechsmoor") == koelner("Vexmoor")
    assert koelner("Müller-Lüdenscheidt") == "65752682"


def test_namen_bereinigen_nummern_anzahl_und_teile():
    n = namen_bereinigen(["Ork 3", "3× Ork", "Kapitän Branok", "", "Al", None])
    assert "Ork" in n and "Branok" in n and "Kapitän Branok" in n
    assert n.count("Ork") == 1 and "Al" not in n and "Kapitän" not in n


def test_namen_aus_spiel(fresh_game):
    g = fresh_game
    g.combatants = [{"name": "Korgo", "playerName": "Tim", "kind": "player"}, {"name": "Ork 2", "kind": "npc"}]
    g.bestiary = [{"name": "Wolkenhai"}]
    assert {"Korgo", "Tim", "Ork 2", "Wolkenhai"} <= set(namen_aus_spiel(g))
