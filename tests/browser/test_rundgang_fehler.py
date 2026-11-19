"""Durchleuchtung 19.11.2026: Fehler, die beim Rundgang auffielen."""
from hilfe import voller_tisch


def _nachrichten_weg(h):
    for _ in range(3):
        k = h.locator("[data-act=dismiss-msg]")
        if k.count():
            k.first.click()
            h.page.wait_for_timeout(300)


def test_sl_zahnrad_bleibt_beim_oeffnen_stehen(tisch):
    # Vorher rutschte das ⚙ beim Öffnen ~150 px nach unten (align-items: center
    # im hohen Menü) - weg vom Mauszeiger, zum Schließen musste man es suchen.
    sl = tisch.sl()
    vorher = sl.locator("#skin-gear").bounding_box()
    sl.klick("#skin-gear")
    sl.warte_bis("() => document.getElementById('skinbar').classList.contains('open')")
    nachher = sl.locator("#skin-gear").bounding_box()
    assert abs(nachher["y"] - vorher["y"]) < 2, (vorher, nachher)


def test_handy_kleine_knoepfe_haben_grosse_tippflaeche(tisch):
    sl, hs = voller_tisch(tisch, handys=(("Tessa", "klein"),))
    h = hs[0]
    _nachrichten_weg(h)
    # ⚙ ist optisch 30 px, getroffen wird es auch 6 px daneben.
    box = h.locator("#skin-gear").bounding_box()
    getroffen = h.js("([x, y]) => !!document.elementFromPoint(x, y).closest('#skin-gear')",
                     [box["x"] + box["width"] / 2, box["y"] + box["height"] + 5])
    assert getroffen
    h.reiter("notizen")
    haken = h.locator("button.haken").first.bounding_box()
    getroffen = h.js("([x, y]) => !!document.elementFromPoint(x, y).closest('button.haken')",
                     [haken["x"] + haken["width"] / 2, haken["y"] + haken["height"] + 7])
    assert getroffen


def test_rennen_platzhalter_passt(tisch):
    sl, hs = voller_tisch(tisch, handys=(("Tessa", "klein"),))
    h = hs[0]
    _nachrichten_weg(h)
    h.reiter("bogen")
    h.locator("button:has-text('Werte eintragen')").first.click()
    feld = h.locator("input[data-bogen=rennen]")
    assert feld.get_attribute("placeholder") == "z. B. 6"
