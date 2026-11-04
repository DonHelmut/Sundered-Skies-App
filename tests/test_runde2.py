"""Ideenrunde 2 (02.11.2026): Bugs aus dem Durchspielen, Notizen, Protokoll als
Vorgeschichte, Namen aus Protokollen, Stimmen über Abende, Stichwort zur Marke."""
import json

from server import aufnahme as A
from server import namen as N


def _mira(g):
    g.apply({"type": "roster_upsert", "id": "char_mira", "name": "Mira", "isWildCard": True})
    g.apply({"type": "roster_upsert", "id": "char_korgo", "name": "Korgo", "isWildCard": True})
    mira = g.register_player("Anna", "char_mira", None)
    korgo = g.register_player("Tim", "char_korgo", None)
    return mira, korgo


def _figur(g, name):
    return next(c for c in g.combatants if c["name"] == name)


# --- Bugs ---------------------------------------------------------------------

def test_plus_kampf_setzt_beigetretenen_charakter_nicht_doppelt_ein(fresh_game):
    g = fresh_game
    _mira(g)
    g.apply({"type": "add_from_roster", "id": "char_mira"})
    assert [c["name"] for c in g.combatants].count("Mira") == 1


def test_treffer_meldung_nennt_mitspieler_nicht_als_angreifer(fresh_game):
    g = fresh_game
    mira, korgo = _mira(g)
    g.active_id = _figur(g, "Mira")["id"]          # Mira ist dran
    g.apply({"type": "apply_hit", "id": _figur(g, "Korgo")["id"]})
    text = [m for m in g.messages if m.get("target") == korgo["id"]][-1]["text"]
    assert "Mira" not in text and text.startswith("😵 Getroffen")


def test_treffer_meldung_nennt_aktiven_gegner(fresh_game):
    g = fresh_game
    mira, korgo = _mira(g)
    g.apply({"type": "add_npc", "name": "Pirat"})
    g.active_id = _figur(g, "Pirat")["id"]
    g.apply({"type": "apply_hit", "id": _figur(g, "Korgo")["id"]})
    text = [m for m in g.messages if m.get("target") == korgo["id"]][-1]["text"]
    assert "Pirat trifft dich" in text


# --- Notizen ------------------------------------------------------------------

def _texte(liste):
    return [e["text"] for e in liste]


def test_notizen_nur_fuer_das_eigene_handy(fresh_game):
    g = fresh_game
    mira, korgo = _mira(g)
    eintrag = {"id": "n1", "text": "Rask schuldet uns 50 Gold", "thema": "NSC", "erledigt": False}
    assert g.notizen_setzen(_figur(g, "Mira")["id"], [eintrag])
    assert g.notizen_fuer(mira["id"]) == [eintrag]
    assert g.notizen_fuer(korgo["id"]) == []
    snap = g.snapshot(fuer_spieler=True, player_id=korgo["id"])
    assert "Rask" not in json.dumps(snap, ensure_ascii=False)
    assert g.snapshot(fuer_spieler=True, player_id=mira["id"])["meineNotizen"] == [eintrag]
    # Bleiben am Charakter, auch wenn der SL ihn bearbeitet.
    g.apply({"type": "roster_upsert", "id": "char_mira", "name": "Mira die Flinke", "isWildCard": True})
    assert g.roster[0]["notizen"] == [eintrag]
    assert not g.notizen_setzen(_figur(g, "Mira die Flinke")["id"], [eintrag])   # unverändert


