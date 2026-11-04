"""Erste Schritte: SL-Seite, Beitritt, Handy-Größen."""


def test_sl_und_handy_starten_ohne_fehler(tisch):
    sl = tisch.sl()
    assert "Kampf & Initiative".lower() in sl.text().lower()
    h = tisch.handy("Tessa", spieler="Stefan")
    sl.warte_bis("() => App.state.combatants.some(c => c.name === 'Tessa')")
    assert "Tessa" in h.text()
