"""Spracherkennung: Logik ohne Modelle (Zusammenlegen, Zerteilen, Sprecher,
Wörter verteilen, Rückstau) und die Verwaltung im Server. Die Modelle selbst
(~540 MB) laufen hier nicht."""
import threading

import pytest

from server import aufnahme as A
from server import sprache as SP


def test_halbsaetze_desselben_sprechers_werden_ein_beitrag():
    roh = [SP.Abschnitt(0, 2, 1), SP.Abschnitt(2.5, 4, 1), SP.Abschnitt(4.2, 6, 0), SP.Abschnitt(8, 9, 0)]
    erg = SP.zusammenlegen(roh)
    assert [(a.start, a.ende, a.sprecher) for a in erg] == [(0, 4, 1), (4.2, 6, 0), (8, 9, 0)]


def test_lange_beitraege_werden_zerteilt():
    stuecke = SP.zerteilen(SP.Abschnitt(0, 70, 0))
    assert all(e - s <= SP.MAX_STUECK_S + 2 for s, e in stuecke)
    assert stuecke[0][0] == 0 and stuecke[-1][1] == 70
    # Kein Fetzen am Ende: Rest unter 2 s kommt ans letzte Stück.
    assert SP.zerteilen(SP.Abschnitt(0, 29, 0)) == [(0, 29)]


def test_wer_am_meisten_redet_ist_s00_und_passt_zum_prompt():
    ab = [SP.Abschnitt(0, 5, 7, "Hallo"), SP.Abschnitt(5, 60, 3, "Ihr seht ein Schiff."),
          SP.Abschnitt(60, 61, 7, "")]
    text = SP.transkript_text(ab)
    assert text.splitlines() == ["[00:00:00] S01: Hallo", "[00:00:05] S00: Ihr seht ein Schiff."]
    assert A.transkript_text(text) == text.strip()


def test_floskeln_aus_stille_fliegen_raus():
    assert SP.text_sauber("Untertitel im Auftrag des ZDF") == ""
    assert SP.text_sauber("  Ich  ziehe   meine Axt. ") == "Ich ziehe meine Axt."


def test_woerter_gehen_an_den_der_gerade_redet():
    tokens = [" Ich", " zie", "he", " die", " Axt", ".", " Ka", "um", " be", "rührt"]
    zeiten = [0.0, 0.3, 0.5, 0.7, 0.9, 1.1, 2.0, 2.2, 2.4, 2.6]
    teile = [(0.0, 1.5, 1), (1.9, 3.0, 0)]
    assert SP.woerter_verteilen(tokens, zeiten, teile) == [
        (0.0, 1, "Ich ziehe die Axt."), (2.0, 0, "Kaum berührt")]
    # In der Atempause zählt der nächste Sprecher, kein Wort wird zerschnitten.
    assert SP.sprecher_um(1.6, teile) == 1 and SP.sprecher_um(1.85, teile) == 0


def test_rueckstau_verwirft_aelteste_stuecke():
    warte = [(i * 10.0, [0.0] * (10 * SP.SR)) for i in range(9)]   # 90 s Sprache
    assert SP.rueckstau_kuerzen(warte, max_s=60) == 3
    assert warte[0][0] == 30.0


def test_stimmen_werden_wiedererkannt():
    np = pytest.importorskip("numpy")
    st = SP.Stimmen(max_personen=2)
    a, b, c = np.eye(3)[0], np.eye(3)[1], np.eye(3)[2]
    assert st.zuordnen(a, 5) == 0
    assert st.zuordnen(b, 5) == 1
    assert st.zuordnen(a * 0.9 + b * 0.1, 3) == 0
    st.zuordnen(c, 0.4)                  # Fetzen: nie ein neuer Sprecher
    assert st.zuordnen(c, 5) in (0, 1)   # Tisch voll: nächstliegender statt neuer
    assert len(st.summen) == 2