def test_notizen_thema_haken_und_bereinigen(fresh_game):
    g = fresh_game
    mira, _ = _mira(g)
    cid = _figur(g, "Mira")["id"]
    g.notizen_setzen(cid, [
        {"id": "a", "text": "Rask\nschuldet 50 Gold", "thema": "  NSC  ", "erledigt": 1},
        {"id": "b", "text": "  "}, 7, {"text": "ohne id"}, {"id": "a", "text": "doppelte id"},
    ])
    liste = g.notizen_fuer(mira["id"])
    assert liste[0] == {"id": "a", "text": "Rask\nschuldet 50 Gold", "thema": "NSC", "erledigt": True}
    assert _texte(liste) == ["Rask\nschuldet 50 Gold", "ohne id", "doppelte id"]
    assert len({e["id"] for e in liste}) == 3                     # IDs eindeutig
    assert not g.notizen_setzen(cid, {"kaputt": 1})


def test_alte_freitext_notiz_wird_zeilenweise_zu_eintraegen(fresh_game):
    g = fresh_game
    mira, _ = _mira(g)
    g.roster[0]["notizen"] = "Rask schuldet 50 Gold\r\n\n  Karte im Turm  \n"   # Stand 1.5.35
    liste = g.notizen_fuer(mira["id"])
    assert _texte(liste) == ["Rask schuldet 50 Gold", "Karte im Turm"]
    assert all(e["thema"] == "" and not e["erledigt"] for e in liste)
    assert liste == g.notizen_fuer(mira["id"])                    # IDs bleiben beim erneuten Lesen gleich
    # Altes Handy (schickt noch Text) geht weiter.
    assert g.notizen_setzen(_figur(g, "Mira")["id"], "A\nB")
    assert _texte(g.roster[0]["notizen"]) == ["A", "B"]


def test_notizen_grenzen(fresh_game):
    g = fresh_game
    mira, _ = _mira(g)
    from server.game import MAX_NOTIZ_LAENGE, MAX_NOTIZ_EINTRAEGE
    g.notizen_setzen(_figur(g, "Mira")["id"], ["x" * 5000] + ["y"] * 500)
    liste = g.notizen_fuer(mira["id"])
    assert len(liste[0]["text"]) == MAX_NOTIZ_LAENGE and len(liste) == MAX_NOTIZ_EINTRAEGE


def test_notiz_quelle_bleibt_und_sl_sieht_private_notizen_nicht(fresh_game):
    g = fresh_game
    mira, _ = _mira(g)
    g.notizen_setzen(_figur(g, "Mira")["id"], [{"id": "a", "text": "Zahlenschloss 7-?-3", "thema": "Offen", "quelle": "msg-1"}])
    assert g.notizen_fuer(mira["id"])[0]["quelle"] == "msg-1"
    assert "Zahlenschloss" not in json.dumps(g.snapshot(), ensure_ascii=False)   # SL-Laptop


def test_gruppen_notizen_fuer_alle_mit_schreiber(fresh_game):
    g = fresh_game
    mira, korgo = _mira(g)
    m, k = _figur(g, "Mira")["id"], _figur(g, "Korgo")["id"]
    assert g.gruppen_notiz(m, {"op": "neu", "eintrag": {"id": "g1", "text": "Beute: 3 Heiltränke", "thema": "Beute"}})
    assert g.gruppen_notiz(k, {"op": "neu", "eintrag": {"id": "g2", "text": "Treffpunkt Hafen"}})
    for pid in (mira["id"], korgo["id"]):
        snap = g.snapshot(fuer_spieler=True, player_id=pid)
        assert [e["text"] for e in snap["gruppenNotizen"]] == ["Treffpunkt Hafen", "Beute: 3 Heiltränke"]
    assert g.gruppen_notizen[1]["von"] == "Mira" and g.gruppen_notizen[0]["von"] == "Korgo"
    # Korgo hakt Miras Notiz ab, ändert sie - Schreiber bleibt Mira.
    assert g.gruppen_notiz(k, {"op": "aendern", "id": "g1", "erledigt": True, "text": "Beute: 2 Heiltränke"})
    assert g.gruppen_notizen[1] == {"id": "g1", "text": "Beute: 2 Heiltränke", "thema": "Beute", "erledigt": True,
                                    "von": "Mira", "vonId": "char_mira"}
    weg = g.gruppen_notizen[1]
    assert g.gruppen_notiz(k, {"op": "loeschen", "id": "g1"})
    # Rückgängig: an alter Stelle, alter Schreiber.
    assert g.gruppen_notiz(k, {"op": "neu", "eintrag": weg, "index": 1})
    assert g.gruppen_notizen[1]["von"] == "Mira"
    assert not g.gruppen_notiz(k, {"op": "neu", "eintrag": weg})          # gleiche ID nicht doppelt
    assert not g.gruppen_notiz(k, {"op": "kaputt", "id": "g1"})
    # Dauerhaft und in der Sicherung.
    neu = type(g)()
    assert [e["id"] for e in neu.gruppen_notizen] == ["g2", "g1"]
    assert g.export_data()["gruppenNotizen"] == g.gruppen_notizen


