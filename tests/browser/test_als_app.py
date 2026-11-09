"""📲 „Als App aufs Handy": Streifen einmal, Anleitung iPhone/Android (09.11.2026)."""


def test_streifen_einmal_und_anleitung(tisch):
    tisch.sl()
    h = tisch.handy("Mira")
    # Das Test-Chromium ist weder iPhone noch Android - Gerät vorgeben.
    h.js("() => { window.alsAppGeraet = () => 'ios'; alsAppStreifenPruefen(); }")
    h.warte_bis("() => document.getElementById('als-app-streifen')")
    h.klick(".als-app-los")
    assert "Zum Home-Bildschirm" in h.text()
    h.klick(".als-app-reiter[data-geraet=android]")
    assert "Zum Startbildschirm hinzufügen" in h.text()
    h.page.keyboard.press("Escape")
    # Nach „So geht's" nie wieder.
    assert h.js("() => localStorage.getItem('alsAppHinweisZu')") == "1"
    h.js("() => alsAppStreifenPruefen()")
    assert not h.js("() => !!document.getElementById('als-app-streifen')")


def test_kein_knopf_und_streifen_beim_sl(tisch):
    sl = tisch.sl()
    sl.js("() => { window.alsAppGeraet = () => 'ios'; alsAppStreifenPruefen(); }")
    assert not sl.js("() => !!document.getElementById('als-app-streifen')")
    assert not sl.page.locator("[data-act=als-app]").is_visible()
    assert tisch.alle_fehler() == []
