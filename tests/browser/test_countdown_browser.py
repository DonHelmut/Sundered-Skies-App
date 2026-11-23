"""⏳ Countdown für alle (Kalle, 23.11.2026) im Browser: SL setzt ihn per
Knopf, Handy zeigt ihn in der Dran-Leiste, ohne dass etwas verrutscht."""
import os
from pathlib import Path

from hilfe import voller_tisch


def _bild(seite, name):
    ziel = os.environ.get("SWI_COUNTDOWN_BILDER")
    if ziel:
        Path(ziel).mkdir(parents=True, exist_ok=True)
        seite.screenshot(path=str(Path(ziel) / name))


def test_countdown_sl_und_handy(tisch):
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    for _ in range(3):
        if h.page.locator("[data-act=dismiss-msg]").count():
            h.klick("[data-act=dismiss-msg]")
            h.page.wait_for_timeout(300)
    leiste = h.page.locator(".dran-leiste").first
    hoehe_vorher = leiste.bounding_box()["height"]
    karte_vorher = h.js("document.querySelector('.panel').getBoundingClientRect().top")

    if os.environ.get("SWI_COUNTDOWN_BILDER"):
        sl.page.wait_for_timeout(3000)   # Runden-Banner abklingen lassen
    sl.klick("[data-act=countdown]")
    sl.page.locator(".cd-was").fill("Schiff bricht")
    sl.page.locator(".cd-runden").fill("3")
    _bild(sl, "1_sl_dialog.png")
    sl.dialog_knopf("Starten")
    sl.warte_bis("() => App.state.countdown && App.state.countdown.runden === 3")
    sl.warte_bis("() => !!document.querySelector('.sec-title .cd-pille')")
    assert "noch 3 Runden" in sl.page.locator(".sec-title .cd-pille").inner_text()
    _bild(sl, "2_sl_laeuft.png")

    h.warte_bis("() => !!document.querySelector('.dran-leiste .cd-pille')")
    assert "noch 3" in h.page.locator(".dran-leiste .cd-pille").inner_text()
    assert leiste.bounding_box()["height"] == hoehe_vorher
    assert h.js("document.querySelector('.panel').getBoundingClientRect().top") == karte_vorher
    h.kein_waagrechtes_scrollen("Countdown")
    _bild(h, "3_handy.png")

    # Neue Runde zählt selbst runter.
    tisch.gm({"type": "new_round", "runde": sl.state()["round"]})
    h.warte_bis("() => /noch 2/.test(document.querySelector('.dran-leiste .cd-pille').textContent)")

    # Schnellwege: −1 bis 0 → „jetzt!", dann wegnehmen.
    for _ in range(2):
        sl.klick("[data-act=countdown]")
        sl.dialog_knopf("−1")
        sl.page.wait_for_timeout(300)
    h.warte_bis("() => /jetzt!/.test(document.querySelector('.dran-leiste .cd-pille').textContent)")
    _bild(h, "4_handy_jetzt.png")
    sl.klick("[data-act=countdown]")
    sl.dialog_knopf("Wegnehmen")
    h.warte_bis("() => !document.querySelector('.cd-pille')")
    assert leiste.bounding_box()["height"] == hoehe_vorher
