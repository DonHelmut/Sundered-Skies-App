"""Flüssig und ruhig am Handy: Austeilen, Aufdecken, Dran, Treffer.

Gemessen wird, was im Browser messbar ist, unabhängig von der Grafikkarte:
- Was gerade animiert, darf nur transform/opacity bewegen (alles andere malt
  das Handy in jedem Frame neu - das ist das Ruckeln).
- Steht nichts an, zeichnet sich die Seite nicht neu und nichts springt.
- Beim Austeilen/Aufdecken auf einem gedrosselten „Billig-Handy" (CPU 4×
  langsamer) gibt es kein langes Stocken.
"""
import pytest

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
    h.wait_for_timeout(1500)
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
