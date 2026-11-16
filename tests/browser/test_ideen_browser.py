"""Gewählte Ideen aus der Durchleuchtung (Kalle 10.11.2026) im echten Browser:
Update-Hinweis, 🌙 Abend beenden + Speicherplatz, 📖 Chronik, 📷 Foto vom
Papierbogen, Handy bleibt wach."""
import base64
import time

import conftest as C
from hilfe import voller_tisch
from test_aufnahme_pause import FAKE_MIKRO, _aufnahme_panel_auf

# 1×1-PNG als „Foto".
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def test_update_hinweis_einmal_als_dialog_dann_knopf(browser, tmp_path, monkeypatch):
    # Eigener Server: nur hier „gibt es" eine neue Version (nie GitHub fragen).
    monkeypatch.setenv("SWI_NEUESTE_VERSION", "99.0.0")
    monkeypatch.setenv("SWI_NEUESTE_TITEL", "Sundered Skies Initiative 99.0.0 – Handy bleibt wach")
    srv = C.Server(tmp_path / "data").start()
    tisch = C.Tisch(browser, srv)
    try:
        sl = tisch.sl()
        sl.js("() => updateLaden()")
        sl.warte_bis("() => document.querySelector('.app-dialog-hg')")
        text = sl.page.inner_text(".app-dialog")
        assert "Version 99.0.0 ist da" in text and "Handy bleibt wach" in text
        # Im Test gibt es keine Aktualisieren.exe: nur der Weg von Hand, kein Start-Knopf.
        assert "Aktualisieren.exe" in text
        assert sl.page.locator(".app-dialog-hg button", has_text="Jetzt aktualisieren").count() == 0
        sl.dialog_knopf("OK")
        # Danach bleibt der Knopf oben - der Dialog kommt nicht nochmal von selbst.
        sl.warte_bis("() => document.querySelector('.sl-kopf .upd-knopf')")
        sl.js("() => updateLaden()")
        time.sleep(0.5)
        assert sl.page.locator(".app-dialog-hg").count() == 0
        sl.klick(".upd-knopf")
        sl.warte_bis("() => document.querySelector('.app-dialog-hg')")
        sl.dialog_knopf("OK")
        # Handys sehen davon nichts.
        h = tisch.handy("Tessa")
        h.js("() => updateLaden()")
        time.sleep(0.5)
        assert h.page.locator(".upd-knopf, .app-dialog-hg").count() == 0
        assert not tisch.alle_fehler(), tisch.alle_fehler()
    finally:
        tisch.schliessen()
        srv.stop()


def test_update_dialog_kommt_nicht_mitten_im_kampf(browser, tmp_path, monkeypatch):
    monkeypatch.setenv("SWI_NEUESTE_VERSION", "99.0.0")
    srv = C.Server(tmp_path / "data").start()
    tisch = C.Tisch(browser, srv)
    try:
        sl, _ = voller_tisch(tisch)                 # Runde 1 läuft
        sl.js("() => document.querySelectorAll('.app-dialog-hg button').forEach(b => b.click())")
        sl.js("() => updateLaden()")
        sl.warte_bis("() => document.querySelector('.sl-kopf .upd-knopf')")
        assert sl.page.locator(".app-dialog-hg").count() == 0
        assert not tisch.alle_fehler(), tisch.alle_fehler()
    finally:
        tisch.schliessen()
        srv.stop()


def test_abend_beenden_stoppt_aufnahme_raeumt_ab_und_sichert(tisch):
    sl, hs = voller_tisch(tisch)
    sl.js(FAKE_MIKRO)
    _aufnahme_panel_auf(sl)
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.rec.state === 'recording'")
    time.sleep(3.5)
    sl.klick("[data-act=aufn-abend-ende]")
    sl.warte_bis("() => document.querySelectorAll('.app-dialog-hg [data-abend]').length === 3")
    sl.dialog_knopf("Abend beenden")
    sl.warte_bis("() => !Aufn.rec && Aufn.status && !Aufn.status.aktiv", frist=15000)
    sl.warte_bis("() => App.state.round === 0 && !App.state.combatants.some(c => c.kind === 'npc')")
    # Spieler bleiben verbunden.
    assert hs[0].js("App.joined") and len([c for c in sl.state()["combatants"] if c["kind"] == "player"]) == 2
    frist = time.time() + 10
    while time.time() < frist and not list((tisch.server.daten / "sicherungen").glob("auto-*.zip")):
        time.sleep(0.2)
    assert list((tisch.server.daten / "sicherungen").glob("auto-*.zip"))
    # Speicherplatz steht jetzt im Panel (es gibt eine Aufnahme).
    sl.js("() => aufnStatusLaden()")
    sl.warte_bis("() => document.querySelector('.aufn-platz')")
    zeile = sl.page.inner_text(".aufn-platz")
    assert "Aufnahmen" in zeile and "frei auf der Platte" in zeile
    # Kein Knopf zum Löschen des Tons (Kalle: „Ton nicht löschen").
    assert sl.page.locator("[data-act=aufn-abend-ende]").count() == 0