def test_mitlesen_wartet_am_ende_bis_die_aufnahme_vorbei_ist(tmp_path):
    pfad = tmp_path / "a.webm"
    pfad.write_bytes(b"abc")
    laeuft = {"ja": True}
    m = SP.Mitlesen(pfad, lambda: laeuft["ja"], threading.Event())
    assert m.read(10) == b"abc"

    def spaeter():
        with open(pfad, "ab") as f:
            f.write(b"def")
        laeuft["ja"] = False
    threading.Timer(0.2, spaeter).start()
    assert m.read(10) == b"def"          # hat gewartet statt aufzuhören
    assert m.read(10) == b""             # Aufnahme vorbei -> Ende
    m.close()


def test_verwaltung_ohne_modelle(tmp_path):
    auf = A.Aufnahmen(tmp_path / "aufnahmen")
    sp = SP.Sprache(tmp_path / "modelle", auf)
    st = sp.status()
    assert not st["bereit"] and st["groesseMb"] > 400
    assert st["liveAn"] is True                      # Standard: live an
    meta = auf.starten("audio/webm")
    auf.stueck(meta["name"], b"x")
    sp.aufnahme_laeuft()                             # ohne Modelle: nichts
    assert sp.live is None
    auf.stoppen()
    assert not sp.genau(meta["name"])
    sp.einstellen(live=False, personen=5)
    neu = SP.Sprache(tmp_path / "modelle", auf)      # nach Neustart noch da
    assert neu.status()["liveAn"] is False and neu.status()["personen"] == 5
    sp.einstellen(personen=99)
    assert sp.status()["personen"] == 12


def test_genau_nur_einer_und_nicht_die_laufende(tmp_path, monkeypatch):
    auf = A.Aufnahmen(tmp_path / "aufnahmen")
    sp = SP.Sprache(tmp_path / "modelle", auf)
    monkeypatch.setattr(sp, "bereit", lambda: True)
    gestartet = threading.Event()
    weiter = threading.Event()

    def falsch_transkribieren(pfad, modelle, personen, melden, stopp, namen=()):
        melden(0.5, "Text erkennen")
        gestartet.set()
        weiter.wait(2)
        return "[00:00:01] S00: Ihr seht ein Schiff.\n"
    monkeypatch.setattr(SP, "transkribieren", falsch_transkribieren)
    alt = auf.starten("audio/webm")
    auf.stueck(alt["name"], b"x")
    neu = auf.starten("audio/webm")                  # beendet „alt"
    auf.stueck(neu["name"], b"y")
    assert not sp.genau(neu["name"])                 # läuft noch
    assert sp.genau(alt["name"])
    assert gestartet.wait(2)
    assert sp.status()["job"]["anteil"] == 0.5
    assert not sp.genau(alt["name"])                 # einer nach dem anderen
    weiter.set()
    for _ in range(50):
        if sp.job is None:
            break
        threading.Event().wait(0.05)
    assert sp.job is None
    assert "Ihr seht ein Schiff." in auf.prompt_aus(alt["name"], "genau")


def test_genau_verliert_nichts_was_die_sprechertrennung_uebersieht():
    # Stück 10–14 s, die Sprechertrennung kennt nur 10–11 s (Sprecher 2) und
    # weit weg 30–40 s (Sprecher 1). Alles kommt an, Rest beim Nächsten.
    teile = [(10.0, 11.0, 2), (30.0, 40.0, 1)]
    erg = SP.stueck_zuordnen(10.0, 14.0, [" Ich", " ziehe", " meine", " Axt"], [0.1, 0.5, 2.0, 2.5], teile)
    assert " ".join(a.text for a in erg) == "Ich ziehe meine Axt"
    assert {a.sprecher for a in erg} == {2}
    # Ganz ohne Treffer im Stück: der zeitlich nächste.
    erg = SP.stueck_zuordnen(25.0, 28.0, [" Hallo"], [0.2], teile)
    assert erg[0].sprecher == 1 and erg[0].text == "Hallo"


def test_beitraege_mit_text_zusammenlegen():
    A_ = SP.Abschnitt
    erg = SP.beitraege([A_(0, 2, 0, "Ihr seht"), A_(2.5, 4, 0, "ein Schiff."), A_(4.2, 5, 1, "Wo?"), A_(5, 5, 1, "")])
    assert [(a.sprecher, a.text) for a in erg] == [(0, "Ihr seht ein Schiff."), (1, "Wo?")]


