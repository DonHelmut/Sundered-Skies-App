"""Kampfbeginn (Kalle, 25.11.2026): Teilt der SL aus, springen alle Handys auf
den Reiter ⚔ Kampf - einmal je Kampf, nicht mitten ins Tippen hinein."""
import os
from pathlib import Path

AN = "(n) => !!document.querySelector(`[data-act=handy-reiter][data-reiter=${n}].an`)"


def _bild(seite, name):
    ziel = os.environ.get("SWI_KAMPF_REITER_BILDER")
    if ziel:
        Path(ziel).mkdir(parents=True, exist_ok=True)
        seite.screenshot(path=str(Path(ziel) / name))


def _kampf(tisch, sl):
    tisch.gm({"type": "add_npc", "name": "Pirat", "count": 1})
    tisch.gm({"type": "new_round", "runde": sl.state()["round"]})


def test_kampfbeginn_springt_auf_kampf(tisch):
    sl = tisch.sl()
    a, b = tisch.handy("Tessa"), tisch.handy("Korgo", "klein")
    a.reiter("bogen")
    b.reiter("notizen")
    _bild(a, "1_vorher_bogen.png")

    _kampf(tisch, sl)
    a.warte_bis(AN, "kampf")
    b.warte_bis(AN, "kampf")
    if os.environ.get("SWI_KAMPF_REITER_BILDER"):
        a.page.wait_for_timeout(3000)   # Runden-Banner abklingen lassen
    _bild(a, "2_kampf_beginnt.png")

    # Einmal je Kampf: wer wieder in den Bogen geht, bleibt dort.
    a.reiter("bogen")
    tisch.gm({"type": "new_round", "runde": sl.state()["round"]})
    a.page.wait_for_timeout(500)
    assert a.js("App.handyReiter") == "bogen"

    # Neu laden mitten im Kampf: gemerkter Reiter bleibt (kein zweiter Sprung).
    a.page.reload()
    a.warte_bis("() => App.joined && !!document.querySelector('.handy-reiter')")
    a.warte_bis(AN, "bogen")

    # Handy kennt diesen Kampf noch nicht (z. B. war beim Austeilen aus):
    # beim Laden auf ⚔ Kampf, auch wenn zuletzt der Bogen gemerkt war.
    a.reiter("bogen")
    a.js("() => localStorage.removeItem('kampfReiterNr')")
    a.page.reload()
    a.warte_bis("() => App.joined && !!document.querySelector('.handy-reiter')")
    a.warte_bis(AN, "kampf")
    a.reiter("bogen")

    # Kampf vorbei, nächster Kampf: wieder umspringen.
    tisch.gm({"type": "end_combat"})
    a.warte_bis("() => App.state.round === 0")
    assert a.js("App.handyReiter") == "bogen"
    _kampf(tisch, sl)
    a.warte_bis(AN, "kampf")


def test_tippen_wird_nicht_unterbrochen(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    h.reiter("notizen")
    h.page.locator("#notiz-neu").click()
    h.page.keyboard.type("Der Wirt")
    _kampf(tisch, sl)
    h.warte_bis("() => App.state.round === 1")
    h.page.wait_for_timeout(1000)
    assert h.js("App.handyReiter") == "notizen"
    assert h.page.locator("#notiz-neu").input_value() == "Der Wirt"
    # Feld verlassen -> danach umspringen, Entwurf bleibt erhalten.
    h.js("() => document.activeElement.blur()")
    h.warte_bis(AN, "kampf", frist=3000)
    assert h.js("App.notizNeu") == "Der Wirt"