def test_abend_beenden_abbrechen_laesst_alles(tisch):
    sl = tisch.sl()
    sl.js(FAKE_MIKRO)
    _aufnahme_panel_auf(sl)
    sl.klick("[data-act=aufn-start]")
    sl.warte_bis("() => Aufn.rec && Aufn.rec.state === 'recording'")
    sl.klick("[data-act=aufn-abend-ende]")
    # Kein Kampf am Tisch: nur Aufnahme + Sicherung stehen zur Wahl.
    sl.warte_bis("() => document.querySelectorAll('.app-dialog-hg [data-abend]').length === 2")
    sl.dialog_knopf("Abbrechen")
    time.sleep(0.5)
    assert sl.js("() => Aufn.rec.state") == "recording"
    sl.js("() => aufnahmeBeenden(true)")
    sl.warte_bis("() => !Aufn.rec", frist=15000)


def test_chronik_alle_abende_neueste_zuerst(tisch):
    sl, hs = voller_tisch(tisch)
    tisch.gm({"type": "protokoll_speichern", "text": "# Die Glutinsel\nSturm über Graufels.", "freigegeben": True})
    tisch.gm({"type": "protokoll_speichern", "text": "# Geheim\nNur für den SL."})
    tisch.gm({"type": "protokoll_speichern", "text": "# Enterkommando\n**Tessa** hielt das Ruder.", "freigegeben": True})
    h = hs[0]
    h.warte_bis("() => App.state.protokolle.length === 3")
    h.js("() => document.querySelectorAll('[data-act=dismiss-msg]').forEach(b => b.click())")
    h.js("() => { Prot.offen = true; Prot.wasBisher = false; protokollOeffnen(); render(); }")
    h.warte_bis("() => document.querySelector('[data-act=prot-chronik]')")
    h.klick("[data-act=prot-chronik]")
    h.warte_bis("() => document.querySelectorAll('.chr-kapitel .pt-text p').length === 3")
    titel = h.js("() => [...document.querySelectorAll('.chr-titel')].map(e => e.textContent)")
    assert titel == ["Enterkommando", "Die Glutinsel", "Der erste Abend"]      # neueste zuerst, nichts Geheimes
    nummern = h.js("() => [...document.querySelectorAll('.chr-nr')].map(e => e.textContent.trim().split(' ·')[0])")
    assert nummern == ["Kapitel 3", "Kapitel 2", "Kapitel 1"]
    # Der Titel steht nicht doppelt (Kapitelüberschrift + „# Titel" im Text).
    assert h.page.inner_text(".chronik").count("Enterkommando") == 1
    assert h.page.locator("[data-act=prot-drucken]").count() == 0             # Drucken nur beim SL
    h.kein_waagrechtes_scrollen("Chronik")
    h.klick("[data-act=prot-einzeln]")
    h.warte_bis("() => document.querySelector('.pt-abend') && !document.querySelector('.chronik')")
    h.klick(".protokoll-fenster [data-act=prot-zu]")

    # SL: Knopf im Protokoll-Panel, sieht auch das Unfreigegebene, kann drucken.
    sl.js("() => document.querySelectorAll('.app-dialog-hg button').forEach(b => b.click())")
    sl.js("() => { document.querySelector('details[data-sec=protokolle]').open = true; }")
    sl.klick("[data-sec=protokolle] [data-act=prot-chronik]")
    sl.warte_bis("() => document.querySelectorAll('.chr-kapitel .pt-text p').length === 4")
    assert "Geheim" in sl.page.inner_text(".chronik")
    sl.warte_bis("() => { const b = document.querySelector('[data-act=prot-drucken]'); return b && !b.disabled; }")
    # Drucken: nur die Chronik bleibt sichtbar, Knöpfe verschwinden.
    sl.page.emulate_media(media="print")
    sl.js("() => document.body.classList.add('chronik-druck')")
    sichtbar = sl.js("""() => ({ kopf: getComputedStyle(document.querySelector('.sl-kopf')).display,
        knopf: getComputedStyle(document.querySelector('[data-act=prot-drucken]').parentElement).display,
        text: getComputedStyle(document.querySelector('.chr-kapitel')).display,
        hoehe: document.querySelector('.protokoll-fenster').scrollHeight <= document.querySelector('.protokoll-fenster').clientHeight + 1 })""")
    assert sichtbar == {"kopf": "none", "knopf": "none", "text": "block", "hoehe": True}
    sl.page.emulate_media(media="screen")
    sl.js("() => document.body.classList.remove('chronik-druck')")


