"""Ganze Abläufe wie am Spieltisch: SL am Laptop, Spieler am Handy.

Hier wird nicht nur gedrückt, sondern nachgesehen, ob danach auch das
Richtige passiert ist - auf dem Server, beim SL UND auf den anderen Handys.
"""
import json
import urllib.request

import pytest

from hilfe import voller_tisch


def _meine(h):
    return h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId)")


def _figur(sl, name):
    return next(c for c in sl.state()["combatants"] if c["name"] == name)


def _knopf(seite, act, text=None):
    loc = seite.page.locator(f"[data-act='{act}']")
    if text:
        loc = loc.filter(has_text=text)
    _tipp(loc)


def _tipp(loc):
    loc = loc.first
    loc.wait_for(timeout=8000)
    seite = loc.page
    # Die Daumen-Leiste am Handy schluckt Tipps 700 ms nach einem Knopfwechsel
    # (Absicht: sonst traf der Daumen den neuen Knopf aus Versehen).
    if loc.evaluate("e => !!e.closest('.daumen-leiste')"):
        seite.wait_for_timeout(750)
    loc.click()


def _panel_auf(sl, sec):
    """SL-Panel sicher aufklappen. Ein Klick auf die Überschrift klappt ein
    schon offenes Panel ZU - und ob es offen ist, hängt vom gemerkten Zustand
    ab (in der CI anders als lokal)."""
    sl.js("(id) => { App.collapsed[id] = false; render(); }", sec)
    sl.warte_bis("(id) => !!document.querySelector(`details[data-sec='${id}'][open]`)", sec)


# --- Kampf, Karten, Initiative ------------------------------------------------

def test_kampfrunde_von_austeilen_bis_neue_runde(tisch):
    sl = tisch.sl()
    tessa = tisch.handy("Tessa")
    korgo = tisch.handy("Korgo", "klein")
    tisch.gm({"type": "add_npc", "name": "Ork"})

    sl.locator("button", has_text="Karten an ALLE austeilen").click()
    sl.warte_bis("() => App.state.round === 1 && App.state.combatants.every(c => c.card)")
    # Handy: Karte liegt verdeckt, Daumen-Knopf deckt sie auf - alle sehen das.
    for h in (tessa, korgo):
        h.warte_bis("() => !!document.querySelector('[data-act=daumen-aufdecken]')")
        _knopf(h, "daumen-aufdecken")
        h.warte_bis("() => App.state.combatants.find(c => c.playerId === App.myPlayerId).revealed")
    sl.warte_bis("() => App.state.combatants.filter(c => c.kind === 'player').every(c => c.revealed)")

    # Reihenfolge durchspielen: wer dran ist, beendet seinen Zug selbst (Handy)
    # oder der SL gibt weiter (Gegner).
    gesehen = []
    for _ in range(3):
        st = sl.state()
        dran = next(c for c in st["combatants"] if c["id"] == st["activeId"])
        gesehen.append(dran["name"])
        if st["phase"] != "running":
            _knopf(sl, "release")
            sl.warte_bis("() => App.state.phase === 'running'")
        h = {"Tessa": tessa, "Korgo": korgo}.get(dran["name"])
        if h:
            h.warte_bis("() => !!document.querySelector('[data-act=confirm-turn]')")
            _knopf(h, "confirm-turn")
        else:
            tisch.gm({"type": "confirm_turn", "fuer": dran["id"]})
        sl.warte_bis("(id) => App.state.activeId !== id", dran["id"])
    assert sorted(gesehen) == ["Korgo", "Ork", "Tessa"], gesehen
    # Reihenfolge = Kartenwert (höchste zuerst) - Joker ausgenommen.
    sl.warte_bis("() => App.state.combatants.every(c => c.done || !c.card)")

    sl.locator("[data-act=new-round]").first.click()
    sl.warte_bis("() => App.state.round === 2")
    assert all(not c["done"] for c in sl.state()["combatants"])
    tessa.warte_bis("() => App.state.round === 2")


