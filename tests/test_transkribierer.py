"""Transkribierer: Logik ohne Modelle (Zusammenlegen, Zerteilen, Ausgabeformat).
Die Modelle selbst (sherpa-onnx) laufen nur im eigenen Werkzeug, nicht hier."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "transkribierer"))
import transkribieren as T  # noqa: E402
from server.aufnahme import transkript_text  # noqa: E402


def test_halbsaetze_desselben_sprechers_werden_ein_beitrag():
    roh = [T.Abschnitt(0, 2, 1), T.Abschnitt(2.5, 4, 1), T.Abschnitt(4.2, 6, 0), T.Abschnitt(8, 9, 0)]
    erg = T.zusammenlegen(roh)
    assert [(a.start, a.ende, a.sprecher) for a in erg] == [(0, 4, 1), (4.2, 6, 0), (8, 9, 0)]


def test_lange_beitraege_werden_whisper_tauglich_zerteilt():
    stuecke = T.zerteilen(T.Abschnitt(0, 70, 0))
    assert all(e - s <= T.MAX_STUECK_S + 2 for s, e in stuecke)
    assert stuecke[0][0] == 0 and stuecke[-1][1] == 70
    # Kein Fetzen am Ende: Rest unter 2 s kommt ans letzte Stück.
    assert T.zerteilen(T.Abschnitt(0, 29, 0)) == [(0, 29)]


def test_wer_am_meisten_redet_ist_s00():
    ab = [T.Abschnitt(0, 5, 7, "Hallo"), T.Abschnitt(5, 60, 3, "Ihr seht ein Schiff."),
          T.Abschnitt(60, 61, 7, "")]
    text = T.transkript_text(ab)
    assert text.splitlines() == ["[00:00:00] S01: Hallo", "[00:00:05] S00: Ihr seht ein Schiff."]


def test_ausgabe_passt_in_den_prompt_schritt_der_app():
    text = T.transkript_text([T.Abschnitt(3725, 3730, 0, "Zieht Initiative!")])
    assert transkript_text(text) == "[01:02:05] S00: Zieht Initiative!"


def test_abspann_floskeln_fliegen_raus():
    assert T.text_sauber("Untertitel im Auftrag des ZDF") == ""
    assert T.text_sauber("  Ich   ziehe meine Axt. ") == "Ich ziehe meine Axt."