def test_foto_vom_papierbogen(tisch, tmp_path):
    sl = tisch.sl()
    h = tisch.handy("Mira")
    bild = tmp_path / "bogen.png"
    bild.write_bytes(PNG)
    # Leerer Bogen (seit 14.11.2026): Leerzustand mit zwei Wegen – „Werte
    # eintragen" und „📷 Foto vom Papierbogen", der gleich den Foto-Reiter öffnet.
    h.reiter("bogen")
    h.warte_bis("() => document.querySelector('.bogen-leer [data-act=bogen-bearbeiten]')")
    assert h.page.locator(".bogen-leer button, .bogen-leer label").count() == 2
    h.klick(".bogen-leer [data-act=bogen-bearbeiten][data-reiter=foto]")
    h.warte_bis("() => document.querySelector('.bogen [data-act=bfoto-wahl]')")
    h.page.set_input_files(".bogen [data-act=bfoto-wahl]", str(bild))
    h.warte_bis("() => (myCombatant().bogen || {}).foto")
    h.klick("[data-act=bogen-abbrechen]")     # Foto ist schon gespeichert
    foto = h.js("() => myCombatant().bogen.foto")
    assert foto.startswith("/uploads/")
    h.warte_bis("() => { const i = document.querySelector('.bogen-foto img'); return i && i.complete && i.naturalWidth > 0; }")
    h.kein_waagrechtes_scrollen("Foto im Bogen")
    # Groß ansehen, hineinzoomen, schließen.
    h.klick(".bogen-foto")
    h.warte_bis("() => document.querySelector('.foto-gross-hg img')")
    h.klick(".foto-gross-hg img")
    assert h.js("() => document.querySelector('.foto-gross-hg').classList.contains('zoom')")
    h.klick(".foto-gross-zu")
    assert h.page.locator(".foto-gross-hg").count() == 0
    # Werte eintragen und speichern nimmt das Foto nicht wieder weg.
    h.klick(".bogen .reiter [data-reiter=kampf]")
    h.klick("[data-act=bogen-bearbeiten]")
    h.fill("[data-bogen=parade]", "6")
    h.klick("[data-act=bogen-speichern]")
    h.warte_bis("() => myCombatant().bogen.parade === '6'")
    assert h.js("() => myCombatant().bogen.foto") == foto
    # Der SL sieht es (Bogen der Figur, Reiter Foto).
    sl.warte_bis("() => App.state.combatants.some(c => c.bogen && c.bogen.foto)")
    sl.js("() => { App.bogenAnsicht = { id: App.state.combatants.find(c => c.bogen && c.bogen.foto).id, quelle: 'kampf' }; App.bogenAnsichtReiter = 'foto'; render(); }")
    sl.warte_bis("() => document.querySelector('.bogen-ansicht .bogen-foto img')")
    sl.js("() => { App.bogenAnsicht = null; App.bogenAnsichtReiter = null; render(); }")
    # Gilt nicht als verwaist (sonst räumte „Alte Bilder aufräumen" es weg).
    assert tisch.server.json("api/bilder-verwaist")["anzahl"] == 0
    # Entfernen.
    h.klick(".bogen .reiter [data-reiter=foto]")
    h.klick("[data-act=bfoto-weg]")
    h.dialog_knopf("Entfernen")
    h.warte_bis("() => !myCombatant().bogen.foto")
    assert h.js("() => myCombatant().bogen.parade") == "6"


def test_handy_bleibt_im_kampf_wach(tisch):
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    h.js("() => document.querySelectorAll('[data-act=dismiss-msg]').forEach(b => b.click())")
    assert h.js("() => wachSoll()") is True            # Runde läuft, Schalter steht an
    assert sl.js("() => wachSoll()") is False          # der SL-Laptop braucht das nicht
    # Ein Tipp (Berührung) startet es - Wake Lock oder das stille Video.
    h.page.locator("body").click(position={"x": 5, "y": 5})
    h.warte_bis("() => Wach.an", frist=8000)
    # Schalter im ⚙ aus: Handy darf wieder schlafen, und das bleibt gemerkt.
    h.js("() => document.getElementById('skinbar').classList.add('open')")
    h.klick("[data-act=toggle-wach]")
    h.warte_bis("() => !Wach.an && !wachSoll()")
    assert h.js("() => localStorage.getItem('wachBleiben')") == "off"
    h.klick("[data-act=toggle-wach]")
    h.warte_bis("() => Wach.an", frist=8000)
    # Kampf vorbei: von selbst aus.
    tisch.gm({"type": "clear_all"})
    h.warte_bis("() => App.state.round === 0")
    h.warte_bis("() => !Wach.an", frist=8000)


def test_wach_ohne_wake_lock_laeuft_das_stille_video(tisch):
    # So ist es am echten Handy: die App läuft über http://192.168…, dort gibt
    # es navigator.wakeLock nicht - dann hält das stille Video den Bildschirm an.
    sl, hs = voller_tisch(tisch)
    h = hs[0]
    h.js("() => document.querySelectorAll('[data-act=dismiss-msg]').forEach(b => b.click())")
    h.js("() => { wachAus(); Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true }); }")
    h.page.locator("body").click(position={"x": 5, "y": 5})
    h.warte_bis("() => Wach.an && Wach.video && !Wach.video.paused && Wach.video.currentTime > 0", frist=8000)
    tisch.gm({"type": "clear_all"})
    h.warte_bis("() => !Wach.an && Wach.video.paused", frist=8000)
