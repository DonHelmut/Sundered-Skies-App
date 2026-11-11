"""Gemeinsame Bausteine der Browser-Tests: voller Spieltisch + Knopf-Kriecher."""
from __future__ import annotations

import re


def voller_tisch(tisch, handys=(("Tessa", "iphone"), ("Korgo", "klein"))):
    """Ein Abend mitten im Kampf: Charaktere, Bibliotheken, vorbereiteter Kampf,
    Gegner + Verbündeter am Tisch, Karten ausgeteilt, Nachricht, Anfrage,
    Protokoll, eigene und Gruppen-Notizen. Gibt (sl, [handys]) zurück."""
    sl = tisch.sl()
    hs = [tisch.handy(n, g) for n, g in handys]
    g = tisch.gm
    g({"type": "roster_upsert", "name": "Mira", "isWildCard": True})
    g({"type": "bestiary_upsert", "name": "Piratenkapitän", "isWildCard": True,
       "spielwerte": "Parade 6, Robustheit 7 (2)\nSäbel: Kämpfen W8, Schaden St+W6"})
    g({"type": "bestiary_upsert", "name": "Pirat", "isWildCard": False,
       "parade": 5, "robustheit": 6})
    g({"type": "ally_upsert", "name": "Lotse Brann", "isWildCard": False})
    sl.warte_bis("() => App.state.bestiary.length === 2 && App.state.allies.length === 1")
    st = sl.state()
    kapitaen = next(b for b in st["bestiary"] if b["name"] == "Piratenkapitän")
    pirat = next(b for b in st["bestiary"] if b["name"] == "Pirat")
    brann = st["allies"][0]
    g({"type": "add_npc_from_bestiary", "id": pirat["id"], "count": 2})
    g({"type": "save_encounter", "name": "Enterkommando"})
    g({"type": "add_npc_from_bestiary", "id": kapitaen["id"], "anon": True})
    g({"type": "add_ally_from_library", "id": brann["id"]})
    g({"type": "add_npc", "name": "Möwe", "count": 1})
    g({"type": "new_round", "runde": sl.state()["round"]})
    g({"type": "message", "target": "all", "text": "Der Himmel reißt auf."})
    eigen = hs[0].js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")
    g({"type": "message", "target": hs[0].js("App.myPlayerId"), "text": "Nur für Tessa"})
    g({"type": "protokoll_speichern", "text": "# Der erste Abend\nAlles begann im Nebel.",
       "freigegeben": True})
    # Notizen über die Handys selbst (die Wege sind nur dort offen).
    hs[0].js("""() => gmAction({type: 'notizen_setzen', eintraege: [
        {id: 'n1', text: 'Der Wirt lügt', thema: 'nsc'},
        {id: 'n2', text: 'Seil kaufen', erledigt: false}]})""")
    hs[-1].js("""() => gmAction({type: 'gruppen_notiz', op: 'neu',
        eintrag: {id: 'g1', text: 'Treffpunkt: Leuchtturm'}})""")
    hs[-1].js("""() => gmAction({type: 'request', kind: 'status', detail: {woundsDelta: 1},
        label: '🩸 Wunde +'})""")
    sl.warte_bis("() => App.state.requests.length > 0 && App.state.gruppenNotizen.length > 0")
    hs[0].warte_bis("() => (App.state.meineNotizen || []).length === 2")
    del eigen
    return sl, hs


# Knöpfe, die den Abend beenden oder die Seite verlassen. Sie kommen beim
# Kriechen ganz zum Schluss dran, damit sie den Rest nicht wegräumen.
ZUM_SCHLUSS = re.compile(r"leave|reset|discard|clear-all|kampf-beenden|remove-combatant|roster-delete|"
                         r"Verlassen|Abmelden|Alles löschen|Neuer Abend", re.I)
# Nie drücken: lädt die Seite neu / öffnet Fremdes / schaltet Netzwerk.
NIE = re.compile(r"firewall|netz-skript|neu-laden|neuladen|aktualisieren|updater|"
                 r"tasten-hilfe-drucken|prot-drucken|upd-|tv-oeffnen|href", re.I)

