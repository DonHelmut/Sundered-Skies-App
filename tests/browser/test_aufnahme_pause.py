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


def test_pause_bleibt_eine_aufnahme_ohne_pausen_ton(tisch):
    av = pytest.importorskip("av")
    sl = tisch.sl()
    sl.js(FAKE_MIKRO)
    _aufnahme_panel_auf(sl)
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.rec.state === 'recording'")
    time.sleep(4)

    sl.klick("header [data-act=aufn-pause], [data-act=aufn-pause]")
    sl.warte_bis("() => Aufn.pauseSeit > 0 && Aufn.rec.state === 'paused'")
    # Oben „▶ Weiter", kein 📌 in der Pause; im Panel „Weiter aufnehmen".
    sl.warte_bis("() => document.querySelector('.aufn-kopf.pausiert') && document.querySelectorAll('[data-act=aufn-weiter]').length >= 2")
    assert sl.js("() => document.querySelectorAll('[data-act=aufn-marke]').length") == 0
    assert tisch.server.json("api/aufnahme")["aktiv"]["pausiert"] is True
    time.sleep(4)

    sl.klick("[data-act=aufn-weiter]")
    sl.warte_bis("() => !Aufn.pauseSeit && Aufn.rec.state === 'recording'")
    assert tisch.server.json("api/aufnahme")["aktiv"]["pausiert"] is False
    time.sleep(4)

    sl.js("() => aufnahmeBeenden()")
    sl.warte_bis("() => !Aufn.rec && Aufn.status && !Aufn.status.aktiv", frist=15000)
    liste = tisch.server.json("api/aufnahme")["liste"]
    assert len(liste) == 1                              # eine Aufnahme, nicht zwei
    eintrag = liste[0]
    # ~8 s Ton, nicht ~12 s Wanduhr (Stücke kommen alle 3 s, darum grob).
    assert 4_000 <= eintrag["dauerMs"] <= 10_500, eintrag
    pfad = tisch.server.daten / "aufnahmen" / f"{eintrag['name']}.webm"
    with av.open(str(pfad)) as c:
        ende = 0.0
        for paket in c.demux(audio=0):
            if paket.pts is not None:
                ende = max(ende, float(paket.pts * paket.time_base))
    # Die Pause steckt nicht als Loch im Ton: ~8 s, nicht ~12 s.
    assert 6.0 <= ende <= 10.0, ende
