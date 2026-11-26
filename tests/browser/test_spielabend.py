"""Ein ganzer Spielabend am Stück (Tiefenprüfung 26.11.2026): SL + 5 Handys,
drei Runden mit Countdown, Treffer und Angeschlagen-Probe, ein Handy lädt neu,
eins verliert kurz das WLAN, der Laptop startet mitten im Abend neu
(„Fortsetzen"), danach Kampf beenden und Heilen-Runde. Nach jedem Zug müssen
alle Handys dasselbe zeigen wie der SL."""

NAMEN = [("Tessa","iphone"),("Korgo","klein"),("Mira","se"),("Bo","gross"),("Ux","tablet")]

def sync(sl, hs, wo):
    sl.page.wait_for_timeout(400)
    st = sl.state()
    for h in hs:
        try:
            h.warte_bis("(s) => App.state.round === s.r && App.state.activeId === s.a && App.state.phase === s.p",
                        {"r": st["round"], "a": st["activeId"], "p": st["phase"]}, frist=5000)
        except Exception:
            hst = h.state()
            raise AssertionError(f"{wo}: {h.name} nicht synchron: {hst['round'],hst['activeId'],hst['phase']} vs {st['round'],st['activeId'],st['phase']}")

def tipp(seite, sel):
    loc = seite.page.locator(sel).first
    loc.wait_for(timeout=8000)
    if loc.evaluate("e => !!e.closest('.daumen-leiste')"):
        seite.page.wait_for_timeout(750)
    loc.click()

def zug_durch(tisch, sl, hs, by, protokoll):
    st = sl.state()
    a = st["activeId"]
    if not a:
        return False
    c = next(x for x in st["combatants"] if x["id"] == a)
    if st["phase"] != "running":
        tipp(sl, "[data-act=release]")
        sl.warte_bis("() => App.state.phase === 'running'")
    h = by.get(c.get("playerId"))
    protokoll.append(c["name"])
    if h:
        st2 = sl.state()
        if st2.get("probeWartet") == a:
            h.warte_bis("() => !!document.querySelector('[data-act=probe-verpatzt]')")
            tipp(h, "[data-act=probe-verpatzt]")
            sl.warte_bis("() => App.state.timerEndsAt || !App.state.funktionen.timer")
        h.warte_bis("() => !!document.querySelector('[data-act=confirm-turn]')", frist=8000)
        tipp(h, "[data-act=confirm-turn]")
    else:
        tisch.gm({"type": "confirm_turn", "fuer": a})
    sl.warte_bis("(id) => App.state.activeId !== id || App.state.phase !== 'running'", a)
    return True

def test_abend(tisch):
    sl = tisch.sl()
    hs = [tisch.handy(n, g) for n, g in NAMEN]
    by = {h.js("App.myPlayerId"): h for h in hs}
    g = tisch.gm
    g({"type": "bestiary_upsert", "name": "Pirat", "isWildCard": False})
    g({"type": "bestiary_upsert", "name": "Kapitän", "isWildCard": True})
    st = sl.state()
    pir = next(b for b in st["bestiary"] if b["name"] == "Pirat")
    kap = next(b for b in st["bestiary"] if b["name"] == "Kapitän")
    g({"type": "add_npc_from_bestiary", "id": pir["id"], "count": 3})
    g({"type": "add_npc_from_bestiary", "id": kap["id"]})
    g({"type": "countdown_setzen", "text": "Schiff bricht", "runden": 3})
    prot = []
    for runde in range(1, 4):
        tipp(sl, "[data-act=new-round]")
        sl.warte_bis("(r) => App.state.round === r", runde)
        sync(sl, hs, f"Runde {runde} ausgeteilt")
        for h in hs:
            if h.page.locator("[data-act=daumen-aufdecken]").count():
                tipp(h, "[data-act=daumen-aufdecken]")
        if runde == 2:
            # Treffer auf Tessa und Korgo vom SL
            ids = {c["name"]: c["id"] for c in sl.state()["combatants"]}
            g({"type": "apply_hit", "id": ids["Tessa"]})
            g({"type": "apply_hit", "id": ids["Korgo"], "steigerungen": 2})
            # Reload eines Handys mitten im Kampf
            hs[2].page.reload(); hs[2].warte_bis("() => App.joined && App.state")
            # Offline 6 s
            hs[3].ctx.set_offline(True); hs[3].page.wait_for_timeout(6000); hs[3].ctx.set_offline(False)
        for _ in range(20):
            if not zug_durch(tisch, sl, hs, by, prot):
                break
            sync(sl, hs, f"Runde {runde} nach Zug")
        if runde == 3:
            # Server-Neustart mitten im Abend
            tisch.server.neustart()
            sl.warte_bis("() => App.state && App.state.hasSavedSession", frist=20000)
            sl.js("() => gmAction({type:'resume_session'})")
            sl.warte_bis("() => !App.state.hasSavedSession && App.state.round === 3", frist=10000)
            for h in hs:
                h.warte_bis("() => App.joined && App.state.combatants.some(c => c.playerId === App.myPlayerId)", frist=20000)
            sync(sl, hs, "nach Neustart")
    st = sl.state()
    # Vor dem ersten Austeilen auf 3 gesetzt: Runde 1 = 3, Runde 2 = 2, Runde 3 = 1.
    assert st["countdown"]["runden"] == 1, st["countdown"]
    assert len(prot) >= 27, prot      # 9 Figuren × 3 Runden
    # Kampf beenden + Heilen-Runde
    tipp(sl, "[data-act=kampf-beenden]")
    for _ in range(3):
        if sl.page.locator(".app-dialog-hg button").count():
            sl.page.locator(".app-dialog-hg button").last.click(); sl.page.wait_for_timeout(300)
    sl.warte_bis("() => App.state.round === 0", frist=5000)
    tipp(sl, "[data-act=heilrunde-start]")
    sl.warte_bis("() => !!App.state.heilrunde")
    hr = sl.state()["heilrunde"]
    for cid in hr["ids"]:
        tipp(sl, f"[data-act=heil-wurf][data-id={cid}][data-erg='1']")
        sl.page.wait_for_timeout(300)
    tipp(sl, "[data-act=heil-rast]")
    tipp(sl, "[data-act=heilrunde-ende]")
    sl.warte_bis("() => !App.state.heilrunde")
    # Zweites Gerät: alle Charaktere sind vergeben, keiner lässt sich wegnehmen.
    zweit = tisch.handy_offen("iphone", name="Doppel")
    assert zweit.text().count("wird gespielt") == 5
    log = tisch.server.daten / "log.txt"
    fehler = [z for z in log.read_text(encoding="utf-8", errors="replace").splitlines() if "FEHLER" in z]
    assert not fehler, fehler[:10]
