"""💰 Geld (18.11.2026): Börse am Handy, Gruppenkasse, SL gibt Beute.
Alles über die echten Knöpfe - Zahlenblock, Los-Scheine, Stepper."""


def _geld(h):
    return h.js("App.state.meinGeld.stand")


def test_boerse_kasse_und_beute(tisch):
    sl = tisch.sl()
    h = tisch.handy("Tessa")
    h.reiter("geld")
    # Münzen über den Zahlenblock einstecken, dann einen Teil bezahlen.
    h.klick("[data-act=geld-auf][data-art=muenzen]")
    for t in "340":
        h.klick(f"[data-act=geld-taste][data-t='{t}']")
    h.klick("[data-act=geld-buchen][data-was=einstecken]")
    h.warte_bis("() => App.state.meinGeld.stand.muenzen === 340")
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
    # Lose: Wert antippen, 3 Stück einstecken, 2 davon bezahlen.
    h.klick("[data-act=geld-auf][data-art=los]")
    h.klick("[data-act=geld-los][data-quelle=neu][data-n='1000']")
    h.klick("[data-act=geld-anzahl][data-d='1']")
    h.klick("[data-act=geld-anzahl][data-d='1']")
    h.klick("[data-act=geld-buchen][data-was=einstecken]")
    h.warte_bis("() => App.state.meinGeld.stand.lose['1000'] === 3")
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
    h.klick("[data-act=geld-los][data-quelle=neu][data-n='100000']")
    h.page.locator("[data-act=geld-buchen][data-was=einstecken]").scroll_into_view_if_needed()
    h.klick("[data-act=geld-buchen][data-was=einstecken]")
    h.warte_bis("() => App.state.meinGeld.stand.lose['100000'] === 1")
    assert not tisch.alle_fehler()
