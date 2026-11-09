"""🎛 „Was nutzen wir heute?" und 📖 Anleitung (Kalle 08.11.2026)."""
from hilfe import voller_tisch


def test_nur_reihenfolge_blendet_kampf_aus_und_anleitung(tisch):
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    # Tessa ist dran, Zug läuft.
    tid = h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")
    tisch.gm({"type": "set_active", "id": tid})
    tisch.gm({"type": "release"})
    h.warte_bis("() => document.querySelector('[data-act=angriff-waehlen]')")
    assert sl.page.locator(".aktionsleiste [data-act=treffer-wahl]").count()

    # SL wählt oben 🎛 → „Nur Reihenfolge".
    sl.klick(".modus-kopf")
    sl.klick(".modus-kachel[data-k=nur]")
    sl.warte_bis("() => App.state.funktionen.angriff === false && App.state.funktionen.wunden === false")
    sl.warte_bis("() => document.querySelector('.modus-kachel.on[data-k=nur]')")
    sl.klick(".modus-fuss [data-act=modus-zu]")
    assert sl.page.locator(".modus-hg").count() == 0
    assert "Nur Reihenfolge" in sl.page.inner_text(".modus-kopf")
    # Leiste: kein Treffer/Heilung, keine Wunden-Spalte, keine Bennies.
    assert sl.page.locator("[data-act=treffer-wahl]").count() == 0
    assert sl.page.locator(".zustand-zelle").count() == 0
    assert "Pool" not in sl.page.inner_text("[data-sec=message] .sec-title")
    # Zonen bleiben (wo ist wer).
    assert sl.page.locator("details[data-sec=zones]").count() >= 1

    # Handy: nur noch „Zug bestätigen", keine Münzen, kein Gesund-Zustand.
    h.warte_bis("() => !document.querySelector('[data-act=angriff-waehlen]')")
    assert h.page.locator("[data-act=confirm-turn]").count()
    assert h.page.locator(".muenzen").count() == 0
    assert h.page.locator(".kz-ok").count() == 0
    h.kein_waagrechtes_scrollen("Nur Reihenfolge")

    # Einzelschalter: Notizen aus → Handy hat keine Notizen mehr.
    sl.klick(".modus-kopf")
    sl.klick(".modus-zeile[data-k=notizen]")
    h.warte_bis("() => App.state.funktionen.notizen === false")
    assert h.page.locator(".notiz-reiter").count() == 0
    # Notizen gehören nicht zur Vorlage - „Nur Reihenfolge" bleibt stehen.
    assert "Nur Reihenfolge" in sl.page.inner_text(".modus-kopf")
    sl.klick(".modus-zeile[data-k=bennies]")
    sl.warte_bis("() => App.state.funktionen.bennies === true")
    assert "Eigene Auswahl" in sl.page.inner_text(".modus-kopf")
    sl.page.keyboard.press("Escape")
    assert sl.page.locator(".modus-hg").count() == 0

    # 📖 Anleitung über ☰ Mehr: Kapitel „Treffer" fehlt (Wunden aus), Tasten ohne Z.
    sl.klick(".kopf-menue > summary")
    sl.klick("[data-act=anleitung-oeffnen]")
    nav = sl.page.inner_text(".anl-nav")
    assert "Runde & Karten" in nav and "Treffer & Wunden" not in nav
    sl.klick(".anl-nav [data-k=tasten]")
    assert "Ziel wählen" not in sl.page.inner_text(".anl-inhalt")
    sl.klick(".anl-nav [data-k=runde]")
    assert "Neue Runde" in sl.page.inner_text(".anl-inhalt")
    sl.klick(".modus-hg .anleitung [data-act=anleitung-zu]")
    assert sl.page.locator(".anleitung").count() == 0

    # Zurück auf „Voller Kampf": alles wieder da, Wunden waren nie weg.
    sl.klick(".modus-kopf")
    sl.klick(".modus-kachel[data-k=voll]")
    sl.warte_bis("() => App.state.funktionen.angriff === true")
    sl.klick(".modus-fuss [data-act=modus-zu]")
    sl.warte_bis("() => document.querySelector('.zustand-zelle')")
    h.warte_bis("() => document.querySelector('[data-act=angriff-waehlen]')")


def test_anleitung_am_schmalen_laptop(tisch):
    sl = tisch.sl(breite=600, hoehe=800)
    sl.klick(".kopf-menue > summary")
    sl.klick("[data-act=anleitung-oeffnen]")
    for k in ("start", "runde", "zonen", "treffer", "vorbereiten", "aufnahme", "sichern", "tasten"):
        sl.klick(f".anl-nav [data-k={k}]")
        assert sl.page.inner_text(".anl-inhalt").strip()
    sl.kein_waagrechtes_scrollen("Anleitung")
