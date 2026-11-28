"""⏸ Pause / ▶ Weiter bei der Spielabend-Aufnahme (07.11.2026).

Im echten Chromium mit echtem MediaRecorder: das Mikro ist ein Ton-Generator
(Oszillator), damit es ohne Mikro und ohne Browser-Schalter läuft. Geprüft
wird, worauf es ankommt: eine Datei, eine Aufnahme, die Pause fehlt im Ton
und in der Dauer - und oben gibt es in der Pause gleich „▶ Weiter".
"""
import time

import pytest

# Ersatz-Mikro: ein Sinuston über WebAudio als MediaStream.
FAKE_MIKRO = """() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const osz = ctx.createOscillator();
    const ziel = ctx.createMediaStreamDestination();
    osz.connect(ziel); osz.start();
    return ziel.stream;
  };
}"""


def _aufnahme_panel_auf(sl):
    # Mehrmals versuchen und nachsehen, ob es offen BLEIBT: auf einem langsamen
    # Rechner kam nach dem Klick noch ein Neuzeichnen vom Start und klappte das
    # Panel wieder zu (Jonsbo, 08.11.2026) - dann war „● Nur aufnehmen" unsichtbar.
    offen = "() => document.querySelector('details[data-sec=aufnahme]').open"
    sl.warte_bis("() => !!document.querySelector('details[data-sec=aufnahme]')")
    for _ in range(6):
        if not sl.js(offen):
            sl.klick("details[data-sec=aufnahme] > summary")
        time.sleep(0.5)
        if sl.js(offen):
            return
    raise AssertionError("Aufnahme-Panel ließ sich nicht aufklappen")


def _ton_sekunden(av, pfad):
    with av.open(str(pfad)) as c:
        ende = 0.0
        for paket in c.demux(audio=0):
            if paket.pts is not None:
                ende = max(ende, float(paket.pts * paket.time_base))
    return ende


def test_pause_bleibt_ein_abend_mit_zwei_teilen(tisch):
    # Seit 2.0.28 (Kalle 28.11.2026): die Pause schließt eine Tondatei ab,
    # „▶ Weiter" beginnt die nächste - eine Aufnahme, ein Abend, mehrere Dateien.
    av = pytest.importorskip("av")
    sl = tisch.sl()
    sl.js(FAKE_MIKRO)
    _aufnahme_panel_auf(sl)
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.rec.state === 'recording'")
    time.sleep(4)

    sl.klick("header [data-act=aufn-pause], [data-act=aufn-pause]")
    sl.warte_bis("() => Aufn.pauseSeit > 0 && Aufn.rec.state === 'inactive'")
    # Oben „▶ Weiter", kein 📌 in der Pause; im Panel „Weiter mit Teil 2".
    sl.warte_bis("() => document.querySelector('.aufn-kopf.pausiert') && document.querySelectorAll('[data-act=aufn-weiter]').length >= 2")
    assert "Weiter mit Teil 2" in sl.text()
    assert sl.js("() => document.querySelectorAll('[data-act=aufn-marke]').length") == 0
    assert tisch.server.json("api/aufnahme")["aktiv"]["pausiert"] is True
    time.sleep(4)

    sl.klick("[data-act=aufn-weiter]")
    sl.warte_bis("() => !Aufn.pauseSeit && Aufn.rec.state === 'recording' && Aufn.teil === 2")
    assert tisch.server.json("api/aufnahme")["aktiv"]["pausiert"] is False
    time.sleep(4)

    sl.js("() => aufnahmeBeenden()")
    sl.warte_bis("() => !Aufn.rec && Aufn.status && !Aufn.status.aktiv", frist=15000)
    liste = tisch.server.json("api/aufnahme")["liste"]
    assert len(liste) == 1                              # ein Abend, nicht zwei
    eintrag = liste[0]
    # ~8 s Ton, nicht ~12 s Wanduhr (Stücke kommen alle 3 s, darum grob).
    assert 4_000 <= eintrag["dauerMs"] <= 10_500, eintrag
    assert [t["nr"] for t in eintrag["teile"]] == [1, 2]
    ordner = tisch.server.daten / "aufnahmen"
    # Jeder Teil ist für sich abspielbar und ~4 s lang; die Pause fehlt.
    for datei in (f"{eintrag['name']}.webm", f"{eintrag['name']}.t2.webm"):
        assert 2.5 <= _ton_sekunden(av, ordner / datei) <= 5.5, datei
    # Download je Teil, Liste zeigt die Teile.
    sl.warte_bis("() => document.querySelectorAll('a[href*=\"teil=2\"]').length === 1")
    assert "2 Teile" in sl.text()


def test_voller_teil_beginnt_von_selbst_den_naechsten(tisch):
    av = pytest.importorskip("av")
    sl = tisch.sl()
    sl.js(FAKE_MIKRO)
    sl.js("() => { AUFN_TEIL_MAX = 1; }")             # jedes Stück macht den Teil „voll"
    _aufnahme_panel_auf(sl)
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.teil >= 4", frist=20000)
    sl.js("() => aufnahmeBeenden()")
    sl.warte_bis("() => !Aufn.rec && Aufn.status && !Aufn.status.aktiv", frist=15000)
    eintrag = tisch.server.json("api/aufnahme")["liste"][0]
    assert len(eintrag["teile"]) >= 3
    ordner = tisch.server.daten / "aufnahmen"
    for t in eintrag["teile"][:-1]:
        nr = t["nr"]
        datei = ordner / (f"{eintrag['name']}.webm" if nr == 1 else f"{eintrag['name']}.t{nr}.webm")
        assert _ton_sekunden(av, datei) > 1.0, datei


def test_nach_neuladen_geht_derselbe_abend_weiter(tisch):
    # Seite neu geladen (Absturz, aus Versehen F5): „● Weiter aufnehmen" hängt
    # einen Teil an denselben Abend an - früher wurden daraus zwei Aufnahmen.
    sl = tisch.sl()
    sl.js(FAKE_MIKRO)
    _aufnahme_panel_auf(sl)
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.rec.state === 'recording'")
    time.sleep(4)
    sl.page.evaluate("() => { window.onbeforeunload = null; }")
    sl.page.reload()
    sl.warte_bis("() => App.state && App.role === 'gm'")
    sl.js(FAKE_MIKRO)
    _aufnahme_panel_auf(sl)
    sl.warte_bis("() => Aufn.status && Aufn.status.aktiv")
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.rec.state === 'recording' && Aufn.teil === 2")
    assert sl.js("() => aufnLaenge()") >= 3000      # Zeit läuft weiter, nicht ab 0
    time.sleep(4)
    sl.js("() => aufnahmeBeenden()")
    sl.warte_bis("() => !Aufn.rec && Aufn.status && !Aufn.status.aktiv", frist=15000)
    liste = tisch.server.json("api/aufnahme")["liste"]
    assert len(liste) == 1 and len(liste[0]["teile"]) == 2
