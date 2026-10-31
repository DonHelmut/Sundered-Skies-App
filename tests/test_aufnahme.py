"""Spielabend-Aufnahme: Stücke anhängen, Kampfzeiten mitschreiben, Prompt bauen."""
from server import aufnahme as A


def _kampf_vorbereiten(g):
    g.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    g.register_player("Tim", g.roster[-1]["id"], None)
    g.apply({"type": "add_npc", "name": "Ork", "count": 2})


def test_stuecke_landen_in_einer_datei(tmp_path):
    a = A.Aufnahmen(tmp_path / "aufnahmen")
    meta = a.starten("audio/webm;codecs=opus")
    assert a.stueck(meta["name"], b"abc")
    assert a.stueck(meta["name"], b"def")
    assert not a.stueck("2000-01-01_00-00", b"x")     # fremde Aufnahme
    assert a.audio_pfad(meta["name"]).read_bytes() == b"abcdef"
    a.stoppen()
    assert not a.stueck(meta["name"], b"zu spaet")
    assert a.liste()[0]["bytes"] == 6


def test_unsinnige_namen_kommen_nicht_in_den_pfad(tmp_path):
    a = A.Aufnahmen(tmp_path)
    for name in ("../game", "x", "2026-10-30_19-42/../../a", ""):
        assert a.audio_pfad(name) is None
        assert a.prompt(name, "Text") is None
        assert not a.loeschen(name)


def test_kampf_wird_mit_zeit_und_gegnern_gemerkt(fresh_game, tmp_path):
    g = fresh_game
    _kampf_vorbereiten(g)
    a = A.Aufnahmen(tmp_path)
    a.starten("audio/webm", g)
    g.apply({"type": "new_round"})
    a.beobachten(g)
    g.apply({"type": "new_round"})
    a.beobachten(g)
    g.apply({"type": "reset"})
    a.beobachten(g)
    zuege = [e["figur"] for e in a.aktiv["ereignisse"] if e["art"] == "zug"]
    ev = [e for e in a.aktiv["ereignisse"] if e["art"] != "zug"]
    assert [e["art"] for e in ev] == ["kampf_start", "kampf_ende"]
    assert zuege and zuege[-1] is None                 # nach dem Kampf: niemand dran
    assert set(zuege) <= {"Korgo", None}               # Gegner-Züge zählen als „niemand"
    assert ev[0]["gegner"] == ["2× Ork"]
    assert ev[0]["spieler"] == ["Korgo"]
    assert ev[1]["runden"] == 2
    assert a.aktiv["personen"] == {"Korgo": "Tim"}


def test_kampf_endet_wenn_letzter_gegner_faellt(fresh_game, tmp_path):
    # Viele SL räumen nach dem Kampf nicht ab - sonst wäre alles danach „Kampf".
    g = fresh_game
    _kampf_vorbereiten(g)
    a = A.Aufnahmen(tmp_path)
    a.starten("audio/webm", g)
    g.apply({"type": "new_round"})
    a.beobachten(g)
    for c in g.combatants:
        if c["kind"] == "npc":
            c["status"]["out"] = True
    a.beobachten(g)
    assert [e["art"] for e in a.aktiv["ereignisse"] if e["art"] != "zug"] == ["kampf_start", "kampf_ende"]


def test_stopp_mitten_im_kampf_schliesst_ihn(fresh_game, tmp_path):
    g = fresh_game
    _kampf_vorbereiten(g)
    a = A.Aufnahmen(tmp_path)
    meta = a.starten("audio/webm", g)
    g.apply({"type": "new_round"})
    a.stoppen(g)
    assert [e["art"] for e in meta["ereignisse"] if e["art"] != "zug"] == ["kampf_start", "kampf_ende"]
    assert a.aktiv is None


def test_neuer_start_beendet_haengende_aufnahme(tmp_path):
    # Seite neu geladen: die alte Aufnahme bleibt erhalten, eine neue beginnt.
    a = A.Aufnahmen(tmp_path)
    erste = a.starten("audio/webm")
    a.stueck(erste["name"], b"1")
    zweite = a.starten("audio/webm")
    assert zweite["name"] != erste["name"]
    assert [x["name"] for x in a.liste()] == [zweite["name"], erste["name"]]
    assert a.liste()[1]["laeuft"] is False


