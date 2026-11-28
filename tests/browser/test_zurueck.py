"""Wege zurück am Handy (Kalle, 28.11.2026: ein Kumpel fand nicht zurück)."""


def test_regeln_aus_einstellungen_liegen_oben(tisch):
    # „Regeln nachschlagen" im Einstellungen-Blatt öffnete die Regeln HINTER
    # dem Blatt - man sah nur weiter die Einstellungen.
    h = tisch.handy("Tessa")
    h.klick("#skin-gear")
    h.warte_bis("() => document.getElementById('skinbar').classList.contains('open')")
    h.klick("#skinbar [data-act=regeln-oeffnen]")
    h.warte_bis("() => !!document.querySelector('.protokoll-hg')")
    assert not h.js("document.getElementById('skinbar').classList.contains('open')")
    # Der Schließen-Knopf der Regeln ist wirklich obenauf (nichts darüber).
    oben = h.js("""() => { const b = document.querySelector('button[data-act=regeln-zu]');
      const r = b.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; }""")
    assert oben
    h.klick("button[data-act=regeln-zu]")
    h.warte_bis("() => !document.querySelector('.protokoll-hg')")


def test_gruppe_reiter_steckbrief_und_zurueck(tisch):
    # Reiter 👥 Gruppe ganz rechts (Kalle 28.11.2026): Mitspieler mit Bild und
    # Steckbrief, den jeder selbst ausfüllt - ohne Werte.
    tisch.sl()
    a = tisch.handy("Tessa", spieler="Kalle")
    b = tisch.handy("Korgo", "klein", spieler="Jonas")
    reiter = a.js("[...document.querySelectorAll('[data-act=handy-reiter]')].map(e => e.dataset.reiter)")
    assert reiter[-1] == "gruppe"
    b.reiter("gruppe")
    b.kein_waagrechtes_scrollen("Gruppe 320 px")

    # Eigener Steckbrief: Karte „Ich" antippen, ausfüllen, speichern.
    a.reiter("gruppe")
    a.klick(".gr-karte:has(.gr-siegel)")
    a.klick("[data-act=steck-bearbeiten]")
    a.fill("[data-steck=volk]", "Mensch")
    a.fill("[data-steck=satz]", "Himmelspiratin mit losem Mundwerk")
    a.fill("[data-steck=geschichte]", "Sucht das Schiff ihres Vaters.")
    a.klick("[data-act=steck-speichern]")
    a.warte_bis("() => !!document.querySelector('.st-satz')")
    a.klick(".st-seite [data-act=gruppe-zu]")
    a.warte_bis("() => !document.querySelector('.st-seite')")

    # Korgo sieht es; Werte (Parade …) stehen nirgends.
    b.warte_bis("() => document.querySelector('.gr-karte')?.textContent.includes('Mensch')")
    b.klick(".gr-karte:not(:has(.gr-siegel))")
    b.warte_bis("() => document.querySelector('.st-seite')?.textContent.includes('Himmelspiratin')")
    assert "Parade" not in b.js("document.querySelector('.st-seite').textContent")
    assert not b.page.locator(".st-seite [data-act=steck-bearbeiten]").count()
    # „‹ Zurück" liegt links oben und ist groß genug für den Daumen.
    r = b.js("(() => { const r = document.querySelector('.st-seite .zurueck-knopf').getBoundingClientRect(); return [r.x, r.y, r.height]; })()")
    assert r[0] < 40 and r[1] < 40 and r[2] >= 44
    # Zurück-Geste des Handys schließt nur die Seite, die App bleibt.
    b.page.go_back()
    b.warte_bis("() => !document.querySelector('.st-seite')")
    assert b.js("App.joined && !!document.querySelector('.gr-karte')")


def test_mitspieler_boegen_mit_werten_weg(tisch):
    tisch.sl()
    a = tisch.handy("Tessa")
    b = tisch.handy("Korgo")
    b.js("() => gmAction({type: 'sheet_update', bogen: {parade: '7', tempo: '6'}})")
    a.warte_bis("() => App.state.combatants.some(c => c.bogen && c.bogen.parade === '7')")
    a.reiter("bogen")
    assert not a.page.locator("[data-act=bogen-ansicht]").count()


def test_zurueck_geste_schliesst_fenster_und_verlauf_bleibt_sauber(tisch):
    tisch.sl()
    tisch.gm({"type": "protokoll_speichern", "text": "# Abend\nNebel.", "freigegeben": True})
    h = tisch.handy("Tessa")
    # „Was bisher geschah" geht von selbst auf (kein Kampf).
    h.warte_bis("() => !!document.querySelector('.protokoll-hg .zurueck-knopf')")
    h.page.wait_for_timeout(100)
    h.page.go_back()
    h.warte_bis("() => !document.querySelector('.protokoll-hg')")
    # Selbst geschlossen: kein Verlaufseintrag bleibt liegen.
    h.klick("#skin-gear")
    h.warte_bis("() => history.state && history.state.swiZurueck")
    h.klick("[data-act=einst-zu]")
    h.warte_bis("() => !(history.state && history.state.swiZurueck)")
    assert h.js("App.joined")
