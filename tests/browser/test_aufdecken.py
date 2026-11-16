"""Eigene Karte am Handy aufdecken - auch wenn sie schon mal da war.

Bug 16.11.2026 (Kalle, echtes iPhone, Runde 4, „Ein Gegner ist dran"):
Korgo konnte seine Karte weder per Antippen noch per „Karte aufdecken"
umdrehen, der SL hat weitergeschaltet. Ursache: das Handy merkt sich
aufgedeckte Karten als „Figur:Karte" (App.revealed). Die Figur eines
Spielers bleibt den ganzen Abend dieselbe, das Deck wird nach jedem Joker
neu gemischt - zieht Korgo eine Karte, die er schon einmal aufgedeckt hat,
hielt das Handy den Tipp für doppelt und tat nichts.
"""


def _meine(h):
    return h.js("App.state.combatants.find(c => c.playerId === App.myPlayerId)")


def _aufdecken_per(h, wie):
    if wie == "knopf":
        h.page.wait_for_timeout(750)   # Daumen-Leiste schluckt Tipps kurz nach Knopfwechsel
        h.page.locator("[data-act=daumen-aufdecken]").first.click()
    else:
        h.page.locator("#bigcard [data-act=reveal-card]").first.click()


def _gleiche_karte_nochmal(tisch, sl, cid, karte):
    """Neue Runden mit frisch gemischtem Deck, bis die Figur wieder genau
    diese Karte zieht (Korgo ist allein am Tisch: im Schnitt ~54 Runden)."""
    for _ in range(600):
        tisch.gm({"type": "reshuffle"})
        tisch.gm({"type": "new_round", "runde": sl.state()["round"]})
        c = next(x for x in sl.state()["combatants"] if x["id"] == cid)
        if c["card"]["id"] == karte and not c["revealed"]:
            return
    raise AssertionError("Karte kam nicht wieder")


def test_gleiche_karte_spaeter_nochmal_aufdeckbar(tisch):
    sl = tisch.sl()
    korgo = tisch.handy("Korgo", "iphone")
    tisch.gm({"type": "new_round", "runde": sl.state()["round"]})
    korgo.warte_bis("() => !!document.querySelector('#bigcard [data-act=reveal-card]')")
    _aufdecken_per(korgo, "tipp")
    korgo.warte_bis("() => App.state.combatants.find(c => c.playerId === App.myPlayerId).revealed")
    erst = _meine(korgo)

    for wie in ("knopf", "tipp"):
        _gleiche_karte_nochmal(tisch, sl, erst["id"], erst["card"]["id"])
        # Handy zeigt die Karte wieder verdeckt zum Antippen.
        korgo.warte_bis("(k) => { const m = App.state.combatants.find(c => c.playerId === App.myPlayerId);"
                        " return m.card.id === k && !m.revealed"
                        " && !!document.querySelector('#bigcard [data-act=reveal-card]')"
                        " && !(App.revealLockUntil > Date.now()); }",
                        erst["card"]["id"], frist=15000)
        _aufdecken_per(korgo, wie)
        korgo.warte_bis("() => App.state.combatants.find(c => c.playerId === App.myPlayerId).revealed",
                        frist=5000)
        sl.warte_bis("(id) => App.state.combatants.find(c => c.id === id).revealed", erst["id"])
    assert not tisch.alle_fehler()