_BASIS_JS = r"""
function kandidaten() {
  const sichtbar = (e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none' && !e.disabled;
  };
  const alle = [...document.querySelectorAll(
    'button, [data-act], summary, .tappable, [role=button], select, input[type=checkbox]')];
  const aus = [];
  const gesehen = new Set();
  for (const e of alle) {
    if (!sichtbar(e)) continue;
    if (e.closest('a[href]')) continue;
    const zeile = e.closest('[data-id]');
    const sig = [e.tagName, e.dataset.act || '', e.dataset.modus || '', e.dataset.kind || '',
                 (e.textContent || e.value || '').trim().slice(0, 24),
                 e.dataset.id ? 'id' : '', zeile ? (zeile.dataset.id || '').slice(0, 3) : ''].join('|');
    if (gesehen.has(sig)) continue;
    gesehen.add(sig);
    aus.push({e, sig});
  }
  return aus;
}
"""

_KANDIDATEN_JS = "() => {" + _BASIS_JS + "\nreturn kandidaten().map(x => x.sig); }"

_DRUECKEN_JS = "(sig) => {" + _BASIS_JS + r"""
  const k = kandidaten().find(x => x.sig === sig);
  if (!k) return false;
  const e = k.e;
  e.scrollIntoView({block: 'center'});
  if (e.tagName === 'SELECT') {
    if (e.options.length < 2) return true;
    e.selectedIndex = e.options.length - 1;
    e.dispatchEvent(new Event('input', {bubbles: true}));
    e.dispatchEvent(new Event('change', {bubbles: true}));
  } else {
    e.click();
  }
  return true;
}"""


def kriechen(seite, max_klicks=250, annehmen=False, verboten=NIE, breite_pruefen=False):
    """Drückt nacheinander JEDEN sichtbaren Knopf der Seite (auch die, die erst
    nach einem Klick auftauchen) und schließt aufgehende Rückfragen wieder.
    ``annehmen``: Rückfragen mit OK bestätigen (Eingaben mit „Test" füllen)
    statt abbrechen. Gibt die gedrückten Signaturen zurück. JS-Fehler sammelt
    die Seite selbst (Seite.fehler). ``breite_pruefen``: nach jedem Klick
    nachsehen, ob die Seite breiter als der Bildschirm wurde (Handy) - Funde
    landen in ``seite.zu_breit_nach``."""
    page = seite.page
    gedrueckt: list[str] = []
    besucht: set[str] = set()
    page.on("filechooser", lambda fc: None)
    seite.nicht_klickbar = []
    seite.zu_breit_nach = []
    for _ in range(max_klicks):
        _dialoge_schliessen(seite, annehmen)
        sigs = page.evaluate(_KANDIDATEN_JS)
        offen = [(i, s) for i, s in enumerate(sigs) if s not in besucht and not verboten.search(s)]
        if not offen:
            break
        offen.sort(key=lambda x: bool(ZUM_SCHLUSS.search(x[1])))
        i, sig = offen[0]
        besucht.add(sig)
        # Im selben Schritt suchen und drücken: die SL-Seite zeichnet sich
        # laufend neu (Uhr, Anzeigen), ein Locator zielte sonst ins Leere.
        ok = page.evaluate(_DRUECKEN_JS, sig)
        if not ok:
            seite.nicht_klickbar.append(sig)
            continue
        gedrueckt.append(sig)
        page.wait_for_timeout(60)
        if breite_pruefen:
            b = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            if b[0] > b[1] + 1:
                seite.zu_breit_nach.append((sig, b[0], seite.zu_breit()))
    _dialoge_schliessen(seite, annehmen)
    return gedrueckt


def _dialoge_schliessen(seite, annehmen):
    page = seite.page
    for _ in range(4):
        box = page.locator(".app-dialog-hg")
        if not box.count():
            return
        try:
            if annehmen:
                for feld in box.last.locator("input:not([type]), input[type=text], textarea").all():
                    if not feld.input_value():
                        feld.fill("Test")
                knopf = box.last.locator("button.primary, button.bad")
                (knopf.last if knopf.count() else box.last.locator("button").last).click(timeout=1000)
            else:
                page.keyboard.press("Escape")
        except Exception:  # noqa: BLE001
            page.keyboard.press("Escape")
        page.wait_for_timeout(60)
