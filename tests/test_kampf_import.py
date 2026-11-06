"""Kampf aus Text (Gemini & Co.) – Lesen, Anlegen, Fortsetzen bleibt."""
from server import game as gmod
from server.kampf_import import anleitung, kampf_aus_text

T = gmod.TALENTS

SAUBER = """KAMPF: Überfall der Wolkenpiraten
NOTIZ: Kapitän greift erst in Runde 2 ein

GEGNER: Wolkenpirat
ANZAHL: 4
WILDCARD: nein
PARADE: 5
ROBUSTHEIT: 6 (1)
ZONE: Nahbereich
WERTE: Ge W6, Ve W4, Wi W6, St W6, Kö W6
Kämpfen W6, Schießen W6, Entermesser St+W6

GEGNER: Kapitän Varsk
ANZAHL: 1
WILDCARD: ja
PARADE: 7
ROBUSTHEIT: 8 (2)
ZONE: Fernbereich
VERDECKT: ja
TALENTE: Kühler Kopf, Erstschlag
WERTE: Kämpfen W10, Säbel St+W8
"""


def test_sauberes_format():
    r = kampf_aus_text(SAUBER, T)
    assert r["warnungen"] == []
    (k,) = r["kaempfe"]
    assert k["name"] == "Überfall der Wolkenpiraten"
    assert k["note"] == "Kapitän greift erst in Runde 2 ein"
    pirat, kapitaen = k["gruppen"]
    assert (pirat["name"], pirat["anzahl"], pirat["isWildCard"]) == ("Wolkenpirat", 4, False)
    assert (pirat["parade"], pirat["robustheit"], pirat["panzer"], pirat["zone"]) == (5, 6, 1, 1)
    assert "Entermesser St+W6" in pirat["spielwerte"] and "Ge W6" in pirat["spielwerte"]
    assert kapitaen["isWildCard"] and kapitaen["anon"] and kapitaen["zone"] == 2
    assert kapitaen["talents"] == ["kuehler_kopf"]
    # Kein App-Talent -> trotzdem auf dem Spickzettel.
    assert "Erstschlag" in kapitaen["spielwerte"]


def test_ki_zierrat_und_einzeiler():
    """So schreiben KIs wirklich: Geplauder, Markdown, alles in einer Zeile."""
    text = """Klar! Hier ist dein Kampf:

```
## **Kampf:** Hai-Angriff
* **Gegner:** Himmelshai x2
* Parade 6; Robustheit 9 (2); Zone: nah
- **Wild Card:** Nein
- **Angriffe:** Biss St+W8
```
Viel Spaß beim Spielen!"""
    (k,) = kampf_aus_text(text, T)["kaempfe"]
    assert k["name"] == "Hai-Angriff"
    (hai,) = k["gruppen"]
    assert (hai["name"], hai["anzahl"]) == ("Himmelshai", 2)
    assert (hai["parade"], hai["robustheit"], hai["panzer"], hai["zone"]) == (6, 9, 2, 1)
    assert "Angriffe: Biss St+W8" in hai["spielwerte"]


def test_mehrere_kaempfe_verbuendete_und_grenzen():
    text = """KAMPF: Eins
GEGNER: 3x Skree
ZONE: Weitbereich
VERBÜNDETER: Lotse Brann
VERDECKT: ja
KAMPF: Zwei
GEGNER: Golem
ANZAHL: 99
ZONE: Mondlandschaft"""
    r = kampf_aus_text(text, T)
    eins, zwei = r["kaempfe"]
    assert eins["gruppen"][0]["anzahl"] == 3 and eins["gruppen"][0]["zone"] == 3
    brann = eins["gruppen"][1]
    assert brann["ally"] and not brann["anon"]          # Verbündete nie verdeckt
    assert zwei["gruppen"][0]["anzahl"] == 20
    assert zwei["gruppen"][0]["zone"] == 1
    assert len(r["warnungen"]) == 2


def test_diktiert_nur_name_und_anzahl():
    """Kalle: aus dem Auto nur „Kampf, Gegner, Anzahl" - mehr nicht."""
    for text in ("Kampf: Überfall der Wolkenpiraten\nGegner Wolkenpirat\nAnzahl 4",
                 "Kampf Überfall der Wolkenpiraten\nGegner: Wolkenpirat, Anzahl: 4",
                 "KAMPF: Überfall der Wolkenpiraten\nGEGNER: Wolkenpirat Anzahl 4"):
        r = kampf_aus_text(text, T)
        (k,) = r["kaempfe"]
        (g,) = k["gruppen"]
        assert (k["name"], g["name"], g["anzahl"]) == ("Überfall der Wolkenpiraten", "Wolkenpirat", 4), text
        assert g["parade"] is None and g["spielwerte"] == "" and g["zone"] == 1
        assert r["warnungen"] == []


def test_kurzform_nur_namen_und_zahlen():
    """Kalle: „kampfpirat 3, Chefpirat 1, orks 2" in die .txt - das reicht."""
    for text in ("kampfpirat 3, Chefpirat 1, orks 2",
                 "kampfpirat 3\nChefpirat\n2 orks",
                 "Hier ist dein Kampf:\n- **kampfpirat x3**\n- Chefpirat 1 und orks 2"):
        (k,) = kampf_aus_text(text, T)["kaempfe"]
        assert [(g["name"], g["anzahl"]) for g in k["gruppen"]] == [
            ("kampfpirat", 3), ("Chefpirat", 1), ("orks", 2)], text
        assert k["name"] == "kampfpirat ×3, Chefpirat, orks ×2"
    (k,) = kampf_aus_text("KAMPF: Hafen\nkampfpirat 3, Chefpirat 1", T)["kaempfe"]
    assert k["name"] == "Hafen" and len(k["gruppen"]) == 2


