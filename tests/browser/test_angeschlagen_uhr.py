"""Angeschlagen zu Zugbeginn (Kalle, 25.11.2026): die Zug-Uhr wartet auf die
Erholungs-Probe und läuft erst nach geschafft / Benny / nicht geschafft los."""
import os
from pathlib import Path

from test_ablauf import _meine, _tipp

BILDER = os.environ.get("ANGESCHLAGEN_BILDER")


def _bild(seite, name):
    if BILDER:
        Path(BILDER).mkdir(parents=True, exist_ok=True)
        seite.page.screenshot(path=str(Path(BILDER) / name))


def _dran_angeschlagen(tisch, h):
    tisch.gm({"type": "set_timer", "seconds": 30})
    tisch.gm({"type": "new_round", "runde": 0})
    meine = _meine(h)
    tisch.gm({"type": "set_status", "id": meine["id"], "shaken": True})
    tisch.gm({"type": "set_active", "id": meine["id"]})
    tisch.gm({"type": "release"})
    h.warte_bis("() => App.state.phase === 'running' && !!App.state.probeWartet")
    return meine


def test_handy_nicht_geschafft_startet_uhr(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    tisch.gm({"type": "add_npc", "name": "Ork"})
    meine = _dran_angeschlagen(tisch, h)
    assert sl.state()["timerEndsAt"] is None
    h.warte_bis("() => !!document.querySelector('.daumen-leiste [data-act=probe-verpatzt]')")
    sl.warte_bis("() => !!document.querySelector('.aktionsleiste [data-act=probe-verpatzt]:not([disabled])')")
    _bild(h, "1_handy_probe.png")
    _bild(sl, "1_sl_probe.png")

    _tipp(h.locator(".daumen-leiste [data-act=probe-verpatzt]"))
    sl.warte_bis("() => !!App.state.timerEndsAt && App.state.probeVerpatzt")
    st = sl.state()
    assert st["activeId"] == meine["id"] and st["phase"] == "running"
    # Handy: keine Probe-Knöpfe mehr, kein Angriff - nur Zug beenden.
    h.warte_bis("() => !document.querySelector('[data-act=probe-verpatzt]') && !!document.querySelector('.daumen-leiste [data-act=confirm-turn]')")
    assert h.locator("[data-act=angriff-waehlen]").count() == 0
    # SL: ✗ bleibt stehen (gesperrt) - nichts rutscht.
    sl.warte_bis("() => !!document.querySelector('.aktionsleiste [data-act=probe-verpatzt][disabled]')")
    _bild(h, "2_handy_nicht_geschafft.png")
    _bild(sl, "2_sl_nicht_geschafft.png")


def test_handy_geschafft_startet_uhr(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    _dran_angeschlagen(tisch, h)
    _tipp(h.locator(".daumen-leiste [data-act=player-request][data-kind=status]"))
    sl.warte_bis("() => !!App.state.timerEndsAt && !App.state.probeWartet")
    h.warte_bis("() => !!document.querySelector('.ring-wrap')")
    _bild(h, "3_handy_geschafft.png")


def test_sl_knopf_nicht_geschafft(tisch):
    sl = tisch.sl()
    tisch.gm({"type": "add_npc", "name": "Ork"})
    tisch.gm({"type": "set_timer", "seconds": 30})
    tisch.gm({"type": "new_round", "runde": 0})
    ork = sl.state()["combatants"][0]
    tisch.gm({"type": "set_status", "id": ork["id"], "shaken": True})
    tisch.gm({"type": "set_active", "id": ork["id"]})
    tisch.gm({"type": "release"})
    sl.warte_bis("() => !!document.querySelector('.aktionsleiste [data-act=probe-verpatzt]:not([disabled])')")
    sl.page.wait_for_timeout(400)
    vorher = sl.locator(".aktionsleiste [data-act=treffer-wahl]").bounding_box()
    _bild(sl, "4_sl_ork_vorher.png")
    sl.locator(".aktionsleiste [data-act=probe-verpatzt]").click()
    sl.warte_bis("() => !!document.querySelector('.aktionsleiste [data-act=probe-verpatzt][disabled]')")
    sl.page.wait_for_timeout(400)
    nachher = sl.locator(".aktionsleiste [data-act=treffer-wahl]").bounding_box()
    _bild(sl, "4_sl_ork_nachher.png")
    assert abs(vorher["x"] - nachher["x"]) < 1
