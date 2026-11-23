"""🎙 Vorstellungsrunde (Kalle 23.11.2026, Variante D): wer noch fehlt, steht
da; „+ Gast" stellt jemanden vor, der nicht in der Initiative steht; sind
alle bekannt, zeigt die Klappe „✓ feste Plätze"."""
import os
import time

from hilfe import voller_tisch
from test_aufnahme_pause import FAKE_MIKRO, _aufnahme_panel_auf

BILD = os.environ.get("VORSTELLUNG_BILD")


def test_vorstellungsrunde_mit_gast_bis_feste_plaetze(tisch):
    sl, _ = voller_tisch(tisch)
    sl.js(FAKE_MIKRO)
    _aufnahme_panel_auf(sl)
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.rec.state === 'recording'")
    sl.warte_bis("() => !!document.querySelector('.aufn-stimmen[open]')")
    text = sl.page.locator(".aufn-stimmen").inner_text()
    assert "Noch vorstellen: Spielleiter, Tessa, Korgo" in text, text
    if BILD:
        sl.page.locator("details[data-sec=aufnahme]").screenshot(path=BILD.replace(".png", "_fehlt.png"))

    for wer in ("Spielleiter", "Tessa", "Korgo"):
        sl.klick(f"[data-act=aufn-stimme][data-figur={wer}]")
        sl.warte_bis("(w) => (Aufn.status.aktiv.stimmen || []).includes(w)", wer)
    assert "noch" not in sl.page.locator(".aufn-stimmen summary").inner_text()
    sl.klick("[data-act=aufn-gast]")
    sl.page.locator(".app-dialog-hg input").fill("Lena")
    sl.dialog_knopf("Vorstellen")
    sl.warte_bis("() => !!document.querySelector('[data-act=aufn-stimme][data-figur=Lena].on')")
    text = sl.page.locator(".aufn-stimmen").inner_text()
    assert "✓ feste Plätze" in text and "keine fremden Sprecher" in text, text
    sl.kein_waagrechtes_scrollen("Vorstellungsrunde")
    if BILD:
        sl.page.locator(".aufn-stimmen").scroll_into_view_if_needed()
        time.sleep(0.4)
        sl.page.locator("details[data-sec=aufnahme]").screenshot(path=BILD)
    sl.js("() => aufnahmeBeenden()")
    sl.warte_bis("() => !Aufn.rec", frist=15000)
    assert tisch.alle_fehler() == []