def test_prompt_enthaelt_namen_kaempfe_marken_und_text(fresh_game, tmp_path):
    g = fresh_game
    _kampf_vorbereiten(g)
    a = A.Aufnahmen(tmp_path)
    meta = a.starten("audio/webm", g)
    a.marke("Verrat des Kapitäns")
    g.apply({"type": "new_round"})
    a.stoppen(g)
    p = a.prompt(meta["name"], "<html><head><style>p{}</style></head><body>"
                 "<p>[00:00:01] S00: Ihr seht ein Schiff&nbsp;am Horizont.</p></body></html>",
                 extra="Die Insel heißt Grauzahn.")
    assert "Korgo (gespielt von Tim)" in p
    assert "Kampf gegen 2× Ork" in p
    assert "Verrat des Kapitäns" in p
    assert "Grauzahn" in p
    assert "S00: Ihr seht ein Schiff am Horizont." in p
    assert "<p>" not in p and "p{}" not in p
    assert (tmp_path / f"{meta['name']}-prompt.txt").exists()
    assert a.liste()[0]["hatTranskript"]


def test_leeres_transkript_gibt_keinen_prompt(tmp_path):
    a = A.Aufnahmen(tmp_path)
    meta = a.starten("audio/webm")
    a.stoppen()
    assert a.prompt(meta["name"], "   ") is None


def test_loeschen_raeumt_alles_weg_aber_nicht_die_laufende(tmp_path):
    a = A.Aufnahmen(tmp_path)
    alt = a.starten("audio/webm")
    a.stueck(alt["name"], b"x")
    a.stoppen()
    a.prompt(alt["name"], "Text")
    neu = a.starten("audio/webm")
    assert not a.loeschen(neu["name"])
    assert a.loeschen(alt["name"])
    rest = [p.name for p in tmp_path.iterdir()]
    assert not any(n.startswith(alt["name"] + x) for n in rest for x in (".", "-transkript", "-prompt"))
    assert a.audio_pfad(neu["name"]) is None and a.liste()[0]["name"] == neu["name"]


def test_endung_passt_zum_browser():
    assert A.endung_fuer("audio/webm;codecs=opus") == ".webm"
    assert A.endung_fuer("audio/ogg;codecs=opus") == ".ogg"
    assert A.endung_fuer("audio/mp4") == ".m4a"
    assert A.uhrzeit(3_723_000) == "01:02:03"


def test_dauer_nach_server_absturz_aus_der_tondatei(tmp_path):
    import os
    a = A.Aufnahmen(tmp_path)
    meta = a.starten("audio/webm")
    a.stueck(meta["name"], b"x")
    pfad = a.audio_pfad(meta["name"])
    t = (meta["start"] + 3_600_000) / 1000
    os.utime(pfad, (t, t))
    neu = A.Aufnahmen(tmp_path)          # Server neu gestartet, nichts aktiv
    assert 3_590_000 <= neu.liste()[0]["dauerMs"] <= 3_610_000


def test_live_zeilen_landen_bei_der_laufenden_aufnahme(tmp_path):
    a = A.Aufnahmen(tmp_path)
    assert not a.live(A.now_ms(), "S00", "Ohne Aufnahme")      # -> 409, nichts geschrieben
    meta = a.starten("audio/webm")
    assert a.live(meta["start"] + 65_000, "S01", "Ich  ziehe\nmeine Axt.")
    assert a.live(meta["start"] + 70_000, "../x", "Wer?")        # Unsinn -> „S??"
    zeilen = (tmp_path / f"{meta['name']}-live.txt").read_text(encoding="utf-8").splitlines()
    assert zeilen == ["[00:01:05] S01: Ich ziehe meine Axt.", "[00:01:10] S??: Wer?"]
    assert [z["n"] for z in a.live_ab(0)["zeilen"]] == [1, 2]
    assert [z["text"] for z in a.live_ab(1)["zeilen"]] == ["Wer?"]
    a.stoppen()
    assert a.liste()[0]["hatLive"]
    p = a.prompt_aus(meta["name"], "live")
    assert "[00:01:05] S01: Ich ziehe meine Axt." in p
    # Live-Prompt gilt nicht als genaues Transkript.
    assert not a.liste()[0]["hatTranskript"]
    assert a.prompt_aus(meta["name"], "genau") is None
    assert a.prompt_aus(meta["name"], "../x") is None
    assert a.loeschen(meta["name"])
    assert not (tmp_path / f"{meta['name']}-live.txt").exists()


