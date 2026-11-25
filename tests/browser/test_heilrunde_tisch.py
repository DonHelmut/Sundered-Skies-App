"""🩹 Heilen-Runde am echten Tisch (Kalle, 25.11.2026, Variante A): Knopf statt
„Alle heilen", K.O.-Probe → Verletzung, Heilen, Rast, Fertig - SL und Handys.
Bilder mit SWI_HEILEN_BILDER=<ordner>."""
import os

from hilfe import voller_tisch

Z = os.environ.get("SWI_HEILEN_BILDER", "")


class _Bild:
    def __init__(self, seite):
        self.s = seite

    def __call__(self, name):
        if Z:
            os.makedirs(Z, exist_ok=True)
            self.s.screenshot(path=os.path.join(Z, name))


def test_heilrunde_am_tisch(tisch):
    sl, hs = voller_tisch(tisch, handys=(("Tessa","iphone"),("Korgo","iphone"),("Mira","iphone")))
    g = tisch.gm
    ids = {c["name"]: c["id"] for c in sl.state()["combatants"] if c.get("kind")=="player"}
    g({"type":"end_combat"})
    g({"type":"set_status","id":ids["Tessa"],"wounds":2})
    g({"type":"set_status","id":ids["Korgo"],"wounds":3})
    g({"type":"set_status","id":ids["Korgo"],"out":True})
    g({"type":"set_status","id":ids["Mira"],"wounds":1})
    sl.page.set_viewport_size({"width":1366,"height":768})
    sl.page.mouse.move(5,5); sl.js("() => render()"); sl.page.wait_for_timeout(400)
    sl.js("() => document.querySelectorAll('.anfragen-schweb').forEach(e=>e.remove())")
    _Bild(sl)("0_knopf.png")
    sl.klick("[data-act=heilrunde-start]"); sl.page.wait_for_timeout(500)
    sl.page.mouse.move(5,5); sl.js("() => render()")
    _Bild(sl)("1_start.png")
    sl.klick(f"[data-act=heil-ko][data-id={ids['Korgo']}][data-erg=ja]"); sl.page.wait_for_timeout(300)
    sl.klick(f"[data-act=heil-verletzung][data-id={ids['Korgo']}]"); sl.page.wait_for_timeout(300)
    sl.klick(f"[data-act=heil-wurf][data-id={ids['Tessa']}][data-erg='1']"); sl.page.wait_for_timeout(300)
    sl.klick(f"[data-act=heil-wurf][data-id={ids['Mira']}][data-erg='1']"); sl.page.wait_for_timeout(500)
    sl.page.mouse.move(5,5); sl.js("() => render()")
    _Bild(sl)("2_mitten.png")
    sl.klick("[data-act=heil-rast]"); sl.page.wait_for_timeout(500)
    sl.page.mouse.move(5,5); sl.js("() => render()")
    _Bild(sl)("3_rast.png")
    for h, n in zip(hs, ("tessa","korgo","mira")):
        h.js("() => document.querySelectorAll('button').forEach(b => { if (/Schließen/.test(b.textContent)) b.click(); })")
        h.page.wait_for_timeout(300)
        _Bild(h)(f"4_handy_{n}_meldung.png")
        for _ in range(5):
            if h.page.locator("[data-act=dismiss-msg]").count():
                h.page.locator("[data-act=dismiss-msg]").first.dispatch_event("click"); h.page.wait_for_timeout(200)
        h.page.evaluate("() => document.querySelectorAll('.toast, .meldung-toast').forEach(e => e.remove())")
        h.page.wait_for_timeout(4500 if Z else 200)
        _Bild(h)(f"4_handy_{n}.png")
    st = sl.state()
    korgo = next(c for c in st["combatants"] if c["name"] == "Korgo")
    assert korgo["verletzungen"] and korgo["verletzungen"][0]["dauer"] == "wunden"
    assert next(c for c in st["combatants"] if c["name"] == "Mira")["status"]["wounds"] == 0
    assert "🦴" in hs[1].text()
    sl.klick("[data-act=heilrunde-ende]"); sl.page.wait_for_timeout(500)
    sl.page.mouse.move(5,5); sl.js("() => render()")
    _Bild(sl)("5_fertig.png")
    assert sl.state()["heilrunde"] is None
    assert not tisch.alle_fehler()
