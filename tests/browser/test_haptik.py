"""Haptik-Runde (Kalle, 19.11.2026: Vorschläge 4, 5, 6) im echten Browser.

4 Rollende Zahlen, 5 Benny-Flug, 6 Drücken fühlbar. Geprüft wird, dass die
Effekte anspringen, nichts verschieben und den Seitentext nicht verfälschen
(die alte Zahl darf nur gemalt sein, nicht als Text danebenstehen).
"""
import time

from hilfe import voller_tisch


def _tessa_id(h):
    return h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")


def test_benny_rollt_und_fliegt(tisch):
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    cid = _tessa_id(h)
    vorher = h.js(f"App.state.combatants.find(c => c.id === '{cid}').bennies")
    name_vorher = h.locator(".hk-name").bounding_box()
    tisch.gm({"type": "benny_adjust", "id": cid, "delta": 1})
    h.warte_bis(f"() => App.state.combatants.find(c => c.id === '{cid}').bennies === {vorher + 1}")
    # Münze unterwegs, Zahl rollt - und der Name daneben bleibt, wo er war.
    h.warte_bis("() => !!document.querySelector('.benny-flug')", frist=1500)
    h.warte_bis(f"() => !!document.querySelector('[data-roll=\"benny-{cid}\"].roll-hoch')", frist=1500)
    assert h.locator(".hk-name").bounding_box() == name_vorher
    zahl = h.js(f"document.querySelector('[data-roll=\"benny-{cid}\"]').textContent")
    assert zahl == f"×{vorher + 1}", f"Alte Zahl steht als Text mit drin: {zahl!r}"
    # Fängt keine Tipps ab und räumt sich selbst weg.
    assert h.js("getComputedStyle(document.querySelector('.benny-flug')).pointerEvents") == "none"
    h.warte_bis("() => !document.querySelector('.benny-flug, .benny-funke, .benny-ring')", frist=3000)
    h.warte_bis("() => !document.querySelector('.roll-hoch, .roll-runter')", frist=2000)

    # Ausgeben: Münze steigt aus dem Zähler, Zahl rollt nach unten.
    tisch.gm({"type": "benny_adjust", "id": cid, "delta": -1})
    h.warte_bis("() => !!document.querySelector('.benny-flug.klein')", frist=1500)
    h.warte_bis(f"() => !!document.querySelector('[data-roll=\"benny-{cid}\"].roll-runter')", frist=1500)


def test_runde_rollt_ohne_textsalat(tisch):
    sl, hs = voller_tisch(tisch)
    runde = sl.state()["round"]
    # Erstes Zeichnen rollt nicht (sonst zählte jede Ansicht beim Öffnen hoch).
    assert not sl.js("document.querySelector('.roll-hoch')")
    tisch.gm({"type": "new_round", "runde": runde})
    sl.warte_bis(f"() => App.state.round === {runde + 1}")
    hs[0].warte_bis("() => !!document.querySelector('[data-roll=runde].roll-hoch')", frist=1500)
    assert f"Runde {runde + 1}" in hs[0].js("document.querySelector('.runden-zaehler').innerText").replace("\n", " ")


def test_knopf_leuchtet_unter_dem_finger(tisch):
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    knopf = h.locator("button.big").first
    box = knopf.bounding_box()
    h.mouse.move(box["x"] + 30, box["y"] + box["height"] / 2)
    h.mouse.down()
    assert h.js("document.querySelector('button.big').classList.contains('gedrueckt')")
    assert h.js("getComputedStyle(document.querySelector('button.big')).getPropertyValue('--fx')").strip() == "30px"
    h.mouse.up()
    assert not h.js("document.querySelector('button.big').classList.contains('gedrueckt')")
    time.sleep(0.6)
    assert not h.js("document.querySelector('button.big').classList.contains('drueck-licht')")