def test_abwarten_und_eingreifen_vom_handy(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    tisch.handy("Korgo")
    tisch.gm({"type": "new_round", "runde": 0})
    meine = _meine(h)
    tisch.gm({"type": "set_active", "id": meine["id"]})
    tisch.gm({"type": "release"})
    h.warte_bis("() => !!document.querySelector('[data-act=hold]')")
    _knopf(h, "hold")
    sl.warte_bis("(id) => App.state.combatants.find(c => c.id === id).held", meine["id"])
    assert sl.state()["activeId"] != meine["id"]
    h.warte_bis("() => !!document.querySelector('[data-act=intervene]')")
    _knopf(h, "intervene")
    sl.warte_bis("(id) => App.state.activeId === id", meine["id"])


def test_joker_bringt_bennies_und_mischt(tisch):
    sl = tisch.sl()
    tisch.handy("Tessa")
    # Joker gezielt geben: erst austeilen, dann den Stapel so legen, dass der
    # nächste Zug ein Joker ist, geht nur am Server - darum über redraw so oft
    # ziehen, bis ein Joker kommt (54 Karten, das endet sicher).
    tisch.gm({"type": "new_round", "runde": 0})
    tessa = next(c for c in sl.state()["combatants"] if c["kind"] == "player")
    vorher = tessa["bennies"]
    for _ in range(60):
        if sl.state()["jokerActive"]:
            break
        tisch.gm({"type": "redraw", "id": tessa["id"]})
    assert sl.state()["jokerActive"], "In 60 Zügen kein Joker"
    assert _figur(sl, "Tessa")["bennies"] >= vorher
    tisch.gm({"type": "new_round", "runde": sl.state()["round"]})
    # Nach einer Joker-Runde wird neu gemischt: wieder volles Deck minus Karten.
    st = sl.state()
    assert st["deckCount"] >= 54 - len(st["combatants"]) - 2


# --- Zonen ----------------------------------------------------------------------

def test_handy_bewegt_sich_einmal_pro_runde(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    tisch.gm({"type": "new_round", "runde": 0})
    start = _meine(h)["zone"]
    ziel = h.page.locator("[data-act=zone-goto]").filter(has_text="Nahkampf")
    _tipp(ziel)
    h.warte_bis("() => !!document.querySelector('[data-act=zone-goto].confirming')")
    _tipp(h.page.locator("[data-act=zone-goto].confirming"))   # zweites Tippen bestätigt
    h.warte_bis("(z) => App.state.combatants.find(c => c.playerId === App.myPlayerId).zone !== z", start)
    neu = _meine(h)
    assert neu["moved"] and neu["zone"] != start
    # Zweite Bewegung in derselben Runde lehnt der Server ab.
    h.js("(id) => gmAction({type: 'move_zone', id, dir: 1})", neu["id"])
    h.wait_for_timeout(300)
    assert _figur(sl, "Tessa")["zone"] == neu["zone"]


# --- Treffer & Heilung ---------------------------------------------------------

def test_treffer_heilung_und_erholen(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    tisch.gm({"type": "new_round", "runde": 0})
    meine = _meine(h)
    tisch.gm({"type": "apply_hit", "id": meine["id"]})
    h.warte_bis("() => App.state.combatants.find(c => c.playerId === App.myPlayerId).status.shaken")
    assert "angeschlagen" in h.text().lower()
    tisch.gm({"type": "apply_hit", "id": meine["id"], "steigerungen": 2})
    h.warte_bis("() => App.state.combatants.find(c => c.playerId === App.myPlayerId).status.wounds === 2")
    # Am Handy: mit Benny erholen.
    bennies = _meine(h)["bennies"]
    h.warte_bis("() => !!document.querySelector('[data-act=player-request][data-kind=recover]')")
    _tipp(h.locator("[data-act=player-request][data-kind=recover]"))
    sl.warte_bis("() => !App.state.combatants.find(c => c.kind === 'player').status.shaken")
    assert _figur(sl, "Tessa")["bennies"] == bennies - 1
    # SL heilt eine Wunde - das Handy erfährt es.
    tisch.gm({"type": "apply_heal", "id": meine["id"]})
    h.warte_bis("() => App.state.combatants.find(c => c.playerId === App.myPlayerId).status.wounds === 1")
    tisch.gm({"type": "heal_players"})
    h.warte_bis("() => App.state.combatants.find(c => c.playerId === App.myPlayerId).status.wounds === 0")


def test_gegner_ko_und_aufraeumen(tisch):
    sl = tisch.sl()
    tisch.gm({"type": "add_npc", "name": "Pirat", "count": 2})
    tisch.gm({"type": "set_auto_incap", "an": True})
    p1 = _figur(sl, "Pirat 1")
    for _ in range(4):
        tisch.gm({"type": "apply_hit", "id": p1["id"], "steigerungen": 1})
    assert _figur(sl, "Pirat 1")["status"]["out"]
    tisch.gm({"type": "clear_defeated"})
    namen = [c["name"] for c in sl.state()["combatants"]]
    assert namen == ["Pirat 2"]


# --- Charakterbogen ------------------------------------------------------------

def test_charakterbogen_am_handy_ausfuellen(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa", "klein")
    h.reiter("bogen")
    _knopf(h, "bogen-bearbeiten")
    h.warte_bis("() => !!App.bogenEntwurf")
    felder = h.page.locator(".bogen input, .bogen-form input, input[data-feld]")
    assert felder.count() > 3, "Keine Eingabefelder im Bogen"
    felder.first.fill("7")
    h.locator("[data-act=bogen-speichern]").first.click()
    sl.warte_bis("() => Object.values(App.state.combatants.find(c => c.kind === 'player').bogen || {})"
                 ".some(v => JSON.stringify(v).includes('7'))")
    h.kein_waagrechtes_scrollen("Bogen")
    # Bleibt nach Neuladen am Charakter.
    h.reload()
    h.warte_bis("() => App.joined && App.state.combatants.some(c => c.playerId === App.myPlayerId)")
    assert "7" in json.dumps(_meine(h).get("bogen"))


# --- Notizen -------------------------------------------------------------------

def test_eigene_notizen_bleiben_privat_und_ueberleben_neuladen(tisch, server):
    sl = tisch.sl()
    tessa = tisch.handy("Tessa")
    korgo = tisch.handy("Korgo")
    tessa.reiter("notizen")
    feld = tessa.locator("#notiz-neu")
    feld.fill("Der Wirt lügt")
    tessa.locator("[data-act=notiz-hinzu]").click()
    tessa.warte_bis("() => (App.state.meineNotizen || []).some(n => n.text === 'Der Wirt lügt')")
    korgo.wait_for_timeout(300)
    assert "Der Wirt lügt" not in korgo.text()
    assert "Der Wirt lügt" not in json.dumps(korgo.state())
    assert "Der Wirt lügt" not in json.dumps(sl.state()), "SL bekommt private Notizen"
    tessa.reload()
    tessa.warte_bis("() => App.state && (App.state.meineNotizen || []).some(n => n.text === 'Der Wirt lügt')")
    # Auch nach einem Server-Neustart (vor dem Fortsetzen!).
    server.neustart()
    tessa.reload()
    tessa.warte_bis("() => App.state && (App.state.meineNotizen || []).some("
                    "n => n.text === 'Der Wirt lügt')", frist=15000)


def test_gruppen_notiz_sehen_alle_handys(tisch):
    tisch.sl()
    tessa = tisch.handy("Tessa")
    korgo = tisch.handy("Korgo", "klein")
    tessa.reiter("notizen")
    korgo.reiter("notizen")
    tessa.locator("[data-act=notiz-ziel]").first.click()
    tessa.locator("#notiz-neu").fill("Treffpunkt Leuchtturm")
    tessa.locator("[data-act=notiz-hinzu]").click()
    korgo.warte_bis("() => (App.state.gruppenNotizen || []).some(n => n.text === 'Treffpunkt Leuchtturm')")
    korgo.wait_for_timeout(200)
    assert "Treffpunkt Leuchtturm" in korgo.text()
    # Korgo hakt ab - Tessa sieht den Haken.
    korgo.locator("li.zeile", has_text="Treffpunkt").locator("[data-act=notiz-haken]").first.click()
    tessa.warte_bis("() => App.state.gruppenNotizen.find(n => n.text === 'Treffpunkt Leuchtturm').erledigt")


def test_notiz_bearbeiten_suchen_loeschen(tisch):
    tisch.sl()
    h = tisch.handy("Tessa", "se")
    h.reiter("notizen")
    # Die 🔎 gibt es ab 8 Notizen.
    for t in ["Seil kaufen", "Kapitän Varn misstrauen"] + [f"Notiz {i}" for i in range(6)]:
        h.locator("#notiz-neu").fill(t)
        h.locator("[data-act=notiz-hinzu]").click()
        h.warte_bis("(t) => App.state.meineNotizen.some(n => n.text === t)", t)
    # Suche
    h.locator("[data-act=notiz-suche-auf]").first.click()
    h.page.locator("#notiz-suche").fill("Varn")
    h.wait_for_timeout(300)
    sichtbar = h.page.locator("li.zeile:visible").all_inner_texts()
    assert any("Varn" in t for t in sichtbar) and not any("Seil" in t for t in sichtbar)
    h.locator("[data-act=notiz-suche-zu]").first.click()
    # Bearbeiten
    h.locator("li.zeile", has_text="Seil kaufen").locator("button[data-act=notiz-bearbeiten]").first.click()
    h.page.locator("#notiz-edit").fill("Seil UND Haken kaufen")
    h.locator("[data-act=notiz-fertig]").first.click()
    h.warte_bis("() => App.state.meineNotizen.some(n => n.text === 'Seil UND Haken kaufen')")
    # Löschen fragt erst nach: Abbrechen lässt die Notiz stehen ...
    h.locator("li.zeile", has_text="Seil UND").locator("[data-act=notiz-loeschen]").first.click()
    h.page.locator(".app-dialog-hg").wait_for()
    assert "Seil UND Haken kaufen" in h.page.locator(".app-dialog-text").inner_text()
    h.page.locator(".app-dialog-hg button.ghost").click()
    h.wait_for_timeout(300)
    assert h.js("App.state.meineNotizen.some(n => n.text === 'Seil UND Haken kaufen')")
    # ... „Löschen" löscht.
    h.locator("li.zeile", has_text="Seil UND").locator("[data-act=notiz-loeschen]").first.click()
    h.page.locator(".app-dialog-hg button.bad").click()
    h.warte_bis("() => !App.state.meineNotizen.some(n => n.text.startsWith('Seil'))")


# --- Nachrichten & Anfragen ----------------------------------------------------

def test_sl_fluestert_nur_einem_handy(tisch):
    sl = tisch.sl()
    tessa = tisch.handy("Tessa")
    korgo = tisch.handy("Korgo")
    _panel_auf(sl, "message")
    sl.locator("#msgtext").wait_for()
    sl.page.locator("select[data-act=msg-ziel]").select_option(tessa.js("App.myPlayerId"))
    sl.page.locator("#msgtext").fill("Du hörst ein Flüstern")
    _knopf(sl, "send-message")
    tessa.warte_bis("() => App.state.messages.some(m => m.text === 'Du hörst ein Flüstern')")
    korgo.wait_for_timeout(300)
    assert "Flüstern" not in json.dumps(korgo.state()["messages"])
    assert "Flüstern" in tessa.text()


def test_bennies_per_nachricht_und_muenze_tippen_gibt_sofort_aus(tisch):
    """Benny ausgeben: Münze oben antippen, „Ausgeben" - gilt sofort, der SL
    muss nichts bestätigen und sieht nur eine Einblendung (Kalle, 11.11.2026)."""
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    vorher = _meine(h)["bennies"]
    tisch.gm({"type": "message", "target": "all", "text": "", "bennies": 2})
    h.warte_bis("(v) => App.state.combatants.find(c => c.playerId === App.myPlayerId).bennies === v + 2",
                vorher)
    h.warte_bis("() => !!document.querySelector('[data-act=benny-muenze]')")
    h.page.locator("[data-act=benny-muenze]").first.evaluate("e => e.click()")
    h.dialog_knopf("Ausgeben")
    sl.warte_bis("(v) => App.state.combatants.find(c => c.name === 'Tessa').bennies === v + 1", vorher)
    assert sl.state()["requests"] == []
    sl.warte_bis("() => (document.getElementById('toast') || {}).textContent"
                 " && document.getElementById('toast').textContent.includes('Benny')")


# --- Protokoll -----------------------------------------------------------------

def test_protokoll_einfuegen_freigeben_lesen(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    _panel_auf(sl, "protokolle")
    _knopf(sl, "prot-neu")
    sl.page.locator(".app-dialog-hg textarea, textarea").last.fill(
        "# Nebel über Varn\nDie Gruppe erreichte den Hafen.")
    sl.locator("[data-act=prot-speichern][data-frei='1']").first.click()
    sl.warte_bis("() => App.state.protokolle.some(p => p.name === 'Nebel über Varn' && p.freigegeben)")
    h.warte_bis("() => App.state.protokolle.length === 1")
    pid = h.state()["protokolle"][0]["id"]
    # Text holt das Handy einzeln - und nur, wenn freigegeben.
    text = h.js("(id) => fetch('/api/protokoll/' + id).then(r => r.json())", pid)
    assert "Hafen" in json.dumps(text)
    tisch.gm({"type": "protokoll_freigeben", "id": pid, "an": False})
    h.warte_bis("() => App.state.protokolle.length === 0")
    status = h.js("(id) => fetch('/api/protokoll/' + id).then(r => r.status)", pid)
    assert status in (403, 404)


# --- Bibliothek & vorbereitete Kämpfe -------------------------------------------

def test_kampf_vorbereiten_und_starten(tisch):
    sl = tisch.sl()
    tisch.handy("Tessa")
    tisch.gm({"type": "bestiary_upsert", "name": "Ork", "isWildCard": False})
    ork = sl.state()["bestiary"][0]
    tessa = sl.state()["roster"][0]
    tisch.gm({"type": "encounter_upsert", "name": "Hinterhalt", "note": "Boss kommt später",
              "members": [{"name": "Ork", "zone": 1, "anzahl": 3, "bestiaryId": ork["id"]}],
              "charaktere": [{"characterId": tessa["id"], "zone": 3}]})
    enc = sl.state()["encounters"][0]
    # Handys erfahren nichts von vorbereiteten Kämpfen.
    assert sl.state()["encounters"] and not tisch.seiten[1].state()["encounters"]
    _knopf(sl, "kaempfe-zeigen")
    sl.warte_bis("() => !!document.querySelector('[data-act=encounter-start]')")
    sl.page.locator(f"[data-act=encounter-start][data-id='{enc['id']}']").first.evaluate("e => e.click()")
    if sl.page.locator(".app-dialog-hg").count():
        sl.page.locator(".app-dialog-hg button.primary").last.click()
    sl.warte_bis("() => App.state.combatants.filter(c => c.kind === 'npc').length >= 1"
                 " && App.state.round >= 1")
    assert "Boss kommt später" not in json.dumps(tisch.seiten[1].state())


def test_kampf_aus_text_einfuegen_und_datei(tisch):
    """Kampf unterwegs mit der KI geschrieben: einfügen, Vorschau, speichern,
    starten - und als .txt aufs Panel ziehen."""
    sl = tisch.sl()
    tisch.gm({"type": "roster_upsert", "name": "Tessa"})
    _knopf(sl, "kaempfe-zeigen")
    sl.warte_bis("() => !!document.querySelector('.kb-import-tipp [data-act=kampf-import]')")
    sl.page.locator(".kb-import-tipp [data-act=kampf-import]").click()
    sl.page.locator(".ki-text").fill("Hier dein Kampf:\n**KAMPF:** Hai-Angriff\n"
                                     "**GEGNER:** Himmelshai x2\nParade 6; Robustheit 9 (2)\nVERDECKT: ja")
    sl.warte_bis("() => document.querySelectorAll('.ki-gruppe').length === 1")
    assert "×2" in sl.page.locator(".ki-gruppe").inner_text()
    sl.page.locator(".ki-dialog .app-dialog-knoepfe button.primary").click()
    sl.warte_bis("() => App.state.encounters.length === 1 && App.state.bestiary.length === 1")
    enc = sl.state()["encounters"][0]
    assert enc["name"] == "Hai-Angriff" and len(enc["members"]) == 2 and enc["members"][0]["anon"]
    sl.warte_bis("() => !!document.querySelector('.kampf-ablage')")
    sl.js("""(t) => { const dt = new DataTransfer();
        dt.items.add(new File([t], 'kampf.txt', {type: 'text/plain'}));
        document.querySelector('.kampf-ablage').dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: dt})); }""",
          "KAMPF: Golems\nGEGNER: Golem\nWILDCARD: ja")
    sl.warte_bis("() => document.querySelectorAll('.ki-gruppe').length === 1")
    sl.page.locator(".ki-dialog .app-dialog-knoepfe button.primary").click()
    sl.warte_bis("() => App.state.encounters.length === 2")
    sl.page.locator(f"[data-act=encounter-start][data-id='{enc['id']}']").first.evaluate("e => e.click()")
    if sl.page.locator(".app-dialog-hg").count():
        sl.page.locator(".app-dialog-hg button.primary").last.click()
    sl.warte_bis("() => App.state.combatants.filter(c => c.kind === 'npc' && c.robustheit === 9).length === 2")


# --- Verlassen, Neuladen, Neustart ----------------------------------------------

def test_verlassen_und_wieder_beitreten(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    h.locator("[data-act=leave]").first.evaluate("e => e.click()")
    if h.page.locator(".app-dialog-hg").count():
        h.page.locator(".app-dialog-hg button.primary, .app-dialog-hg button.bad").last.click()
    sl.warte_bis("() => !App.state.combatants.some(c => c.kind === 'player')")
    h.warte_bis("() => !!document.querySelector('[data-act=join-als]')")
    h.locator("[data-act=join-als]").first.click()
    sl.warte_bis("() => App.state.combatants.some(c => c.name === 'Tessa')")
    assert len(sl.state()["roster"]) == 1, "Wiederkommen legte einen zweiten Charakter an"


def test_handy_neuladen_bleibt_dieselbe_figur(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    vorher = _meine(h)["id"]
    for _ in range(3):
        h.reload()
        h.warte_bis("() => App.joined && App.state.combatants.some(c => c.playerId === App.myPlayerId)")
    assert _meine(h)["id"] == vorher
    assert len(sl.state()["combatants"]) == 1


def test_server_neustart_und_fortsetzen(tisch, server):
    sl, hs = voller_tisch(tisch)
    vorher = sl.state()
    server.neustart()
    sl.reload()
    sl.warte_bis("() => App.state && App.state.hasSavedSession", frist=15000)
    # Handys verbinden sich von selbst wieder.
    for h in hs:
        h.warte_bis("() => App.state && App.state.serverNow", frist=15000)
    sl.locator("[data-act=resume]").first.click()
    sl.warte_bis("() => !App.state.hasSavedSession && App.state.combatants.length > 0")
    nachher = sl.state()
    assert [c["name"] for c in nachher["combatants"]] == [c["name"] for c in vorher["combatants"]]
    assert nachher["round"] == vorher["round"]
    sl.warte_bis("() => App.state.players.filter(p => p.connected).length === 2", frist=15000)


def test_rueckgaengig_beim_sl(tisch):
    sl = tisch.sl()
    tisch.gm({"type": "add_npc", "name": "Ork"})
    tisch.gm({"type": "add_npc", "name": "Goblin"})
    sl.locator("[data-act=undo]").first.click()
    sl.warte_bis("() => App.state.combatants.length === 1")
    assert sl.state()["combatants"][0]["name"] == "Ork"


# --- Sicherung, Export, Import ---------------------------------------------------

def test_export_und_import_in_frischen_server(tisch, server, tmp_path):
    sl, hs = voller_tisch(tisch)
    roh = urllib.request.urlopen(server.url + "api/export", timeout=10).read()
    datei = tmp_path / "sicherung.zip"
    datei.write_bytes(roh)
    zweiter = type(server)(tmp_path / "daten2").start()
    try:
        import http.client
        import uuid
        grenze = uuid.uuid4().hex
        koerper = (f"--{grenze}\r\nContent-Disposition: form-data; name=\"file\"; "
                   f"filename=\"s.zip\"\r\nContent-Type: application/zip\r\n\r\n").encode() + roh + \
                  f"\r\n--{grenze}--\r\n".encode()
        verb = http.client.HTTPConnection("127.0.0.1", zweiter.port, timeout=10)
        verb.request("POST", "/api/import", koerper,
                     {"Content-Type": f"multipart/form-data; boundary={grenze}"})
        antwort = verb.getresponse()
        bericht = json.loads(antwort.read())
        assert antwort.status == 200 and bericht.get("ok"), bericht
        b2 = tisch.browser.new_page()
        b2.goto(zweiter.url)
        b2.wait_for_function("() => App.state && App.state.roster.length >= 3")
        st = b2.evaluate("App.state")
        assert {r["name"] for r in st["roster"]} >= {"Tessa", "Korgo", "Mira"}
        assert {b["name"] for b in st["bestiary"]} == {"Piratenkapitän", "Pirat"}
        assert st["encounters"] and st["protokolle"]
        assert st["gruppenNotizen"], "Gruppen-Notizen fehlen in der Sicherung"
        b2.close()
    finally:
        zweiter.stop()


def test_handy_darf_nicht_exportieren_oder_importieren(tisch):
    tisch.sl()
    h = tisch.handy("Tessa")
    status = h.js("() => fetch('/api/export').then(r => r.status)")
    assert status == 403
    status = h.js("""() => { const f = new FormData(); f.append('file', new Blob(['x']), 'a.zip');
                     return fetch('/api/import', {method: 'POST', body: f}).then(r => r.status); }""")
    assert status == 403


@pytest.mark.parametrize("pfad", ["api/aufnahme", "api/bilder-verwaist", "api/aufnahme/live"])
def test_handy_kommt_nicht_an_sl_schnittstellen(tisch, pfad):
    tisch.sl()
    h = tisch.handy("Tessa")
    assert h.js("(p) => fetch('/' + p).then(r => r.status)", pfad) == 403
