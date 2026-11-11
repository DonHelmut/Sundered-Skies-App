"""Flüssig und ruhig am Handy: Austeilen, Aufdecken, Dran, Treffer.

Gemessen wird, was im Browser messbar ist, unabhängig von der Grafikkarte:
- Was gerade animiert, darf nur transform/opacity bewegen (alles andere malt
  das Handy in jedem Frame neu - das ist das Ruckeln).
- Steht nichts an, zeichnet sich die Seite nicht neu und nichts springt.
- Beim Austeilen/Aufdecken auf einem gedrosselten „Billig-Handy" (CPU 4×
  langsamer) gibt es kein langes Stocken.
"""
import pytest
from hilfe import voller_tisch

ERLAUBT = {"transform", "opacity", "offset", "easing", "composite", "computedOffset",
           "visibility"}
# Wie in tests/test_design_regeln.py: bewusste kurze Ausnahmen. Dazu der kleine
# SVG-Ring der Zug-Uhr (stroke), der nur ein paar Pixel neu malt.
AUSNAHMEN = {"irisOut", "wipeOff", "jokerRow", "panelAbgelegt", "stroke-dashoffset", "stroke"}

_ANIMATIONEN_JS = """() => document.getAnimations().map(a => {
  const props = new Set();
  (a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : []).forEach(k =>
    Object.keys(k).forEach(p => props.add(p)));
  return [a.animationName || a.transitionProperty || '?', [...props]];
})"""

_BEOBACHTEN_JS = """() => {
  window.__lt = []; window.__ls = []; window.__renders = 0;
  if (!window.__beob) {
    window.__beob = true;
    new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration))))
      .observe({type: 'longtask'});
    new PerformanceObserver(l => l.getEntries().forEach(e => {
      if (!e.hadRecentInput) (e.sources || []).forEach(s => window.__ls.push(
        String((s.node && (s.node.className || s.node.nodeName)) || '?').slice(0, 40)));
    })).observe({type: 'layout-shift'});
    const app = document.getElementById('app');
    new MutationObserver(m => { if (m.some(x => x.type === 'childList' && x.target.closest &&
      !x.target.closest('#timerval, #al-uhr'))) window.__renders++; })
      .observe(app, {childList: true, subtree: true});
  }
}"""


def _schlechte_animationen(seite):
    schlecht = []
    for name, props in seite.js(_ANIMATIONEN_JS):
        if name in AUSNAHMEN:
            continue
        # Kurze Farbwechsel (Knopf wird rot/grün, 0,15 s) malen nur den einen
        # Knopf kurz neu - kein Ruckeln. Dauerhafte Effekte laufen als Keyframes.
        if name.endswith("color"):
            continue
        rest = set(props) - ERLAUBT
        if rest:
            schlecht.append(f"{name}: {sorted(rest)}")
    return schlecht


def _kampf_am_handy(tisch, groesse="iphone"):
    sl = tisch.sl()
    h = tisch.handy("Tessa", groesse)
    tisch.handy("Korgo", "klein")
    tisch.gm({"type": "set_timer", "seconds": 120})
    tisch.gm({"type": "add_npc", "name": "Ork", "count": 2})
    return sl, h


def _drosseln(h, faktor=4):
    cdp = h.ctx.new_cdp_session(h.page)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": faktor})
    return cdp


def _aufdecken(h):
    knopf = h.locator("[data-act=daumen-aufdecken]").first
    knopf.wait_for()
    h.wait_for_timeout(750)          # Daumen-Leiste schluckt Tipps kurz nach Wechsel
    knopf.click()


_RUHIG_JS = """() => {
  if (!window.__still) {
    window.__still = performance.now();
    new MutationObserver(m => { if (m.some(x => x.type === 'childList' && x.target.closest &&
      !x.target.closest('#timerval, #al-uhr'))) window.__still = performance.now(); })
      .observe(document.getElementById('app'), {childList: true, subtree: true});
  }
  return !(App.revealLockUntil && Date.now() < App.revealLockUntil) && !App.pendingRender
    && performance.now() - window.__still > 1000;
}"""