def test_namen_fuer_notizen_verraten_keine_sl_vorbereitung(fresh_game):
    g = fresh_game
    _mira(g)
    g.bestiary = [{"id": "b1", "name": "Schattendrache"}]
    g.protokolle = [{"id": "p1", "freigegeben": True, "text": "Wir trafen Rask in Rabenfels."},
                    {"id": "p2", "freigegeben": False, "text": "Geheim: Vexmoor wartet."}]
    namen = g.namen_fuer_notizen(fuer_spieler=True)
    assert {"Mira", "Korgo", "Rask", "Rabenfels"} <= set(namen)
    assert "Schattendrache" not in namen and "Vexmoor" not in namen
    assert "Vexmoor" in g.namen_fuer_notizen(fuer_spieler=False)


# --- Protokoll als Vorgeschichte ---------------------------------------------------

def test_letztes_protokoll_vor_der_aufnahme(fresh_game):
    g = fresh_game
    g.protokolle = [
        {"id": "p2", "name": "Abend 2", "datum": "2026-11-01", "text": "Neu", "erstellt": 1793600000000},
        {"id": "p1", "name": "Abend 1", "datum": "2026-10-20", "text": "Alt"},
    ]
    assert g.protokoll_vorher(1793700000000)["name"] == "Abend 2"
    assert g.protokoll_vorher(1793500000000)["name"] == "Abend 1"     # Abend 2 kam erst danach
    assert g.protokoll_vorher(None) is None


def test_prompt_mit_vorgeschichte():
    meta = {"start": 1793623962936, "personen": {}, "ereignisse": []}
    p = A.baue_prompt(meta, "[00:00:01] S00: Hallo", vorgeschichte={"datum": "2026-10-20", "text": "Die Gruppe floh vor Rask."})
    assert "WAS BISHER GESCHAH" in p and "vom 20.10.2026" in p and "floh vor Rask" in p
    assert p.index("WAS BISHER GESCHAH") < p.index("\nTRANSKRIPT:\n")
    assert "WAS BISHER" not in A.baue_prompt(meta, "[00:00:01] S00: Hallo")


def test_namen_aus_protokollen(fresh_game):
    g = fresh_game
    g.protokolle = [{"id": "p1", "text": "Die Gruppe landete auf Graufels und traf Kapitän Rask."}]
    assert "Graufels" in N.namen_aus_spiel(g)


# --- Stichwort zur Marke ---------------------------------------------------------------

def test_stichwort_zur_letzten_marke(tmp_path):
    a = A.Aufnahmen(tmp_path / "aufnahmen")
    assert not a.marke_text("x")              # keine Aufnahme
    a.starten("audio/webm")
    assert not a.marke_text("x")              # noch keine Marke
    a.marke()
    a.marke()
    assert a.marke_text("  Korgos   Joker ")
    marken = [e for e in a.aktiv["ereignisse"] if e["art"] == "marke"]
    assert marken[0]["text"] == "" and marken[1]["text"] == "Korgos Joker"


# --- Stimmen über Abende -----------------------------------------------------------------

def _v(*x):
    return list(x)


