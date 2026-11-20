"""📝 Notizen voll (20.11.2026): vorher kam eine neue 👥 Notiz still nicht an,
und bei den eigenen fielen die ältesten weg. Jetzt: Meldung, Text bleibt."""


def test_volle_gruppen_notizen_melden_und_text_bleibt(tisch):
    tisch.sl()
    h = tisch.handy("Tessa")
    for i in range(8):
        h.js(f"() => gmAction({{type: 'gruppen_notiz', op: 'neu', eintrag: {{id: 'g{i}', text: 'x'.repeat(1000)}}}})")
    h.warte_bis("() => (App.state.gruppenNotizen || []).length === 8")
    h.reiter("notizen")
    h.klick("[data-act=notiz-ziel][data-ziel=gruppe]")
    h.fill("#notiz-neu", "Treffpunkt Leuchtturm")
    h.klick("[data-act=notiz-hinzu]")
    h.warte_bis("() => !!document.querySelector('.app-dialog-hg')")
    assert "voll" in h.text()
    h.dialog_knopf("OK")
    assert h.js("document.getElementById('notiz-neu').value") == "Treffpunkt Leuchtturm"
    assert h.js("App.state.gruppenNotizen.length") == 8
    assert not tisch.alle_fehler()