def _warte_bis_ruhig(h, frist=15000):
    """Wartet, bis die Aufdeck-Sperre vorbei, der aufgeschobene Stand gezeichnet
    und die Seite 1 s lang unverändert ist. Vorher feste 1,5 s: auf dem
    langsamen Windows-Runner der CI dauerte die Aufdeck-Animation länger, der
    „Du bist dran"-Stand kam erst danach (App.pendingRender) - mitten in die
    Messung, Test rot (04.11., 2.0.1). Wer sich nie beruhigt, läuft in die
    Frist und ist zu Recht rot."""
    h.page.wait_for_function(_RUHIG_JS, timeout=frist, polling=100)


def _lauf(tisch, h, schritte):
    """Spielt die Schritte ab und prüft dabei alle 150 ms die laufenden
    Animationen. Gibt alle Verstöße zurück."""
    verstoesse = set()
    for name, aktion, dauer in schritte:
        aktion()
        for _ in range(int(dauer / 150)):
            for v in _schlechte_animationen(h):
                verstoesse.add(f"{name} – {v}")
            h.wait_for_timeout(150)
    return verstoesse


@pytest.mark.parametrize("groesse", ["klein", "iphone", "tablet"])
def test_handy_animiert_nur_fluessige_eigenschaften(tisch, groesse):
    sl, h = _kampf_am_handy(tisch, groesse)
    me = lambda: h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")  # noqa: E731
    verstoesse = _lauf(tisch, h, [
        ("Austeilen", lambda: tisch.gm({"type": "new_round", "runde": 0}), 1500),
        ("Aufdecken", lambda: _aufdecken(h), 3500),
        ("Dran", lambda: (tisch.gm({"type": "set_active", "id": me()}),
                          tisch.gm({"type": "release"})), 1500),
        ("Treffer", lambda: tisch.gm({"type": "apply_hit", "id": me()}), 1500),
        ("Neue Runde", lambda: tisch.gm({"type": "new_round", "runde": 1}), 1500),
    ])
    assert not verstoesse, "Ruckel-Animationen am Handy:\n  " + "\n  ".join(sorted(verstoesse))


def test_handy_ist_ruhig_wenn_nichts_passiert(tisch):
    """Warten auf den eigenen Zug, Karte offen, Uhr läuft: keine Neuzeichnung
    der Seite, nichts springt."""
    sl, h = _kampf_am_handy(tisch)
    tisch.gm({"type": "new_round", "runde": 0})
    _aufdecken(h)
    h.wait_for_timeout(3500)          # Aufdeck-Animation durch
    me = h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")
    tisch.gm({"type": "set_active", "id": me})
    tisch.gm({"type": "release"})
    _warte_bis_ruhig(h)
    h.js(_BEOBACHTEN_JS)
    h.wait_for_timeout(3000)
    assert h.js("window.__renders") == 0, "Seite zeichnet sich ohne Anlass neu"
    assert h.js("window.__ls") == [], f"Im Ruhezustand springt etwas: {h.js('window.__ls')}"


def test_austeilen_und_aufdecken_ohne_langes_stocken(tisch):
    """Billig-Handy (CPU 4× gedrosselt): kein Hänger über 400 ms. Gemessen am
    Laptop beim Komplett-Test lag das Schlimmste bei ~150 ms - die Grenze fängt
    grobe Rückschritte, nicht das Rauschen langsamer Test-Rechner."""
    sl, h = _kampf_am_handy(tisch)
    h.js(_BEOBACHTEN_JS)
    _drosseln(h)
    tisch.gm({"type": "new_round", "runde": 0})
    h.wait_for_timeout(1500)
    _aufdecken(h)
    h.wait_for_timeout(3500)
    stocken = h.js("window.__lt")
    assert not stocken or max(stocken) < 400, f"Lange Hänger (ms): {stocken}"


@pytest.mark.parametrize("groesse", ["klein", "se", "iphone", "gross"])
def test_grosse_karte_passt_auf_den_bildschirm(tisch, groesse):
    """Die große Karte samt Aufdeck-Knopf soll ohne Scrollen zu sehen sein und
    nicht aus dem Bild ragen."""
    sl, h = _kampf_am_handy(tisch, groesse)
    tisch.gm({"type": "new_round", "runde": 0})
    h.locator("#bigcard").wait_for()
    h.wait_for_timeout(800)
    box = h.locator("#bigcard").bounding_box()
    breite = h.js("window.innerWidth")
    assert box["x"] >= 0 and box["x"] + box["width"] <= breite + 1, box
    assert box["width"] >= min(200, breite * 0.55), f"Karte zu klein: {box}"
    h.kein_waagrechtes_scrollen("große Karte")