def test_profile_lernen_und_wiedererkennen():
    profile = {}
    assert A.profile_lernen(profile, {"S00": _v(1, 0, 0), "S01": _v(0, 1, 0)},
                            {"S00": "Spielleiter", "S01": "Korgo (Tim)"})
    assert set(profile) == {"Spielleiter", "Korgo"}
    # Nächster Abend: Nummern anders herum, Stimmen leicht anders.
    neu = {"S00": _v(0.1, 0.95, 0), "S01": _v(0.97, 0.05, 0.1), "S02": _v(0, 0, 1)}
    erg = A.profile_zuordnen(neu, profile, {"Spielleiter", "Korgo"})
    assert erg == {"S00": "Korgo", "S01": "Spielleiter"}
    # Figur heute nicht dabei -> nicht vergeben.
    assert A.profile_zuordnen(neu, profile, {"Spielleiter"}) == {"S01": "Spielleiter"}


def test_sprecher_raten_nimmt_gemerkte_stimmen():
    text = "[00:00:01] S00: Ihr seht drei Boote.\n[00:00:05] S01: Ich ziehe die Axt.\n[00:00:09] S00: Gut so, sie kommen näher und näher.\n"
    meta = {"personen": {"Korgo": "Tim", "Mira": ""}, "ereignisse": []}
    erg = A.sprecher_raten(text, meta, bekannt={"S01": "Korgo"})
    assert erg == {"S00": "Spielleiter", "S01": "Korgo (Tim)"}


def test_sprecher_automatisch_lernt_aus_stimm_anmeldung(tmp_path):
    a = A.Aufnahmen(tmp_path / "aufnahmen")
    meta = a.starten("audio/webm")
    name = meta["name"]
    a.aktiv["personen"] = {"Korgo": "Tim"}
    a.aktiv["ereignisse"].append({"t": 4000, "art": "stimme", "figur": "Korgo"})
    a.stoppen()
    (a.ordner / f"{name}-transkript.txt").write_text(
        "[00:00:01] S00: Willkommen, ihr steht an Deck und der Wind pfeift.\n"
        "[00:00:05] S01: Ich bin Tim und spiele Korgo.\n", encoding="utf-8")
    a.abdruecke_speichern(name, {"S00": [1, 0], "S01": [0, 1]})
    assert a.sprecher_automatisch(name)
    assert set(a.stimmprofile()) == {"Korgo"}
    assert "Korgo" in a.status()["stimmenBekannt"]
    # Vom SL in „Wer ist wer?" bestätigt: auch der SL wird gelernt.
    assert a.sprecher_benennen(name, "genau", {"S00": "Spielleiter", "S01": "Korgo (Tim)"})
    assert set(a.stimmprofile()) == {"Korgo", "Spielleiter"}
    # Nochmal bestätigt: derselbe Abend zählt nicht doppelt.
    assert a.sprecher_benennen(name, "genau", {"S00": "Spielleiter", "S01": "Korgo (Tim)"})
    assert a.stimmprofile()["Korgo"]["n"] == 1
    # Löschen nimmt die Abdrücke der Aufnahme mit, die Profile bleiben.
    assert a.loeschen(name)
    assert not (a.ordner / f"{name}-stimmen.json").exists()
    assert set(a.stimmprofile()) == {"Korgo", "Spielleiter"}


def test_protokoll_titel_aus_dem_text(fresh_game):
    g = fresh_game
    g.apply({"type": "protokoll_speichern", "name": "", "text": "# Sturm über Graufels\n\nDie Gruppe …"})
    assert g.protokolle[0]["name"] == "Sturm über Graufels"
    g.apply({"type": "protokoll_speichern", "name": "", "text": "Ohne Überschrift"})
    assert g.protokolle[0]["name"].startswith("Spielabend ")
    assert "# Titel" in A.baue_prompt({"personen": {}, "ereignisse": []}, "[00:00:01] S00: Hallo")