def test_live_anzeige_haelt_nur_die_letzten_zeilen(tmp_path):
    a = A.Aufnahmen(tmp_path)
    a.starten("audio/webm")
    for i in range(A.LIVE_MERKEN + 10):
        a.live(None, "S00", f"Satz {i}")
    assert len(a.live_ab(0)["zeilen"]) == A.LIVE_MERKEN
    a.starten("audio/webm")                       # neue Aufnahme, Anzeige leer
    assert a.live_ab(0)["zeilen"] == []
    assert a.prompt_aus("2000-01-01_00-00", "live") is None


def test_sprecher_benennen_landet_im_prompt(tmp_path):
    a = A.Aufnahmen(tmp_path)
    a.begriffe_quelle = lambda: ["Vexmoor", "Krauzern"]
    meta = a.starten("audio/webm")
    meta["personen"] = {"Korgo": "Tim"}
    a.stoppen()
    (tmp_path / f"{meta['name']}-transkript.txt").write_text(
        "[00:00:01] S00: Ihr seht ein Schiff.\n[00:00:04] S01: Ich ziehe die Axt.\n"
        "[00:00:06] S02: Ich auch.\n", encoding="utf-8")
    sp = a.sprecher(meta["name"], "genau")
    assert [x["sprecher"] for x in sp["sprecher"]] == ["S00", "S01", "S02"]
    assert sp["vorschlaege"] == ["Spielleiter", "Korgo (Tim)"]
    assert sp["sprecher"][0]["beispiele"] == ["Ihr seht ein Schiff."]
    assert a.sprecher_benennen(meta["name"], "genau", {"S00": "Spielleiter", "S01": "Korgo (Tim)", "X": "böse"})
    assert a.sprecher(meta["name"], "genau")["namen"] == {"S00": "Spielleiter", "S01": "Korgo (Tim)"}
    p = a.prompt_aus(meta["name"], "genau")
    assert "] Spielleiter: Ihr seht ein Schiff." in p
    assert "] Korgo (Tim): Ich ziehe die Axt." in p
    assert "] S02: Ich auch." in p                     # nicht zugeordnet bleibt
    assert "hat der Spielleiter zugeordnet" in p
    assert "Vexmoor, Krauzern" in p
    # Live hat eigene Zuordnung (andere Nummern) - genau gilt dort nicht.
    assert a.sprecher(meta["name"], "live") is None


def test_namen_und_personen_einer_aufnahme(fresh_game, tmp_path):
    g = fresh_game
    _kampf_vorbereiten(g)
    a = A.Aufnahmen(tmp_path)
    meta = a.starten("audio/webm", g)
    g.apply({"type": "new_round"})
    a.stoppen(g)
    n = a.namen(meta["name"])
    assert "Korgo" in n and "Tim" in n and "2× Ork" in n
    assert a.personen_zahl(meta["name"]) == 2


TISCH = """[00:00:00] S00: Die Sturmvogel gleitet durch die Wolkenbank. Vor euch taucht die Insel Krauzern auf ein zerklüfteter Felsen im Nebel
[00:00:06] S01: Korgo stellt sich an den Bug und hält nach Skrael ausschaut. Die Viecher haben uns letztes Mal fast das Segel zerfetzt.
[00:00:13] S02: Tessa fragt Kapitän Branok, ob er schon einmal auf Krauzern gelandet ist.
[00:00:19] S00: Kapitän Branok kratzt sich am Bad. Der Leuchtturm brennt seit zwanzig Jahren nicht mehr, sagt er.
[00:00:25] S03: Wir holt ihre Karte heraus. Ich glaube, Sechs Mal hat uns diesen Auftrag
[00:00:31] S01: egal. Wir brauchen das Gold. Korgo zieht seine Axt und springt auf den Felsen
[00:00:36] S00: mit Kreischen aus dem Nebel. Drei Skrallen stürzen sich auf euch. Zieht Initiative.
[00:00:41] S02: Ich hab einen Jörga. Tester schießt mit der Armbrust auf den ersten Skrallen. Mira wirft jetzt auf den zweiten.
[00:00:51] S00: Nach dem Kampf liegt eine der Krallen verwundet am Boden. In seinen Krallen hält er ein Amulett für den
[00:00:56] S01: Wappen von Dexmond. Porbo nimmt das Amulett und steckt es ein. Vielleicht weiß der Leuchtturmwärter Aldric, was es bedeutet.
[00:01:05] S03: dran Brandung fragen, bevor wir weitergehen.
"""
PERSONEN = {"Korgo": "Tim", "Tessa": "Anna", "Mira": "Jo"}