def test_aufdecken_knopf_verschwindet_sofort(tisch):
    """Nach dem Tipp auf „Karte aufdecken" verschwindet der Knopf gleich - nicht
    erst nach der Dreh-Animation. Vorher stand er ~3 s unter der schon offenen
    Karte (gesperrtes Neuzeichnen), als hätte der Tipp nicht geklappt."""
    _sl, h = _kampf_am_handy(tisch)
    tisch.gm({"type": "new_round", "runde": 0})
    _aufdecken(h)
    h.wait_for_timeout(300)
    assert h.js("App.revealLockUntil > Date.now()"), "Animation sollte noch laufen"
    sichtbar = h.js("""() => { const b = document.querySelector('[data-act=daumen-aufdecken]');
      if (!b) return false; const l = b.closest('.daumen-leiste');
      return getComputedStyle(l).opacity !== '0' && getComputedStyle(l).pointerEvents !== 'none'; }""")
    assert not sichtbar, "„Karte aufdecken\" steht noch unter der offenen Karte"
    assert not tisch.alle_fehler()


def test_handy_feste_kopfleiste_und_reiter(tisch):
    """Kopfleiste mit Name/Bennies/Runde steht fest oben, darunter Reiter
    (Kalle, 11.11.2026, 2C + 5). Der Reiter bleibt über Neuladen gemerkt."""
    tisch.sl()
    h = tisch.handy("Korgo", "klein")
    tisch.gm({"type": "add_npc", "name": "Ork", "count": 2})
    tisch.gm({"type": "new_round", "runde": 0})
    h.warte_bis("() => !!document.querySelector('.handy-kopf .runden-zaehler')")
    kopf = h.js("""() => { const k = document.querySelector('.handy-kopf');
      return { pos: getComputedStyle(k).position, name: k.querySelector('.hk-name').textContent,
               muenzen: k.querySelectorAll('.muenze').length,
               pille: getComputedStyle(document.querySelector('.statusbar')).display }; }""")
    assert kopf == {"pos": "fixed", "name": "Korgo", "muenzen": 3, "pille": "none"}
    # Nichts verschwindet hinter der Leiste: der Inhalt beginnt darunter.
    assert h.js("document.querySelector('.handy-oben').getBoundingClientRect().top >= 46 - 1")
    h.kein_waagrechtes_scrollen("Kopfleiste schmal")
    h.reiter("notizen")
    assert h.page.locator("#notiz-neu").count() == 1 and h.page.locator("#bigcard").count() == 0
    # „Karte aufdecken" (unten, auf jedem Reiter) holt den Kampf-Reiter nach vorne.
    h.wait_for_timeout(750)          # Daumen-Leiste schluckt Tipps kurz nach Wechsel
    h.locator("[data-act=daumen-aufdecken]").first.click()
    h.warte_bis("() => !!document.querySelector('[data-reiter=kampf].an') && !!document.querySelector('#bigcard')")
    h.warte_bis("() => myCombatant().revealed")
    # Der gewählte Reiter bleibt über Neuladen.
    h.reiter("notizen")
    h.reload()
    h.warte_bis("() => App.joined && !!document.querySelector('[data-reiter=notizen].an')")
    assert not tisch.alle_fehler()


def test_karten_6_und_9_unterstrichen(tisch):
    """Die untere Ecke steht auf dem Kopf - 6 und 9 tragen einen Strich (1B)."""
    sl = tisch.sl()
    svg = sl.js("""() => ['6', '9', '8'].map(r => Cards.renderCardSVG({id: 'spades-' + r, suit: 'spades', rank: r}, null))""")
    assert svg[0].count('text-decoration="underline"') == 2
    assert svg[1].count('text-decoration="underline"') == 2
    assert "underline" not in svg[2]


# --- Runde 11.11.2026 abends: Kampf beenden, schlanke Handy-Liste, Anfragen
# schweben, beim SL rückt nichts mehr ---------------------------------------

def _oben(seite, selektor):
    return seite.js("(q) => Math.round(document.querySelector(q).getBoundingClientRect().top)", selektor)


