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