def test_englischer_unsinn_aus_rauschen_fliegt_raus():
    for t in ("How do you", "I love it. I've been doing it.", "Yeah."):
        assert SP.text_sauber(t) == ""
    for t in ("Ich habe einen Joker!", "Okay, so machen wir das.", "Was hat er in der Hand?"):
        assert SP.text_sauber(t) == t


def test_begriffe_lesen():
    assert SP.begriffe_lesen("Vexmoor, Krauzern\nSturmvogel;  Kapitän   Branok \nvexmoor\nx") == \
        ["Vexmoor", "Krauzern", "Sturmvogel", "Kapitän Branok"]


def test_begriffe_und_personen_aus_app(tmp_path):
    auf = A.Aufnahmen(tmp_path / "aufnahmen")
    sp = SP.Sprache(tmp_path / "modelle", auf)
    sp.einstellen(begriffe="Vexmoor\nKrauzern")
    assert SP.Sprache(tmp_path / "modelle", auf).status()["begriffe"] == ["Vexmoor", "Krauzern"]
    sp.personen_quelle = lambda: 5
    assert sp.personen_fuer() == 5 and sp.status()["personenApp"] == 5
    meta = auf.starten("audio/webm")
    meta["personen"] = {"Korgo": "Tim", "Tessa": "Anna", "Mira": "Anna"}   # Anna spielt zwei
    assert sp.personen_fuer(meta["name"]) == 3                             # Tim, Anna + SL
    sp.einstellen(personen=6)
    assert sp.personen_fuer(meta["name"]) == 6                             # eingestellt gewinnt
    assert sp.status()["personenApp"] == 0


def test_hochpass_nimmt_brummen_und_laesst_sprache():
    np = pytest.importorskip("numpy")
    pytest.importorskip("av")
    t = np.arange(SP.SR * 2) / SP.SR
    brumm = SP.hochpass((0.3 * np.sin(2 * np.pi * 50 * t)).astype(np.float32))
    stimme = SP.hochpass((0.3 * np.sin(2 * np.pi * 400 * t)).astype(np.float32))
    assert len(brumm) == len(t)
    assert np.abs(brumm[SP.SR:]).max() < 0.1           # 50 Hz deutlich leiser
    assert np.abs(stimme[SP.SR:]).max() > 0.27         # 400 Hz bleibt


def test_verschmelzen_canary_text_parakeet_zeiten_und_namen():
    from server.namen import Namenskorrektur
    para = [(0.0, "Kogo"), (0.4, "stellt"), (0.8, "sich"), (1.1, "an"), (1.3, "den"), (1.5, "Buch.")]
    # Canary verschluckt den Namen am Anfang, hört aber „Bug" richtig.
    erg = SP.verschmelzen("stellt sich an den Bug.", para, 2.0, Namenskorrektur(["Korgo"]))
    assert " ".join(w for _, w in erg) == "Kogo stellt sich an den Bug."
    assert [t for t, _ in erg] == [0.0, 0.4, 0.8, 1.1, 1.3, 1.5]
    # Canary hört den Namen falsch, Parakeet fast richtig -> Name gewinnt.
    erg = SP.verschmelzen("Korku zieht die Axt.", [(0.0, "Kogo"), (0.5, "zieht"), (0.8, "die"), (1.0, "Axt.")],
                          1.5, Namenskorrektur(["Korgo"]))
    assert " ".join(w for _, w in erg) == "Korgo zieht die Axt."
    # Extrawort nur bei Canary: Zeit vom Vorgänger.
    erg = SP.verschmelzen("Ein Kreischen aus dem Nebel", [(0.0, "Kreischen"), (0.6, "aus"), (0.8, "Nebel")], 1.5)
    assert [w for _, w in erg] == ["Ein", "Kreischen", "aus", "dem", "Nebel"]
    assert erg[3][0] == 0.6
    assert SP.satzzeichen("Felsen , der im Nebel .") == "Felsen, der im Nebel."