def test_kampf_beenden_handys_sofort_ruhig(tisch):
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    h.js("() => document.querySelectorAll('[data-act=dismiss-msg]').forEach(b => b.click())")
    assert "Gerade kein Kampf" not in h.text()
    sl.klick("[data-act=kampf-beenden]")
    sl.dialog_knopf("Kampf beenden")
    sl.warte_bis("() => App.state.round === 0 && !App.state.combatants.some(c => c.kind === 'npc')")
    h.warte_bis("() => document.body.innerText.includes('Gerade kein Kampf')")
    text = h.text()
    assert "nicht im Kampf" not in text and "Nicht im Kampf" not in text
    # SL: keine „Nicht im Kampf"-Liste, Knopf weg, Spieler stehen bereit.
    sl.warte_bis("() => !document.querySelector('[data-act=kampf-beenden]')")
    assert not sl.page.locator("[data-act=alle-wieder-rein]").count()
    assert all(not c["benched"] for c in sl.state()["combatants"])
    # Außerhalb des Kampfes steht „Alle heilen" fest in der Zeile (Kalle,
    # 11.11.2026) und heilt, wenn jemand verletzt ist.
    knopf = sl.page.locator(".kampf-knoepfe [data-act=alle-heilen]")
    assert knopf.count() == 1 and knopf.is_disabled()
    held = sl.state()["combatants"][0]
    tisch.gm({"type": "apply_hit", "id": held["id"], "steigerungen": 1})
    sl.warte_bis("() => !document.querySelector('.kampf-knoepfe [data-act=alle-heilen]').disabled")
    sl.klick(".kampf-knoepfe [data-act=alle-heilen]")
    sl.warte_bis("(id) => !App.state.combatants.find(c => c.id === id).status.wounds", held["id"])
    assert sl.page.locator(".kampf-knoepfe [data-act=alle-heilen]").count() == 1
    sl.kein_waagrechtes_scrollen("Knopfzeile ohne Kampf")
    # Die zwei Symbole ohne Text gibt es in der Zeile nicht mehr.
    assert not sl.page.locator(".kampf-knoepfe [data-act=reset], [data-act=clear-all]").count()


def test_sl_anfrage_und_kampfknoepfe_schieben_nichts(tisch):
    sl, hs = voller_tisch(tisch)          # eine Anfrage (Wunde +) liegt schon an
    sl.warte_bis("() => !!document.querySelector('.anfragen-schweb')")
    zonen, liste = _oben(sl, "[data-sec=zones]"), _oben(sl, ".order-heading, .combatant")
    assert sl.js("() => getComputedStyle(document.querySelector('.anfragen-schweb')).position") == "fixed"
    sl.klick(".anfragen-schweb [data-act=req-dismiss]")
    sl.warte_bis("() => !document.querySelector('.anfragen-schweb')")
    assert _oben(sl, "[data-sec=zones]") == zonen, "Kampfzonen sind beim Wegklicken der Anfrage verrutscht"
    # Gegner fällt: „🧹 … weg" erscheint IN der Knopfzeile, die Reihenfolge bleibt stehen.
    pirat = next(c for c in sl.state()["combatants"] if c["name"] == "Pirat 1")
    tisch.gm({"type": "set_status", "id": pirat["id"], "out": True})
    sl.warte_bis("() => !!document.querySelector('[data-act=clear-defeated]')")
    assert _oben(sl, ".order-heading, .combatant") == liste, "Reihenfolge ist verrutscht"
    assert _oben(sl, "[data-sec=zones]") == zonen


def test_handy_reihenfolge_eine_zeile(tisch):
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    h.js("() => document.querySelectorAll('[data-act=dismiss-msg]').forEach(b => b.click())")
    _aufdecken(h)
    h.warte_bis("() => document.querySelectorAll('.order .combatant').length > 3", frist=8000)
    assert not h.page.locator(".order .combatant .zone-chip").count()
    assert "WC" not in h.js("() => [...document.querySelectorAll('.order .combatant .badges')].map(e => e.innerText).join(' ')")
    hoehen = h.js("() => [...document.querySelectorAll('.order .combatant')].map(e => Math.round(e.getBoundingClientRect().height))")
    assert max(hoehen) <= 62, f"Zeilen zu hoch (zweizeilig?): {hoehen}"
    h.kein_waagrechtes_scrollen("Reihenfolge")
