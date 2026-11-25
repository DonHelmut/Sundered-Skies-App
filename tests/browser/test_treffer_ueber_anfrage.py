"""Offene Treffer-Wahl liegt über der schwebenden Anfrage (25.11.2026): bei
1366×768 verdeckte die Anfrage-Karte unten rechts die untersten Ziele samt
„+3" - genau die Spielerseite, wenn ein Gegner zuschlägt."""
from hilfe import voller_tisch


def test_treffer_wahl_ueber_anfrage(tisch):
    sl, _ = voller_tisch(tisch)
    sl.page.set_viewport_size({"width": 1366, "height": 768})
    sl.warte_bis("() => !!document.querySelector('.anfragen-schweb')")
    sl.page.locator("[data-act=treffer-wahl]").dispatch_event("click")
    sl.warte_bis("() => !!document.querySelector('.al-treffer')")
    frei = sl.js("""() => [...document.querySelectorAll('.al-treffer [data-act=treffer-auf]')].every(b => {
        const r = b.getBoundingClientRect();
        const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!(e && e.closest('.al-treffer'));
      })""")
    assert frei, "Anfrage-Karte verdeckt Treffer-Knöpfe"
    assert tisch.alle_fehler() == []