def test_werte_kommen_aus_der_bibliothek(fresh_game):
    g = fresh_game
    g.apply({"type": "bestiary_upsert", "name": "Wolkenpirat", "parade": 5, "robustheit": 6,
             "panzer": 1, "spielwerte": "Entermesser St+W6", "gluck": True})
    vorlage = g.bestiary[0]
    text = "KAMPF: Überfall\nGEGNER: wolkenpirat\nANZAHL: 3\nGEGNER: Kapitän"
    vorschau = g.kampf_import_vorschau(text)
    assert [x["inBibliothek"] for x in vorschau["kaempfe"][0]["gruppen"]] == [True, False]
    g.apply({"type": "encounter_import", "text": text, "bibliothek": False})
    piraten = [m for m in g.encounters[0]["members"] if m["vorlage"] == vorlage["id"]]
    assert len(piraten) == 3
    assert all((m["parade"], m["robustheit"], m["panzer"]) == (5, 6, 1) for m in piraten)
    assert all(m["gluck"] and m["name"] == "Wolkenpirat" for m in piraten)
    # Ohne Häkchen keine neue Vorlage, Vorlage selbst unverändert.
    assert len(g.bestiary) == 1 and g.bestiary[0] == vorlage
    # Mit Häkchen: Kapitän neu (leer, Werte später), Pirat bleibt wie er war.
    g.apply({"type": "encounter_import", "text": text, "bibliothek": True})
    assert [b["name"] for b in g.bestiary] == ["Wolkenpirat", "Kapitän"]
    assert g.bestiary[0]["parade"] == 5 and g.bestiary[0]["spielwerte"] == "Entermesser St+W6"


def test_ohne_gegner_gibt_warnung():
    r = kampf_aus_text("Hallo, ich bin Gemini.", T)
    assert r["kaempfe"] == []
    r = kampf_aus_text("KAMPF: Leer", T)
    assert r["kaempfe"] == [] and r["warnungen"]


def test_import_legt_kampf_und_vorlagen_an(fresh_game):
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Tessa"})
    g.apply({"type": "bestiary_upsert", "name": "wolkenpirat", "parade": 4, "gluck": True})
    g.apply({"type": "encounter_import", "text": SAUBER, "bibliothek": True})
    (enc,) = g.encounters
    assert enc["name"] == "Überfall der Wolkenpiraten"
    assert len(enc["members"]) == 5
    assert enc["charaktere"] == [{"characterId": g.roster[0]["id"], "zone": gmod.DEFAULT_ZONE_PLAYER}]
    # Gleichnamige Vorlage aufgefrischt (Glück bleibt), Kapitän neu.
    assert len(g.bestiary) == 2
    pirat = next(b for b in g.bestiary if b["name"] == "wolkenpirat")   # Name der Vorlage bleibt
    assert pirat["parade"] == 5 and pirat["gluck"] and "Entermesser" in pirat["spielwerte"]
    assert all(m["vorlage"] for m in enc["members"])
    # Starten bringt Werte und Verdeckt in den Kampf.
    g.apply({"type": "start_encounter", "id": enc["id"]})
    npcs = [c for c in g.combatants if c.get("kind") == "npc"]
    assert len(npcs) == 5
    kap = next(c for c in npcs if c["name"].startswith("Kapitän"))
    assert kap["anon"] and kap["robustheit"] == 8 and kap["panzer"] == 2


def test_import_ohne_bibliothek(fresh_game):
    g = fresh_game
    g.apply({"type": "encounter_import", "text": SAUBER, "bibliothek": False})
    assert g.bestiary == [] and len(g.encounters) == 1
    assert "Säbel" in next(m for m in g.encounters[0]["members"] if m["isWildCard"])["spielwerte"]


def test_bibliothek_pflegen_laesst_fortsetzen_stehen(fresh_game):
    """Am Spielabend erst den Kampf einfügen, DANN „Fortsetzen" - der
    gespeicherte Kampf vom letzten Mal darf dabei nicht verloren gehen."""
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Alter Ork"})
    g.save_session()
    neu = gmod.Game()
    assert neu.resume_available
    neu.apply({"type": "encounter_import", "text": SAUBER})
    neu.apply({"type": "bestiary_upsert", "name": "Skree"})
    assert neu.resume_available and not neu._history
    assert neu.resume_session()
    assert any(c["name"] == "Alter Ork" for c in neu.combatants)
    assert len(neu.encounters) == 1
    # Ohne offene Frage bleibt alles wie gehabt (Rückgängig geht).
    neu.apply({"type": "encounter_import", "text": SAUBER})
    neu.apply({"type": "undo"})
    assert len(neu.encounters) == 1


def test_anleitung_nennt_format_und_talente():
    a = anleitung(T)
    for wort in ("KAMPF:", "GEGNER:", "ROBUSTHEIT:", "ZONE:", "Kühler Kopf", "VERBÜNDETER:"):
        assert wort in a
