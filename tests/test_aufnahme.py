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
    ev = a.aktiv["ereignisse"]
    assert [e["art"] for e in ev] == ["kampf_start", "kampf_ende"]
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
    assert [e["art"] for e in a.aktiv["ereignisse"]] == ["kampf_start", "kampf_ende"]


def test_stopp_mitten_im_kampf_schliesst_ihn(fresh_game, tmp_path):
    g = fresh_game
    _kampf_vorbereiten(g)
    a = A.Aufnahmen(tmp_path)
    meta = a.starten("audio/webm", g)
    g.apply({"type": "new_round"})
    a.stoppen(g)
    assert [e["art"] for e in meta["ereignisse"]] == ["kampf_start", "kampf_ende"]
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
