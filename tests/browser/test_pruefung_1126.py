"""Tiefenprüfung 26.11.2026: Funde aus dem durchgespielten Abend (SL + 5 Handys)."""


def test_aufdecken_macht_handy_nicht_breiter(tisch):
    """Nebel/Scherben quollen beim Aufdecken der eigenen großen Karte gut
    200 px über den Rand - das Handy ließ sich kurz seitwärts wischen."""
    sl = tisch.sl()
    tisch.gm({"type": "add_npc", "name": "Pirat", "count": 2})
    hs = []
    for stil, name, groesse in (("mist", "Tessa", "iphone"), ("shatter", "Korgo", "klein")):
        h = tisch.handy(name, groesse)
        h.js("(s) => localStorage.setItem('reveal', s)", stil)
        h.page.reload()
        h.warte_bis("() => App.joined && App.myPlayerId && App.state")
        h.js("""() => { window.__breit = 0; const f = () => { window.__breit = Math.max(window.__breit,
            document.documentElement.scrollWidth - innerWidth); requestAnimationFrame(f); }; f(); }""")
        hs.append(h)
    tisch.gm({"type": "new_round", "runde": 0})
    for h in hs:
        h.warte_bis("() => !!document.querySelector('[data-act=daumen-aufdecken]')")
        h.page.wait_for_timeout(800)
        h.js("() => document.querySelector('[data-act=daumen-aufdecken]').click()")
    sl.page.wait_for_timeout(4000)
    for h in hs:
        assert h.js("() => window.__breit") <= 1, (h.name, h.js("() => window.__breit"))
        # Danach ist die Seite wieder ganz normal (nichts bleibt abgeschnitten).
        h.warte_bis("() => !document.documentElement.classList.contains('nebel-laeuft')", frist=8000)


def test_heilen_karte_zeigt_ko_probe_nach_aufwecken(tisch):
    sl = tisch.sl()
    tisch.handy("Tessa")
    tisch.handy("Korgo")
    ids = {c["name"]: c["id"] for c in sl.state()["combatants"]}
    tisch.gm({"type": "set_status", "id": ids["Korgo"], "wounds": 3, "out": True})
    tisch.gm({"type": "heilrunde_start"})
    sl.klick(f"[data-act=heil-wurf][data-id={ids['Korgo']}][data-erg='1']")
    sl.warte_bis("(id) => !App.state.combatants.find(c => c.id === id).status.out", ids["Korgo"])
    sl.warte_bis("(id) => !!document.querySelector(`[data-act=heil-ko][data-id='${id}']`)", ids["Korgo"])


def test_verletzung_selbst_eintragen(tisch):
    """Kalle 26.11.2026: „Verletzungen sind nur Vorschläge, was eigenes eintragen"."""
    import os
    sl = tisch.sl()
    h = tisch.handy("Korgo")
    kid = next(c["id"] for c in sl.state()["combatants"] if c["name"] == "Korgo")
    tisch.gm({"type": "set_status", "id": kid, "wounds": 3, "out": True})
    tisch.gm({"type": "heilrunde_start"})
    sl.klick(f"[data-act=heil-ko][data-id={kid}][data-erg=nein]")
    bild = os.environ.get("SWI_VERL_BILD")
    sl.warte_bis("(id) => !!document.querySelector(`[data-act=heil-verletzung-selbst][data-id='${id}']`)", kid)
    if bild:
        sl.page.mouse.move(5, 5); sl.page.wait_for_timeout(400)
        sl.locator(f"[data-hr='{kid}']").screenshot(path=bild + "_0.png")
    sl.klick(f"[data-act=heil-verletzung-selbst][data-id={kid}]")
    sl.page.locator(".app-dialog-eingabe").fill("Ohr ab")
    sl.dialog_knopf("Eintragen")
    sl.warte_bis("(id) => (App.state.combatants.find(c => c.id === id).verletzungen || []).length", kid)
    if bild:
        sl.page.mouse.move(5, 5); sl.page.wait_for_timeout(400)
        sl.locator(f"[data-hr='{kid}']").screenshot(path=bild + "_1.png")
    sl.klick(f"[data-act=verletzung-text][data-id={kid}]")
    sl.page.locator(".app-dialog-eingabe").fill("Linkes Ohr ab")
    sl.dialog_knopf("Ändern")
    sl.warte_bis("(id) => App.state.combatants.find(c => c.id === id).verletzungen[0].ort === 'Linkes Ohr ab'", kid)
    h.warte_bis("() => document.body.innerText.includes('Linkes Ohr ab')")
    if bild:
        sl.page.mouse.move(5, 5); sl.page.wait_for_timeout(400)
        sl.locator(f"[data-hr='{kid}']").screenshot(path=bild + "_2.png")
