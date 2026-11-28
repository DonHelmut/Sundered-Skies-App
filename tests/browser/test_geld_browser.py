"""💰 Geld (18.11.2026): Börse am Handy, Gruppenkasse, SL gibt Beute.
Alles über die echten Knöpfe - Zahlenblock, Los-Scheine, Stepper."""


def _geld(h):
    return h.js("App.state.meinGeld.stand")


def test_boerse_kasse_und_beute(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    h.reiter("geld")
    # Spieler kann sich kein Geld geben (Kalle 20.11.2026): kein „Einstecken",
    # kein Los-Raster - nur der Hinweis, woher Geld kommt.
    h.klick("[data-act=geld-auf][data-art=muenzen]")
    assert h.page.locator("[data-was=einstecken]").count() == 0
    assert "Neues Geld gibt dir der Spielleiter" in h.text()
    h.klick(".g-x")
    h.klick("[data-act=geld-auf][data-art=los]")
    assert h.page.locator("[data-quelle=neu]").count() == 0
    assert h.page.locator("[data-was=einstecken]").count() == 0
    h.klick(".g-x")
    # SL gibt Tessa Münzen und Lose (über die echten Knöpfe).
    sl.klick("[data-act=geld-sl-beute]")
    sl.klick("[data-act=geld-sl-art][data-art=muenzen]")
    for t in "340":
        sl.klick(f"[data-act=geld-taste][data-t='{t}']")
    sl.klick("[data-act=geld-buchen][data-was=geben]")
    h.warte_bis("() => App.state.meinGeld.stand.muenzen === 340")
    sl.klick("[data-act=geld-sl-beute]")
    sl.klick("[data-act=geld-los][data-quelle=neu][data-n='1000']")
    sl.klick("[data-act=geld-anzahl][data-d='1']")
    sl.klick("[data-act=geld-anzahl][data-d='1']")
    sl.klick("[data-act=geld-buchen][data-was=geben]")
    h.warte_bis("() => App.state.meinGeld.stand.lose['1000'] === 3")
    # Handy bezahlt einen Teil der Münzen.
    h.klick("[data-act=geld-auf][data-art=muenzen]")
    for t in "54":
        h.klick(f"[data-act=geld-taste][data-t='{t}']")
    h.fill("#geld-wofuer", "Tanken")
    h.klick("[data-act=geld-buchen][data-was=bezahlen]")
    h.warte_bis("() => App.state.meinGeld.stand.muenzen === 286")
    assert h.js("App.state.meinGeld.verlauf.at(-1).wofuer") == "Tanken"
    # Mehr als da ist: „Bezahlen" bleibt aus.
    h.klick("[data-act=geld-auf][data-art=muenzen]")
    for t in "999":
        h.klick(f"[data-act=geld-taste][data-t='{t}']")
    assert h.page.locator("[data-act=geld-buchen][data-was=bezahlen]").is_disabled()
    h.klick(".g-x")
    # Lose: eigenes Los antippen, 2 davon bezahlen.
    h.klick("[data-act=geld-auf][data-art=los]")
    h.klick("[data-act=geld-los][data-quelle=eigen][data-n='1000']")
    for _ in range(4):   # bleibt bei 3 stehen (mehr hat sie nicht)
        h.klick("[data-act=geld-anzahl][data-d='1']")
    assert "3 von 3" in h.text()
    h.klick("[data-act=geld-anzahl][data-d='-1']")
    h.klick("[data-act=geld-buchen][data-was=bezahlen]")
    h.warte_bis("() => App.state.meinGeld.stand.lose['1000'] === 1")
    # Letztes Los in die Gruppenkasse legen.
    h.klick("[data-act=geld-auf][data-art=los]")
    h.klick("[data-act=geld-los][data-quelle=eigen][data-n='1000']")
    h.klick("button.g-leicht[data-was=einlegen]")
    h.warte_bis("() => App.state.gruppenkasse.stand.lose['1000'] === 1 && !App.state.meinGeld.stand.lose['1000']")
    # SL verteilt Beute an jeden + Kasse.
    sl.klick("[data-act=geld-sl-beute]")
    sl.klick("[data-act=geld-sl-ziel][data-ziel=gruppe]")
    sl.klick("[data-act=geld-sl-art][data-art=fater]")
    sl.klick("[data-act=geld-buchen][data-was=geben]")
    h.warte_bis("() => App.state.meinGeld.stand.fater === 1 && App.state.gruppenkasse.stand.fater === 1")
    assert h.js("App.state.meinGeld.verlauf.at(-1).von") == "Spielleiter"
    # Gruppenkasse am Handy: Fater herausnehmen.
    h.klick("[data-act=geld-konto][data-k=gruppe]")
    h.klick("[data-act=geld-auf][data-art=fater]")
    h.klick("[data-act=geld-buchen][data-was=herausnehmen]")
    h.warte_bis("() => App.state.meinGeld.stand.fater === 2 && App.state.gruppenkasse.stand.fater === 0")
    # Spieler sieht keine fremden Börsen.
    assert h.js("Object.keys(App.state.geldAlle || {}).length") == 0
    assert not tisch.alle_fehler()


def test_geld_passt_aufs_kleine_handy(tisch):
    tisch.sl()
    h = tisch.handy("Korgo", "klein")
    h.reiter("geld")
    h.kein_waagrechtes_scrollen("Geld")
    h.klick("[data-act=geld-auf][data-art=los]")
    h.kein_waagrechtes_scrollen("Lose-Blatt")
    # Unterster Knopf im Blatt erreichbar (Blatt scrollt notfalls selbst).
    h.klick(".g-x")
    h.klick("[data-act=geld-konto][data-k=gruppe]")
    h.klick("[data-act=geld-auf][data-art=muenzen]")
    knopf = h.page.locator("button.g-leicht[data-was=kasse_bezahlen]")
    knopf.scroll_into_view_if_needed()
    assert knopf.is_visible()
    assert not tisch.alle_fehler()


def test_verlauf_eingeklappt(tisch):
    """Kalle 22.11.2026: Verlauf wird zu lang → eingeklappt nur die letzten 3,
    Schalter in der Überschrift bleibt beim Aufklappen stehen (nichts springt)."""
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    for i in range(6):
        tisch.gm({"type": "geld", "was": "geben", "ziele": ["gruppe"], "art": "muenzen",
                  "anzahl": i + 1, "wofuer": f"Posten {i}"})
    h.warte_bis("() => App.state.gruppenkasse.verlauf.length === 6")
    h.reiter("geld")
    h.klick("[data-act=geld-konto][data-k=gruppe]")
    assert h.page.locator(".g-verlauf li").count() == 3
    leiste = h.page.locator("[data-act=geld-vl]")
    assert "Alle 6" in leiste.inner_text()
    y = leiste.bounding_box()["y"]
    leiste.click()
    assert h.page.locator(".g-verlauf li").count() == 6
    assert "Weniger" in leiste.inner_text()
    assert abs(leiste.bounding_box()["y"] - y) < 1
    assert "Posten 5" in h.page.locator(".g-verlauf li").first.inner_text()
    leiste.click()
    assert h.page.locator(".g-verlauf li").count() == 3
    # Meine Börse hat ihren eigenen Zustand; SL-Panel ebenso.
    sl.klick("[data-act=geld-sl-verlauf][data-ziel=gruppe]")
    assert sl.page.locator(".g-verlauf li").count() == 3
    sl.klick("[data-act=geld-vl]")
    assert sl.page.locator(".g-verlauf li").count() == 6
    assert not tisch.alle_fehler()


def test_stufen_und_wechselgeld(tisch):
    """Kalle 28.11.2026: Funken → Splitter → Dreher → Schicksal, je 100. Ein
    Betrag, Stufe wählen, Wechselgeld von selbst; Lose auch auf Stufen."""
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    h.reiter("geld")
    # SL gibt 2 Schicksal.
    sl.klick("[data-act=geld-sl-beute]")
    sl.klick("[data-act=geld-sl-art][data-art=muenzen]")
    sl.klick("[data-act=geld-stufe][data-st=schicksal]")
    sl.klick("[data-act=geld-taste][data-t='2']")
    sl.klick("[data-act=geld-buchen][data-was=geben]")
    h.warte_bis("() => App.state.meinGeld.stand.muenzen === 2000000")
    assert "2 Schicksal" in " ".join(h.page.locator(".g-geld-chips").inner_text().split())
    # Handy bezahlt 5 Dreher - aus einem Schicksal wird Wechselgeld.
    h.klick("[data-act=geld-auf][data-art=muenzen]")
    h.klick("[data-act=geld-stufe][data-st=dreher]")
    h.klick("[data-act=geld-taste][data-t='5']")
    assert h.page.locator("[data-act=geld-buchen][data-was=bezahlen]").inner_text().strip() == "− 5 Dreher bezahlen"
    h.klick("[data-act=geld-buchen][data-was=bezahlen]")
    h.warte_bis("() => App.state.meinGeld.stand.muenzen === 1950000")
    h.page.wait_for_timeout(1500)     # Zahlen rollen
    chips = " ".join(h.page.locator(".g-geld-chips").inner_text().split())
    assert "1 Schicksal" in chips and "95 Dreher" in chips and "Funken" not in chips
    # SL gibt ein Los auf 1/10 Dreher.
    sl.klick("[data-act=geld-sl-beute]")
    sl.klick("[data-act=geld-los-stufe][data-st=dreher]")
    sl.klick("[data-act=geld-los][data-quelle=neu][data-n='10@dreher']")
    sl.klick("[data-act=geld-buchen][data-was=geben]")
    h.warte_bis("() => App.state.meinGeld.stand.lose['10@dreher'] === 1")
    assert "1/10 Dreher" in " ".join(h.text().split())
    # Handy bezahlt mit dem Los.
    h.klick("[data-act=geld-auf][data-art=los]")
    h.klick("[data-act=geld-los][data-quelle=eigen][data-n='10@dreher']")
    h.klick("[data-act=geld-buchen][data-was=bezahlen]")
    h.warte_bis("() => !App.state.meinGeld.stand.lose['10@dreher']")
    assert not tisch.alle_fehler()


def test_stufen_passen_aufs_kleine_handy(tisch):
    tisch.sl()
    tisch.gm({"type": "geld", "was": "geben", "ziele": ["gruppe"], "art": "muenzen", "anzahl": 123456789})
    h = tisch.handy("Korgo", "klein")
    h.reiter("geld")
    h.klick("[data-act=geld-konto][data-k=gruppe]")
    h.kein_waagrechtes_scrollen("Kasse mit allen Stufen")
    h.klick("[data-act=geld-auf][data-art=muenzen]")
    h.kein_waagrechtes_scrollen("Geld-Blatt mit Stufen")
    assert not tisch.alle_fehler()