def test_ohne_canary_bleibt_alles_bereit(tmp_path):
    auf = A.Aufnahmen(tmp_path / "aufnahmen")
    m = tmp_path / "modelle"
    for n in SP.PFLICHT:
        (m / SP.MODELLE[n][1]).mkdir(parents=True)
    sp = SP.Sprache(m, auf)
    if not SP.pakete_da():
        pytest.skip("ohne sherpa-onnx")
    st = sp.status()
    assert st["bereit"] and st["genauerFehlt"] and st["groesseMb"] == SP.MODELLE["genau"][2]


def test_muell_aus_dem_ersten_echten_test_fliegt_raus():
    # Zeilen aus Kalles Transkript vom 31.10. (1.5.28, normales Gespräch).
    assert SP.text_sauber("T S F") == ""
    assert SP.text_sauber("T S F T T T S F T T S F Yeah, that's all I just king to T S F T S F") == ""
    assert SP.text_sauber("It's a T S F") == ""
    assert SP.text_sauber("100000000000000000000") == ""
    assert SP.text_sauber("T S F T O M I S Ich halte das bestimmt, lass uns gehen.") == \
        "Ich halte das bestimmt, lass uns gehen."
    assert SP.text_sauber("Ah ja. T S F") == "Ah ja."
    assert SP.text_sauber("Ja,,, Tatsächlich,,, dann") == "Ja, Tatsächlich, dann"
    assert SP.text_sauber("Ich bin in Ordnung, I think.") == "Ich bin in Ordnung,"
    assert SP.text_sauber("Gut gut gut gut gut.") == "Gut."
    for t in ("Okay, so machen wir das.", "Ich habe 3 Karten und einen Joker!", "Er hat seine Bücher und Schiffe."):
        assert SP.text_sauber(t) == t


def test_canary_muell_fliegt_raus_echte_saetze_bleiben():
    assert SP.verschmelzen("T S F", [], 2.0) == []
    assert SP.verschmelzen("1000000000000000", [], 2.0) == []
    # Leise Sprache: Parakeet hört nichts, Canary einen echten Satz -> bleibt.
    assert [w for _, w in SP.verschmelzen("Können sie abwechseln?", [], 2.0)] == ["Können", "sie", "abwechseln?"]
    # Lange Strecke Müll nur bei Canary: raus. Echte Wörter: bleiben.
    para = [(0.0, "Ich"), (0.3, "ziehe"), (2.5, "Axt")]
    erg = SP.verschmelzen("Ich ziehe T S F T Axt", para, 3.0)
    assert [w for _, w in erg] == ["Ich", "ziehe", "Axt"]
    erg = SP.verschmelzen("Ich ziehe jetzt meine große Axt", para, 3.0)
    assert [w for _, w in erg] == ["Ich", "ziehe", "jetzt", "meine", "große", "Axt"]
    erg = SP.verschmelzen("Ich ziehe die Axt", para, 3.0)
    assert [w for _, w in erg] == ["Ich", "ziehe", "die", "Axt"]


def test_kleine_sprecher_gehen_an_den_naechsten():
    A_ = SP.Abschnitt
    ab = [A_(0, 30, 0, "a"), A_(30, 31, 5, "Rascheln"), A_(31, 60, 1, "b"), A_(60, 61, 7, "Fetzen"), A_(61, 90, 0, "c")]
    erg = SP.kleine_sprecher_weg(ab)
    assert {a.sprecher for a in erg} == {0, 1}
    assert erg[1].sprecher in (0, 1) and erg[3].sprecher in (0, 1)


def test_kurze_englische_zeilen_fliegen_raus_deutsche_bleiben():
    # Aus dem Headset-Test mit Babygeschrei (31.10.)
    assert SP.text_sauber("It's fun.") == ""
    assert SP.text_sauber("The wrong closed") == ""
    assert SP.text_sauber("Ah ja.") == "Ah ja."
    assert SP.text_sauber("Cool, so geht das") == "Cool, so geht das"
    assert SP.text_sauber("Korgo greift an!") == "Korgo greift an!"
    assert SP.text_sauber("Wechselt man sie??") == "Wechselt man sie?"