def test_wer_ist_wer_aus_dem_kontext():
    # Echtes Ergebnis der Tisch-Simulation: Spieler sagen ihre Figur an.
    erg = A.sprecher_raten(TISCH, {"personen": PERSONEN})
    assert erg["S00"] == A.SPIELLEITER                     # redet am meisten
    assert erg["S01"] == "Korgo (Tim)"
    # S02 sagt „Tessa fragt" und (im verschmolzenen Stück) „Mira wirft" -
    # unentschieden: lieber offen lassen als falsch raten.
    assert "S02" not in erg
    assert "S03" not in erg                                # kein Hinweis -> bleibt S03


def test_wer_ist_wer_aus_anrede_und_zug():
    t = """[00:00:00] S00: Ihr steht vor dem Tor. Ein langer Satz vom Spielleiter, der viel erzählt und beschreibt.
[00:00:10] S00: Mira, was machst du?
[00:00:13] S01: Ich schau mir das Schloss an.
[00:00:20] S00: Und was macht Tessa?
[00:00:23] S02: Ich halte Wache, die Armbrust im Anschlag.
[00:00:30] S00: Gut. Noch ein langer Satz vom Spielleiter, damit er sicher am meisten redet.
[00:01:00] S02: Ich schieße auf den Ork und dann noch einmal, weil ich einen Joker habe.
[00:01:20] S01: Ich zaubere einen Blitz auf den zweiten Ork, so stark ich kann.
"""
    meta = {"personen": PERSONEN, "ereignisse": [
        {"t": 58000, "art": "zug", "figur": "Tessa"}, {"t": 75000, "art": "zug", "figur": "Mira"},
        {"t": 95000, "art": "zug", "figur": None}]}
    erg = A.sprecher_raten(t, meta)
    assert erg == {"S00": A.SPIELLEITER, "S01": "Mira (Jo)", "S02": "Tessa (Anna)"}


def test_anreden_unter_spielern_zaehlt_nicht():
    t = """[00:00:00] S00: Ein langer Satz vom Spielleiter, der viel erzählt und alles beschreibt, was passiert.
[00:00:10] S01: Tessa, hilf mir! Tessa, schnell!
"""
    assert A.sprecher_raten(t, {"personen": PERSONEN}) == {"S00": A.SPIELLEITER}


def test_automatisch_nur_wenn_noch_keiner_zugeordnet_hat(tmp_path):
    a = A.Aufnahmen(tmp_path)
    meta = a.starten("audio/webm")
    a.stueck(meta["name"], b"x")
    a.aktiv["personen"] = dict(PERSONEN)
    a.stoppen()
    (tmp_path / f"{meta['name']}-transkript.txt").write_text(TISCH, encoding="utf-8")
    assert a.sprecher_automatisch(meta["name"])
    d = a.sprecher(meta["name"], "genau")
    assert d["automatisch"] and d["namen"] == {"S00": A.SPIELLEITER, "S01": "Korgo (Tim)"}
    assert "automatisch zugeordnet" in a.prompt_aus(meta["name"])
    a.sprecher_benennen(meta["name"], "genau", {"S01": "Tessa (Anna)"})
    assert not a.sprecher(meta["name"], "genau")["automatisch"]
    assert not a.sprecher_automatisch(meta["name"])        # SL hat entschieden
    assert "automatisch zugeordnet" not in a.prompt_aus(meta["name"])
