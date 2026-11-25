"""Bedienbarkeit 25.11.2026 (Kalle: „alles gut" zu 1–3):
1 Freigeben/Weiter stehen immer an derselben Stelle, „ist dran" statt Platz-Zahl.
2 ⋯ der Aktionsleiste schwebt mit Wörtern und schiebt nichts; ↶ Zurück, ⏳ Countdown.
3 ⋯-Feld an der Zeile mit Überschriften, Entfernen abgesetzt."""
import os
from pathlib import Path

from hilfe import voller_tisch

BILDER = os.environ.get("SWI_BEDIENBARKEIT_BILDER")


def _bild(seite, name, **kw):
    if BILDER:
        Path(BILDER).mkdir(parents=True, exist_ok=True)
        seite.screenshot(path=str(Path(BILDER) / name), **kw)


def test_leiste_feste_plaetze_und_woerter(tisch):
    sl, _ = voller_tisch(tisch)
    sl.page.set_viewport_size({"width": 1366, "height": 768})
    st = sl.state()
    spieler = next(c for c in st["combatants"] if c["name"] == "Tessa")
    gegner = next(c for c in st["combatants"] if c["name"] == "Pirat 1")

    # 1 Freigeben/Weiter: gleiche Stelle, egal wer dran ist
    orte = {}
    for wer in (spieler, gegner):
        tisch.gm({"type": "set_active", "id": wer["id"]})
        sl.warte_bis("(i) => App.state.activeId === i", wer["id"])
        sl.page.wait_for_timeout(300)
        orte[wer["name"]] = sl.js("""() => ['release', 'skip-turn'].map(a =>
            Math.round(document.querySelector(`.al-haupt [data-act=${a}]`).getBoundingClientRect().x))""")
        assert "ist dran" in sl.page.locator(".al-wer").inner_text()
        _bild(sl, f"1_leiste_{wer['name'].replace(' ', '')}.png", clip={"x": 0, "y": 700, "width": 1366, "height": 68})
    assert orte["Tessa"] == orte["Pirat 1"], orte
    assert sl.page.locator(".al-platz").count() == 0

    # 2 Wörter statt Zeichen, ⋯ schiebt nichts
    assert "Zurück" in sl.page.locator("[data-act=undo]").inner_text()
    assert "Countdown" in sl.page.locator("[data-act=countdown]").inner_text()
    assert "Wildcard" in sl.page.locator(".combatant").filter(has_text="Tessa").inner_text()
    tisch.gm({"type": "set_active", "id": spieler["id"]})
    sl.warte_bis("(i) => App.state.activeId === i", spieler["id"])
    x = "() => Math.round(document.querySelector('[data-act=treffer-wahl]').getBoundingClientRect().x)"
    vorher = sl.js(x)
    sl.klick("[data-act=leiste-mehr]")
    sl.warte_bis("() => !!document.querySelector('.al-mehr-menue')")
    assert sl.js(x) == vorher
    text = sl.page.locator(".al-mehr-menue").inner_text()
    for wort in ("Angeschlagen", "K.O.", "Neue Karte", "Kampf-Einstellungen"):
        assert wort in text, text
    _bild(sl, "2_mehr.png")
    sl.klick(".al-mehr-menue [data-act=st-shaken]")
    sl.warte_bis("(i) => App.state.combatants.find(c => c.id === i).status.shaken", spieler["id"])
    assert sl.page.locator(".al-mehr-menue").count() == 1      # bleibt offen
    sl.page.mouse.click(750, 650)                              # leere Fläche
    sl.warte_bis("() => !document.querySelector('.al-mehr-menue')")

    # 3 ⋯-Feld an der Zeile
    sl.page.locator(".combatant").filter(has_text="Korgo").locator(".actions [data-act=zustand-umschalten]").click()
    sl.warte_bis("() => !!document.querySelector('.kontext-menue')")
    ueber = sl.js("() => [...document.querySelectorAll('.kontext-menue .km-ueber')].map(e => e.textContent)")
    assert ueber[:3] == ["Treffer – wie schlimm?", "Zustand", "Bennies"], ueber
    assert sl.page.locator(".kontext-menue .km-weg [data-act=remove-combatant]").count() == 1
    _bild(sl, "3_zeile.png")
    assert tisch.alle_fehler() == []
