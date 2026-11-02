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

def test_notizen_nur_fuer_das_eigene_handy(fresh_game):
    g = fresh_game
    mira, korgo = _mira(g)
    assert g.notizen_setzen(_figur(g, "Mira")["id"], "Rask schuldet uns 50 Gold")
    assert g.notizen_fuer(mira["id"]) == "Rask schuldet uns 50 Gold"
    assert g.notizen_fuer(korgo["id"]) == ""
    snap = g.snapshot(fuer_spieler=True, player_id=korgo["id"])
    assert "Rask" not in json.dumps(snap, ensure_ascii=False)
    assert g.snapshot(fuer_spieler=True, player_id=mira["id"])["meineNotizen"].startswith("Rask")
    # Bleiben am Charakter, auch wenn der SL ihn bearbeitet.
    g.apply({"type": "roster_upsert", "id": "char_mira", "name": "Mira die Flinke", "isWildCard": True})
    assert g.roster[0]["notizen"].startswith("Rask")
    assert not g.notizen_setzen(_figur(g, "Mira die Flinke")["id"], "Rask schuldet uns 50 Gold")   # unverändert


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
