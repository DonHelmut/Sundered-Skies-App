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
