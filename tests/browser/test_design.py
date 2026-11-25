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
               // Schmales Handy: drei Bennies als eine Münze „×3" (Platz für den Namen).
               muenzen: [...k.querySelectorAll('.muenze')].filter(m => m.getBoundingClientRect().width).length
                 + ' ' + (k.querySelector('.mz-kurz .muenzen-zahl') || {}).textContent,
               pille: getComputedStyle(document.querySelector('.statusbar')).display }; }""")
    assert kopf == {"pos": "fixed", "name": "Korgo", "muenzen": "1 ×3", "pille": "none"}
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
    # Außerhalb des Kampfes steht der Heilen-Knopf fest in der Zeile (Kalle,
    # 11.11.2026; seit 25.11.2026 „🩹 Heilen-Runde" statt „Alle heilen").
    knopf = sl.page.locator(".kampf-knoepfe [data-act=heilrunde-start]")
    assert knopf.count() == 1 and knopf.is_disabled()
    held = sl.state()["combatants"][0]
    tisch.gm({"type": "apply_hit", "id": held["id"], "steigerungen": 1})
    sl.warte_bis("() => !document.querySelector('.kampf-knoepfe [data-act=heilrunde-start]').disabled")
    sl.klick(".kampf-knoepfe [data-act=heilrunde-start]")
    sl.warte_bis("() => !!App.state.heilrunde")
    sl.klick("[data-act=heilrunde-ende]")
    sl.warte_bis("() => !App.state.heilrunde")
    assert sl.page.locator(".kampf-knoepfe [data-act=heilrunde-start]").count() == 1
    sl.kein_waagrechtes_scrollen("Knopfzeile ohne Kampf")
    # Die zwei Symbole ohne Text gibt es in der Zeile nicht mehr.
    assert not sl.page.locator(".kampf-knoepfe [data-act=reset], [data-act=clear-all]").count()


def test_sl_anfrage_und_kampfknoepfe_schieben_nichts(tisch):
    sl, hs = voller_tisch(tisch)          # eine Anfrage (Wunde +) liegt schon an
    sl.warte_bis("() => !!document.querySelector('.anfragen-schweb')")
    # Die „Verbunden"-Pille stand mitten auf der schwebenden Anfrage (14.11.2026).
    assert sl.js("() => getComputedStyle(document.querySelector('.statusbar')).visibility") == "hidden"
    zonen, liste = _oben(sl, "[data-sec=zones]"), _oben(sl, ".order-heading, .combatant")
    assert sl.js("() => getComputedStyle(document.querySelector('.anfragen-schweb')).position") == "fixed"
    sl.klick(".anfragen-schweb [data-act=req-dismiss]")
    sl.warte_bis("() => !document.querySelector('.anfragen-schweb')")
    # Beim SL steht seit der Studio-Runde ohnehin der Handy-Punkt statt der Pille.
    assert sl.js("() => getComputedStyle(document.querySelector('.statusbar')).visibility") == "hidden"
    assert "2 Handys verbunden" in sl.js("() => document.querySelector('.kopf-handys').textContent")
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


def test_studio_optik_schrift_symbole_startflaeche(tisch):
    """Studio-Runde 14.11.2026: eigene Schrift geladen, Linien-Symbole statt
    Emoji (Notiz-Themen bleiben roh), Startfläche bei leerem Tisch, ☰-Menü in
    Gruppen, Handy-Punkt statt Pille."""
    sl = tisch.sl()
    # Seit 22.11.2026 (Abenteuerbuch) nutzt der Standard-Skin Buchschriften;
    # Inter/Cinzel bleiben für die anderen Skins.
    sl.warte_bis("() => document.fonts.check('16px \"EB Garamond\"') && document.fonts.check('16px \"IM Fell English\"')")
    assert sl.page.locator(".startflaeche .sf-zeile").count() == 3
    assert "Noch kein Handy" in sl.js("() => document.querySelector('.kopf-handys').textContent")
    sl.klick(".kopf-menue > summary")
    gruppen = sl.js("() => [...document.querySelectorAll('.km-gruppe')].map(e => e.textContent)")
    assert gruppen == ["Spiel", "Daten", "Hilfe"]
    h = tisch.handy("Tessa")
    # Seit 15.11.2026 bleibt sie bis zum ersten Austeilen - mit ✓ beim Einladen.
    sl.warte_bis("() => !!document.querySelector('.startflaeche .sf-zeile.fertig')")
    # Reiter: Symbol statt Emoji
    tabs = h.js("() => [...document.querySelectorAll('.handy-reiter button')].map(b => [!!b.querySelector('svg.ic, svg.g-fater'), b.textContent.trim()])")
    assert tabs and all(svg for svg, _ in tabs), tabs
    assert not any("⚔" in t or "📜" in t for _, t in tabs)
    # Notiz-Themen-Chips behalten das selbst gewählte Emoji.
    h.js("""() => gmAction({type: 'notizen_setzen', eintraege: [{id: 'n1', text: 'Schuld', thema: '📜 Aufträge'}]})""")
    h.reiter("notizen")
    h.warte_bis("() => [...document.querySelectorAll('.notiz-reiter')].some(b => b.textContent.includes('📜'))")
    h.kein_waagrechtes_scrollen("Notizen")


def test_studio_runde2_dialog_meldung_ladebild_leerer_bogen(tisch):
    """Studio-Runde 2 (14.11.2026): Dialog mit Titel/Symbol, Meldung mit
    Symbol, Ladebild verschwindet beim ersten Stand, leerer Bogen mit 2 Wegen."""
    sl = tisch.sl()
    assert sl.page.locator(".ladebild").count() == 0          # erster Stand ersetzt es
    sl.js("() => { frage('Charakter löschen?\\n\\nWeg ist weg.', 'Löschen', true); }")
    sl.warte_bis("() => !!document.querySelector('.app-dialog-titel')")
    assert sl.page.inner_text(".app-dialog-titel") == "Charakter löschen?"
    assert sl.page.inner_text(".app-dialog-text") == "Weg ist weg."
    assert sl.page.locator(".app-dialog-sym.gefahr svg").count() == 1
    sl.page.keyboard.press("Escape")
    sl.js("() => toast('● Aufnahme läuft')")
    sl.warte_bis("() => document.querySelector('#toast.toast-rec .toast-sym svg')")
    assert sl.page.inner_text("#toast .toast-text") == "Aufnahme läuft"
    h = tisch.handy("Rurik")
    h.js("() => document.querySelector('[data-act=handy-reiter][data-reiter=bogen]').click()")
    h.warte_bis("() => document.querySelectorAll('.bogen-leer [data-act=bogen-bearbeiten]').length === 2")
    h.kein_waagrechtes_scrollen("leerer Bogen")


def test_handy_springt_nicht_bei_aufdecken_dran_und_zustand(tisch):
    """Messung 15.11.2026: Aufdecken, Angeschlagen, eine laufende Anfrage und
    der Wechsel der Dran-Leiste schoben die Seite jeweils um 20-120 px. Jetzt
    liegen Hinweis, Uhr und Zustand schwebend auf festem Platz, die Leiste hat
    eine Höhe. (Ist man selbst dran, wechselt die Ansicht bewusst auf „Mein Zug".)"""
    sl, h = _kampf_am_handy(tisch)
    tisch.gm({"type": "new_round", "runde": 0})
    h.locator("#bigcard").wait_for()
    h.wait_for_timeout(800)
    me = h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")
    oben = lambda sel: round(h.js(f"document.querySelector('{sel}').getBoundingClientRect().top + scrollY"))  # noqa: E731
    leiste = lambda: round(h.js("document.querySelector('.dran-leiste').getBoundingClientRect().height"))  # noqa: E731
    vorher, hoehe = oben(".req-knopf-huelle"), leiste()
    _aufdecken(h)
    h.wait_for_timeout(3500)
    assert oben(".req-knopf-huelle") == vorher, "Aufdecken schiebt die Seite"
    tisch.gm({"type": "apply_hit", "id": me})
    h.warte_bis("() => !!document.querySelector('.zustand-schweb .kz-shaken')")
    assert oben(".req-knopf-huelle") == vorher, "Angeschlagen schiebt die Seite"
    h.js("() => gmAction({type:'request', kind:'status', detail:{woundsDelta:1}, label:'🩸 Wunde +'})")
    h.warte_bis("() => !!document.querySelector('.req-offen')")
    reihe = oben(".order")
    tisch.gm({"type": "resolve_request", "id": sl.state()["requests"][0]["id"]})
    h.warte_bis("() => !document.querySelector('.req-offen')")
    assert oben(".order") == reihe, "Laufende Anfrage schiebt die Reihenfolge"
    tisch.gm({"type": "set_active", "id": me})
    tisch.gm({"type": "release"})
    h.warte_bis("() => !!document.querySelector('.dran-leiste.ich')")
    assert leiste() == hoehe, "Dran-Leiste ändert ihre Höhe"


def test_studio_runde3_momente(tisch):
    """Studio-Runde 3 (15.11.2026): Runden-Band auf SL + Handy, Dein-Zug-Moment
    und Treffer-Moment am Handy - schwebend, fangen keine Tipps ab, gehen von
    selbst wieder weg."""
    sl, h = _kampf_am_handy(tisch)
    tisch.gm({"type": "new_round", "runde": 0})
    h.warte_bis("() => !!document.querySelector('.runden-band')")
    sl.warte_bis("() => !!document.querySelector('.runden-band')")
    assert "RUNDE" in h.page.inner_text(".runden-band")
    h.locator("#bigcard").wait_for()
    _aufdecken(h)
    h.wait_for_timeout(3500)
    me = h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")
    tisch.gm({"type": "set_active", "id": me})
    tisch.gm({"type": "release"})
    h.warte_bis("() => !!document.querySelector('.zug-moment .zm-karte svg')")
    assert h.js("getComputedStyle(document.querySelector('.zug-moment')).pointerEvents") == "none"
    h.warte_bis("() => !document.querySelector('.zug-moment')", frist=4000)
    tisch.gm({"type": "apply_hit", "id": me, "wounds": 1})
    h.warte_bis("() => !!document.querySelector('.treffer-moment .tm-gross')")
    assert "WUNDE" in h.page.inner_text(".treffer-moment .tm-gross") or "ANGESCHLAGEN" in h.page.inner_text(".treffer-moment .tm-gross")
    h.warte_bis("() => !document.querySelector('.treffer-moment')", frist=5000)


def test_handy_kopf_name_ganz_und_thema_ohne_doppel(tisch):
    """Bedienbarkeits-Prüfung 15.11.2026: im Kampf (wenn „Runde 1" dazukommt)
    wurde der eigene Name am 360-px-Handy zu „Branni…" gekürzt; ein eigenes
    Thema „nsc" stand als zweiter Reiter neben „👤 NSC"."""
    tisch.sl()
    h = tisch.handy("Brannigan", "se")
    h.page.set_viewport_size({"width": 360, "height": 780})
    tisch.gm({"type": "add_npc", "name": "Ork"})
    tisch.gm({"type": "new_round", "runde": 0})
    h.warte_bis("() => !!document.querySelector('.handy-kopf .runden-zaehler')")
    breite = h.js("(() => { const n = document.querySelector('.hk-name'); return [n.scrollWidth, n.clientWidth]; })()")
    assert breite[0] <= breite[1], f"Name im Kopf abgeschnitten: {breite}"
    # Münze bleibt gut zu treffen: 8 px über ihr landet der Tipp noch auf ihr.
    treffer = h.js("""(() => { const m = [...document.querySelectorAll('.handy-kopf button.muenze')]
        .find(e => e.getBoundingClientRect().width); const r = m.getBoundingClientRect();
        const e = document.elementFromPoint(r.left + r.width / 2, r.top - 8);
        return !!(e && e.closest('button.muenze')); })()""")
    assert treffer, "Münze im Kopf: Trefferfläche zu klein"
    h.reiter("notizen")
    h.js("() => notizThemaWaehlen('leute')")
    h.wait_for_timeout(200)
    reiter = h.js("[...document.querySelectorAll('.notiz-reiter')].map(e => e.textContent.trim().toLowerCase())")
    assert sum(r.endswith("leute") for r in reiter) == 1, reiter
    assert not any("nsc" in r for r in reiter), reiter


def test_bedienbarkeit_runde_2026_11_15(tisch):
    """Bedienbarkeits-Runde (Kalle 15.11.2026, „Mach alles", 1B): Startfläche
    bleibt bis zum Austeilen, Gegner im Baukasten direkt neu, Treffer in der
    Zeile statt verdeckender Karte, ⋯ als schwebendes Menü (schiebt nichts),
    Anfrage mit Übernehmen-Knopf, „Nicht geschafft" am Handy."""
    sl = tisch.sl(1366, 768)
    h = tisch.handy("Tessa", "se")
    sl.warte_bis("() => !!document.querySelector('.startflaeche .sf-zeile.fertig')")
    # Baukasten: Gegner direkt neu anlegen (landet auch in der Bibliothek).
    sl.locator(".startflaeche [data-act=kaempfe-zeigen]").first.click()
    sl.page.fill("#kbn-name", "Pirat")
    sl.page.fill("#kbn-anzahl", "2")
    sl.page.fill("#kbn-parade", "5")
    sl.locator("[data-act=kb-neu-gegner]").click()
    sl.warte_bis("() => App.state.bestiary.some(b => b.name === 'Pirat')")
    assert sl.js("App.kampfEntwurf.zeilen.map(z => [z.proto.name, z.anzahl])") == [["Pirat", 2]]
    assert sl.js("document.querySelector('#kbn-name').value") == ""
    sl.page.fill("#kb-name", "Enterkommando")
    sl.locator("[data-act=kb-speichern]").click()
    sl.warte_bis("() => App.state.encounters.length === 1")
    sl.js("() => { App.kampfEntwurf = null; render(); }")
    sl.locator("[data-act=schnellkampf-start]").click()
    sl.warte_bis("() => App.state.round === 1")
    assert not sl.js("!!document.querySelector('.startflaeche')"), "Startfläche nach dem Austeilen noch da"
    # Gegnerzug: Treffer-Knöpfe in der Zeile, keine Karte über der Liste.
    st = sl.state()
    pirat = next(c for c in st["combatants"] if c["kind"] == "npc")
    tessa = next(c for c in st["combatants"] if c["kind"] == "player")
    tisch.gm({"type": "set_active", "id": pirat["id"]})
    sl.warte_bis("(id) => !!document.querySelector(`.combatant[data-cid='${id}'] .gz-inline`)", tessa["id"])
    assert not sl.js("!!document.querySelector('.al-treffer.gegnerzug')")
    sl.locator(f".combatant[data-cid='{tessa['id']}'] [data-act=gegnerzug-treffer][data-n='0']").click()
    sl.warte_bis("(id) => App.state.combatants.find(c => c.id === id).status.shaken", tessa["id"])
    # ⋯: schwebendes Menü mit Bennies, die Zeilen bleiben, wo sie sind.
    oben = lambda: sl.js("[...document.querySelectorAll('.order-raster .combatant')].map(e => Math.round(e.getBoundingClientRect().top))")
    vorher = oben()
    sl.locator(f".combatant[data-cid='{tessa['id']}'] .actions [data-act=zustand-umschalten]").click()
    sl.warte_bis("() => !!document.querySelector('.kontext-menue [data-act=benny-plus]')")
    assert oben() == vorher, "⋯ schiebt die Reihenfolge"
    b = tessa["bennies"]
    sl.locator(".kontext-menue [data-act=benny-plus]").click()
    sl.warte_bis("(a) => App.state.combatants.find(c => c.id === a[0]).bennies === a[1]", [tessa["id"], b + 1])
    sl.page.keyboard.press("Escape")
    # Anfrage: beschrifteter Übernehmen-Knopf.
    h.js("() => gmAction({type: 'request', kind: 'status', detail: {woundsDelta: 1}, label: '🩸 Wunde +'})")
    sl.warte_bis("() => !!document.querySelector('.anfragen-schweb .req-ja')")
    assert "Übernehmen" in sl.page.inner_text(".anfragen-schweb .req-ja")
    sl.locator(".anfragen-schweb .req-ja").click()
    sl.warte_bis("(id) => App.state.combatants.find(c => c.id === id).status.wounds === 1", tessa["id"])
    # Handy angeschlagen am Zug: „Nicht geschafft" beendet den Zug.
    tisch.gm({"type": "set_active", "id": tessa["id"]})
    tisch.gm({"type": "release"})
    h.warte_bis("() => !!document.querySelector('.dl-drei [data-act=confirm-turn]')", frist=8000)
    h.wait_for_timeout(750)
    h.locator(".dl-drei [data-act=confirm-turn]").click()
    sl.warte_bis("(id) => App.state.activeId !== id", tessa["id"])


def test_notizen_studio_runde_2026_11_16(tisch):
    """Studio-Runde Notizen (Kalle 16.11.2026, „alles"): ruhige Zeile ohne
    ✎/🗑, Themen als Linien-Symbol, Komposer „Nur ich | Für alle", Gruppen-
    Notiz mit Schreiber + Uhrzeit, Post mit Uhrzeit + Lesezeichen, 📌 Merken
    als schwebende Karte (schiebt nichts), Schriftgröße im Protokoll."""
    sl = tisch.sl()
    h = tisch.handy("Tessa", "se")
    tisch.gm({"type": "message", "target": "all", "text": "Der Wirt lügt."})
    tisch.gm({"type": "protokoll_speichern", "text": "# Abend 1\nEs war Nacht.", "freigegeben": True})
    h.warte_bis("() => App.state.messages.length > 0")
    h.js("() => { App.lastSeenMsgTs = Infinity; Prot.offen = false; render(); }")
    h.reiter("notizen")
    # Komposer: „Für alle" in Worten, ↑ legt an; Gruppen-Notiz zeigt Schreiber.
    h.locator("[data-act=notiz-ziel][data-ziel=gruppe]").click()
    h.locator("#notiz-neu").fill("Treffpunkt Leuchtturm")
    h.locator("[data-act=notiz-hinzu]").click()
    h.warte_bis("() => App.state.gruppenNotizen.some(n => n.text === 'Treffpunkt Leuchtturm' && n.ts > 0)")
    h.warte_bis("() => !!document.querySelector('li.zeile.gruppe .wer .wer-av')")
    assert h.js("document.querySelector('[data-act=notiz-ziel][data-ziel=ich]').classList.contains('on')"), \
        "👥 gilt nur für die eine Notiz"
    # Zeile ohne ✎/🗑; Themen-Reiter mit Linien-Symbol.
    assert not h.js("!!document.querySelector('li.zeile:not(.bearbeiten) [data-act=notiz-loeschen]')")
    assert h.js("!!document.querySelector('.notiz-reiter[data-thema=Leute] svg.ic')")
    h.kein_waagrechtes_scrollen("Notizen")
    # Post: Lesezeichen merkt die Nachricht als Notiz, dann „In Notizen".
    h.reiter("msgs")
    assert h.js("!!document.querySelector('.msg .msg-zeit')")
    h.locator("[data-act=notiz-merken]").first.click()
    h.warte_bis("() => (App.state.meineNotizen || []).some(n => n.text === 'Der Wirt lügt.')")
    h.warte_bis("() => !!document.querySelector('.msg span.msg-merk.ok')")
    # Protokoll: A+ macht die Schrift größer und bleibt gemerkt.
    h.js("() => { Prot.offen = true; protokollOeffnen(); render(); }")
    vorher = h.js("parseFloat(getComputedStyle(document.querySelector('.protokoll-fenster .pt-text')).fontSize)")
    h.locator("[data-act=prot-schrift][data-d='1']").first.click()
    h.warte_bis("(v) => parseFloat(getComputedStyle(document.querySelector('.protokoll-fenster .pt-text')).fontSize) > v", vorher)
    assert h.js("localStorage.getItem('protSchrift')") == "2"
    # SL: 📌 Merken öffnet keinen Dialog, sondern eine schwebende Karte.
    oben = lambda: sl.js("Math.round(document.querySelector('.sl-kopf').nextElementSibling.getBoundingClientRect().top)")
    sl.js("() => { Aufn.rec = {}; Aufn.start = Date.now() - 60000; Aufn.pauseGesamt = 0; render(); }")
    sl.warte_bis("() => !!document.querySelector('[data-act=aufn-marke]')")
    vorher = oben()
    sl.locator("[data-act=aufn-marke]").first.click()
    sl.warte_bis("() => !!document.querySelector('#marke-karte.sichtbar')")
    assert not sl.js("!!document.querySelector('.app-dialog-hg')"), "Merken hält das Spiel mit einem Dialog an"
    assert sl.js("getComputedStyle(document.querySelector('#marke-karte')).position") == "fixed"
    assert oben() == vorher, "Merken-Karte schiebt Inhalt"
    sl.page.keyboard.press("Escape")
    sl.warte_bis("() => !document.querySelector('#marke-karte')")
    sl.js("() => { Aufn.rec = null; render(); }")
