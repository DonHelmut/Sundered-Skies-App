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


def test_erledigte_auswaehlen_loeschen_und_zurueck(tisch):
    """Variante D (Kalle 20.11.2026): gezielt einzelne erledigte Notizen weg -
    eigene und 👥 gemischt - mit ↶ Rückgängig."""
    tisch.sl()
    h = tisch.handy("Tessa")
    for i in range(4):
        h.js(f"() => gmAction({{type: 'gruppen_notiz', op: 'neu', index: {i}, eintrag: {{id: 'g{i}', text: 'Gruppe {i}', erledigt: true}}}})")
    h.js("""() => gmAction({type: 'notizen_setzen', eintraege: [
        {id: 'n1', text: 'Eigen offen'}, {id: 'n2', text: 'Eigen erledigt', erledigt: true}]})""")
    h.warte_bis("() => App.state.gruppenNotizen.length === 4 && (App.state.meineNotizen || []).length === 2")
    h.reiter("notizen")
    h.klick("[data-act=notiz-erl]")
    oben = h.js("document.querySelector('ul.zeilen.erledigt').getBoundingClientRect().top")
    h.klick("[data-act=notiz-wahl-an]")
    # Nichts springt: Liste bleibt an ihrer Stelle.
    assert h.js("document.querySelector('ul.zeilen.erledigt').getBoundingClientRect().top") == oben
    assert h.page.locator("[data-act=notiz-wahl-loeschen]").is_disabled()
    h.klick(".zeile.wahl[data-id=g1] .zt")
    h.klick(".zeile.wahl[data-id=n2] button.haken")
    assert "2 ausgewählt" in h.text()
    h.klick("[data-act=notiz-wahl-loeschen]")
    h.warte_bis("() => App.state.gruppenNotizen.length === 3 && App.state.meineNotizen.length === 1")
    assert "2 Notizen gelöscht" in h.text()
    h.klick("[data-act=notiz-zurueck]")
    h.warte_bis("() => App.state.gruppenNotizen.map(e => e.id).join() === 'g0,g1,g2,g3'"
                " && App.state.meineNotizen.map(e => e.id).join() === 'n1,n2'")
    assert not tisch.alle_fehler()
