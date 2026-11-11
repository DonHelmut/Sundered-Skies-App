"""Jeden Knopf drücken: SL-Laptop und Handys, in vielen Lagen des Abends.

Kein Test kennt hier die Bedeutung der Knöpfe - er drückt einfach alles, was
sichtbar ist (auch was erst nach einem Klick aufgeht), und schlägt fehl, wenn
dabei ein JavaScript-Fehler fliegt (siehe conftest). Am Handy zusätzlich: die
Seite darf nie breiter als der Bildschirm werden. Findet die Sorte Fehler, die
beim Durchklicken von Hand zu selten getroffen wird.
"""
import re

import pytest

from hilfe import kriechen, voller_tisch


def _handy_pruefen(h, **kw):
    gedrueckt = kriechen(h, breite_pruefen=True, **kw)
    assert not h.zu_breit_nach, f"Handy zu breit nach: {h.zu_breit_nach[:5]}"
    return gedrueckt


@pytest.mark.parametrize("annehmen", [False, True], ids=["abbrechen", "bestaetigen"])
def test_sl_mitten_im_kampf(tisch, annehmen):
    sl, hs = voller_tisch(tisch)
    assert len(kriechen(sl, annehmen=annehmen)) > 100


def test_sl_leerer_erster_abend(tisch):
    sl = tisch.sl()
    assert len(kriechen(sl, annehmen=True)) > 20


@pytest.mark.parametrize("breite", [1024, 1920])
def test_sl_andere_bildschirme(tisch, breite):
    tisch.sl(breite=breite, hoehe=700)
    voller_tisch(tisch, handys=(("Tessa", "iphone"),))
    sl = tisch.sl()
    kriechen(sl)
    sl.kein_waagrechtes_scrollen()


def test_sl_mit_wartendem_fortsetzen(tisch, server):
    """Nach dem Neustart wartet „Fortsetzen?" - jeder Knopf außer Neu/Fortsetzen
    darf die gespeicherte Sitzung nicht wegwerfen und nichts kaputt machen."""
    voller_tisch(tisch, handys=(("Tessa", "iphone"),))
    server.neustart()
    sl = tisch.sl()
    sl.reload()
    sl.warte_bis("() => App.state && App.state.hasSavedSession")
    kriechen(sl, verboten=re.compile(
        r"resume|discard|reset|Fortsetzen|Neu starten|firewall|clear-all|kampf-beenden|new-round|deal", re.I))


@pytest.mark.parametrize("groesse", ["klein", "se", "iphone", "gross", "tablet"])
@pytest.mark.parametrize("annehmen", [False, True], ids=["abbrechen", "bestaetigen"])
def test_handy_mitten_im_kampf(tisch, groesse, annehmen):
    sl, hs = voller_tisch(tisch, handys=(("Tessa", groesse), ("Korgo", "iphone")))
    assert len(_handy_pruefen(hs[0], annehmen=annehmen)) > 30


@pytest.mark.parametrize("groesse", ["klein", "iphone"])
def test_handy_ist_dran(tisch, groesse):
    sl, hs = voller_tisch(tisch, handys=(("Tessa", groesse), ("Korgo", "iphone")))
    tessa = hs[0].js("App.state.combatants.find(c => c.playerId === App.myPlayerId).id")
    tisch.gm({"type": "set_active", "id": tessa})
    tisch.gm({"type": "release"})
    hs[0].warte_bis("(id) => App.state.activeId === id && App.state.phase === 'running'", tessa)
    _handy_pruefen(hs[0], annehmen=True)


@pytest.mark.parametrize("groesse", ["klein", "iphone"])
def test_handy_ruhige_ansicht_ohne_kampf(tisch, groesse):
    tisch.sl()
    h = tisch.handy("Tessa", groesse)
    tisch.handy("Korgo", "iphone")
    assert len(_handy_pruefen(h, annehmen=True)) > 10


@pytest.mark.parametrize("groesse", ["klein", "iphone"])
def test_handy_beitrittsseite(tisch, groesse):
    tisch.sl()
    tisch.gm({"type": "roster_upsert", "name": "Mira", "isWildCard": True})
    tisch.gm({"type": "roster_upsert", "name": "Ein sehr langer Charaktername ohne Ende", "isWildCard": True})
    h = tisch.handy_offen(groesse)
    _handy_pruefen(h, verboten=re.compile(r"join-als|join-neu|firewall"))


def test_tv_ansicht(tisch):
    voller_tisch(tisch, handys=(("Tessa", "iphone"),))
    tv = tisch._neue_seite("TV", {"width": 1280, "height": 720}, False, False)
    tv.goto(tisch.url + "tv")
    tv.wait_for_timeout(1500)
    tisch.gm({"type": "reveal", "id": tisch.sl().state()["combatants"][0]["id"]})
    tv.wait_for_timeout(500)
    tv.kein_waagrechtes_scrollen()
