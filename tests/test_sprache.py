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

    def falsch_transkribieren(pfad, modelle, personen, melden, stopp):
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
