"""Notizen als Einträge, Orte/Leute als Steckbrief (Kalle 28.11.2026, B + C):
mehrzeilig, bearbeitbar, eigene Felder, „Alle" als Inhaltsverzeichnis."""


def test_ort_anlegen_mit_eigenem_feld_und_verweis(tisch):
    tisch.sl()
    h = tisch.handy("Korgo")
    korgo2 = tisch.handy("Mira", "klein")
    h.js("""() => gmAction({type: 'gruppen_notiz', op: 'neu', eintrag:
        {id: 'p1', text: 'Vela', thema: 'Leute', felder: [['Wer ist das?', 'Hafenmeisterin']]}})""")
    h.warte_bis("() => (App.state.gruppenNotizen || []).length === 1")
    h.reiter("notizen")
    # „Alle": Kacheln für die festen Themen, Leute mit Vela.
    assert "Vela" in h.page.locator(".notiz-kachel[data-thema=Leute]").inner_text()
    h.klick(".notiz-kachel[data-thema=Orte]")
    # Orte: „＋ Ort" statt Eingabefeld, feste Felder stehen da.
    h.klick("[data-act=notiz-neu-steckbrief]")
    h.page.locator("#notiz-edit-titel").fill("Hier")
    felder = h.js("[...document.querySelectorAll('.zeile.bearbeiten .nk-label')].map(l => l.textContent)")
    assert felder[:3] == ["Exportschlager", "Was wir dort tun können", "Leute"]
    h.page.locator("#notiz-feld-0").fill("Leute")
    h.page.locator("#notiz-feld-2").fill("Vela")
    # Eigenes Feld über ＋ Feld.
    h.klick("[data-act=notiz-feld-neu]")
    h.page.locator(".app-dialog-eingabe").fill("Gefahren")
    h.dialog_knopf("Hinzufügen")
    h.page.locator("#notiz-feld-3").fill("Zoll\nnachts")
    h.page.locator("#notiz-edit").fill("Hafen nur bei Tag.")
    h.klick("[data-act=notiz-fertig]")
    # „Für alle" ist bei Orten vorgewählt: Mira sieht den Ort mit Feldern.
    korgo2.warte_bis("""() => (App.state.gruppenNotizen || []).some(n => n.text === 'Hier\\nHafen nur bei Tag.'
        && JSON.stringify(n.felder) === JSON.stringify([['Exportschlager', 'Leute'], ['Leute', 'Vela'], ['Gefahren', 'Zoll\\nnachts']]))""")
    # Aufgeklappt nach dem Anlegen; „Vela" ist ein Verweis und springt zu Leute.
    h.warte_bis("() => !!document.querySelector('li.karte.auf .notiz-verweis')")
    h.klick("li.karte.auf .notiz-verweis")
    h.warte_bis("() => App.notizFilter === 'Leute' && !!document.querySelector('li.karte.auf[data-id=p1]')")
    assert "Hafenmeisterin" in h.page.locator("li.karte[data-id=p1]").inner_text()
    # Bei einem zweiten Ort kommt „Gefahren" als Vorschlag.
    h.klick(".notiz-reiter[data-thema=Orte]")
    h.klick("[data-act=notiz-neu-steckbrief]")
    assert h.page.locator("[data-act=notiz-feld-neu][data-name=Gefahren]").count() == 1
    h.klick("[data-act=notiz-abbrechen]")
    h.kein_waagrechtes_scrollen("Notizen")


def test_enter_macht_neue_zeile_und_eintrag_bleibt_einer(tisch):
    tisch.sl()
    h = tisch.handy("Tessa", "se")
    h.reiter("notizen")
    feld = h.page.locator("#notiz-neu")
    feld.click()
    feld.type("Währung")
    h.page.keyboard.press("Enter")
    feld.type("100 Funken = 1 Splitter")
    h.page.keyboard.press("Enter")
    feld.type("100 Splitter = 1 Dreher")
    assert h.js("(App.state.meineNotizen || []).length") == 0, "Enter legt nicht mehr an"
    h.klick("[data-act=notiz-hinzu]")
    h.warte_bis("() => (App.state.meineNotizen || []).length === 1 && App.state.meineNotizen[0].text.split('\\n').length === 3")
    # Zugeklappt: Titel + erste Zeile; Tipp klappt auf, ✎ bearbeitet denselben Eintrag.
    karte = h.page.locator("li.karte", has_text="Währung").first
    assert "100 Funken" in karte.locator(".nk-unter").inner_text()
    karte.locator(".zt").click()
    h.klick("li.karte.auf [data-act=notiz-stift]")
    h.page.locator("#notiz-edit").fill("100 Funken = 1 Splitter\n100 Splitter = 1 Dreher\n100 Dreher = 1 Schicksal")
    h.klick("[data-act=notiz-fertig]")
    h.warte_bis("() => App.state.meineNotizen.length === 1 && App.state.meineNotizen[0].text.endsWith('1 Schicksal')")
    # Lokale Fassung gleicht sich mit der vom Server ab (sonst hinge sie fest).
    h.warte_bis("() => App.notizenLokal === null")
