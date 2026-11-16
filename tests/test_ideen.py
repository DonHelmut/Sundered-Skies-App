"""Gewählte Ideen aus der Durchleuchtung (Kalle 10.11.2026): Update-Hinweis,
Beenden-Nachfrage, Speicherplatz, Foto vom Papierbogen, Updater --auto."""
import asyncio
from pathlib import Path
from types import SimpleNamespace

import aktualisieren as akt
from server import app as A
from server import fenster as F
from server import run as R
from server import sicherung as S
from server import update as U
from server.game import _bogen_sauber

FOTO = "/uploads/" + "a" * 32 + ".jpg"


def _req(host="localhost:8000"):
    return SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={"host": host}, cookies={})


def _json(antwort):
    import json
    return json.loads(antwort.body)


# --- I1 Update-Hinweis ----------------------------------------------------------

def test_update_pruefen_merkt_neuere_version_und_titel(monkeypatch):
    monkeypatch.setattr(U, "stand", {"neu": None, "titel": ""})
    monkeypatch.setattr(U, "APP_VERSION", "2.0.6")
    U.pruefen(lambda: ("2.0.7", "url", 1), lambda repo: "Sundered Skies Initiative 2.0.7 – Handy bleibt wach")
    assert U.verfuegbar()
    aus = U.auskunft(Path("/gibt/es/nicht"))
    assert aus["neu"] == "2.0.7" and aus["lokal"] == "2.0.6" and aus["titel"] == "Handy bleibt wach"
    assert aus["kann"] is False                     # keine Aktualisieren.exe -> nur der Link


def test_update_gleiche_oder_aeltere_version_ist_kein_hinweis(monkeypatch):
    monkeypatch.setattr(U, "stand", {"neu": None, "titel": ""})
    monkeypatch.setattr(U, "APP_VERSION", "2.0.7")
    for neu in ("2.0.7", "2.0.6", "1.9"):
        U.pruefen(lambda: (neu, "url", 1), lambda repo: "x – y")
        assert not U.verfuegbar(), neu
    # 2.0.10 ist neuer als 2.0.7 (Zahlen, nicht Text).
    U.pruefen(lambda: ("2.0.10", "url", 1), lambda repo: "")
    assert U.verfuegbar()


def test_update_ohne_internet_bleibt_still(monkeypatch):
    monkeypatch.setattr(U, "stand", {"neu": None, "titel": ""})

    def kaputt():
        raise OSError("kein Netz")
    assert U.pruefen(kaputt)["neu"] is None
    assert not U.verfuegbar()
    # Der Titel ist nur Dreingabe: scheitert er, bleibt der Hinweis.
    monkeypatch.setattr(U, "APP_VERSION", "2.0.6")
    U.pruefen(lambda: ("2.0.7", "u", 1), lambda repo: (_ for _ in ()).throw(OSError("403")))
    assert U.verfuegbar() and U.stand["titel"] == ""


def test_was_neu_nimmt_den_teil_hinter_dem_strich():
    assert U.was_neu("Sundered Skies Initiative 2.0.6 – Eigenes Fenster") == "Eigenes Fenster"
    assert U.was_neu("Sundered Skies Initiative 2.0.6") == ""


def test_update_starten_ruft_updater_mit_auto(tmp_path, monkeypatch):
    (tmp_path / "Aktualisieren.exe").write_bytes(b"x")
    monkeypatch.setattr(U.os, "name", "nt")
    rufe = []
    monkeypatch.setattr(U, "STAND_DATEI", tmp_path / "data" / "update-stand.json")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "update-stand.json").write_text('{"schritt": "fertig"}')
    assert U.starten(tmp_path, lambda befehl, **kw: rufe.append((befehl, kw)))
    befehl, kw = rufe[0]
    assert befehl == [str(tmp_path / "Aktualisieren.exe"), "--auto", "--stand", str(U.STAND_DATEI)]
    assert kw["cwd"] == str(tmp_path)
    # Alter Stand vom letzten Mal ist weg - der Balken beginnt bei null.
    assert U.fortschritt()["schritt"] == "start"
    # Ohne die .exe (Entwickler-Start): nichts starten.
    assert not U.starten(tmp_path / "leer", lambda *a, **k: rufe.append(1))
    assert len(rufe) == 1


def test_update_routen_nur_fuer_den_sl(monkeypatch):
    fremd = SimpleNamespace(client=SimpleNamespace(host="192.168.1.20"), headers={"host": "192.168.1.5:8000"}, cookies={})
    assert asyncio.run(A.update_auskunft(fremd)).status_code == 403
    assert asyncio.run(A.update_start(fremd)).status_code == 403
    monkeypatch.setattr(U, "stand", {"neu": None, "titel": ""})
    # SL, aber nichts Neues: kein Start.
    antwort = asyncio.run(A.update_start(_req()))
    assert antwort.status_code == 409


def test_update_start_nicht_waehrend_der_aufnahme(monkeypatch, tmp_path):
    monkeypatch.setattr(U, "stand", {"neu": "99.0", "titel": ""})
    gestartet = []
    monkeypatch.setattr(U, "starten", lambda basis: gestartet.append(basis) or True)
    monkeypatch.setattr(A, "SICHERUNG_DIR", tmp_path / "sicherungen")
    monkeypatch.setattr(A.aufnahmen, "aktiv", {"name": "x", "start": 0, "ereignisse": []})
    monkeypatch.setattr(A.aufnahmen, "_letztes_stueck", A.time.time() * 1000)
    antwort = asyncio.run(A.update_start(_req()))
    assert antwort.status_code == 409 and "Aufnahme" in _json(antwort)["error"] and not gestartet
    # Ohne Aufnahme: Sicherung anlegen, dann starten.
    monkeypatch.setattr(A.aufnahmen, "aktiv", None)
    antwort = asyncio.run(A.update_start(_req()))
    assert _json(antwort) == {"ok": True} and gestartet
    assert list((tmp_path / "sicherungen").glob("auto-*.zip"))


# --- Updater --auto ---------------------------------------------------------------

def test_fortschritt_route_liest_stand_des_updaters(monkeypatch, tmp_path):
    datei = tmp_path / "update-stand.json"
    monkeypatch.setattr(U, "STAND_DATEI", datei)
    # Noch nichts geschrieben: nur die laufende Version.
    assert _json(asyncio.run(A.update_fortschritt(_req()))) == {"version": A.APP_VERSION}
    monkeypatch.setattr(akt, "STAND", datei)
    akt.stand_schreiben(schritt="laden", neu="9.9.9", geladen=5, groesse=10)
    d = _json(asyncio.run(A.update_fortschritt(_req())))
    assert (d["schritt"], d["geladen"], d["groesse"], d["version"]) == ("laden", 5, 10, A.APP_VERSION)
    fremd = SimpleNamespace(client=SimpleNamespace(host="192.168.1.20"), headers={"host": "192.168.1.5:8000"}, cookies={})
    assert asyncio.run(A.update_fortschritt(fremd)).status_code == 403


def test_stand_schreiben_wirft_nie(monkeypatch, tmp_path):
    monkeypatch.setattr(akt, "STAND", None)
    akt.stand_schreiben(schritt="laden")                      # ohne --stand: nichts
    monkeypatch.setattr(akt, "STAND", tmp_path / "gibts-nicht" / "x.json")
    akt.stand_schreiben(schritt="laden")                      # Ordner fehlt: still
    assert akt.stand_aus_argumenten(["--auto", "--stand", "C:/a/b.json"]) == Path("C:/a/b.json")
    assert akt.stand_aus_argumenten(["--auto"]) is None


def _updater_nachspielen(monkeypatch, tmp_path, tauschen=None):
    """main() mit --auto, ohne Netz und ohne Windows. Merkt sich die
    Reihenfolge der Schritte und was in der Stand-Datei stand."""
    import io, json, zipfile
    ordner = tmp_path / "app"
    ordner.mkdir()
    (ordner / akt.APP_EXE).write_bytes(b"alt")
    stand = tmp_path / "data" / "update-stand.json"
    stand.parent.mkdir()
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        z.writestr(f"SunderedSkies-App/{akt.APP_EXE}", "neu")
    reihe = []
    def lesen():
        return json.loads(stand.read_text(encoding="utf-8"))
    def herunterladen(url, ziel, groesse, melden=None):
        reihe.append("laden")
        melden(groesse // 2, groesse)
        reihe.append(("stand", lesen()["schritt"], lesen()["geladen"]))
        ziel.write_bytes(puffer.getvalue())
    an = {"app": True}
    def beenden(o):
        reihe.append("beenden")
        an["app"] = False
        return True
    monkeypatch.setattr(akt.sys, "argv", ["Aktualisieren.exe", "--auto", "--stand", str(stand)])
    monkeypatch.setattr(akt.Path, "cwd", staticmethod(lambda: ordner))
    monkeypatch.setattr(akt, "version_aus_starthier", lambda o: "1.0.0")
    monkeypatch.setattr(akt, "neueste_version", lambda: ("1.0.1", "https://x/z.zip", 1000))
    monkeypatch.setattr(akt, "herunterladen", herunterladen)
    monkeypatch.setattr(akt, "app_laeuft", lambda o: an["app"])
    monkeypatch.setattr(akt, "app_beenden", beenden)
    monkeypatch.setattr(akt, "austauschen", tauschen or (lambda q, o: reihe.append("tauschen") or []))
    monkeypatch.setattr(akt, "selbst_tausch_starten", lambda o: False)
    monkeypatch.setattr(akt, "app_starten", lambda o, **k: reihe.append("starten") or True)
    monkeypatch.setattr(akt.time, "sleep", lambda s: None)
    monkeypatch.setenv("SWS_OHNE_PAUSE", "1")
    try:
        akt.main()
    except SystemExit as e:
        reihe.append(("ende", e.code))
    return reihe, lesen()


def test_updater_laedt_erst_und_beendet_die_app_danach(monkeypatch, tmp_path):
    # Kalle 16.11.2026: Ladebalken in der App - dafür muss die App während des
    # Downloads noch laufen. Früher: erst beenden, dann laden (1 min aus).
    reihe, ende = _updater_nachspielen(monkeypatch, tmp_path)
    assert reihe == ["laden", ("stand", "laden", 500), "beenden", "tauschen", "starten", ("ende", 0)]
    assert ende["schritt"] == "fertig" and ende["neu"] == "1.0.1"


def test_updater_meldet_fehler_und_startet_alte_app(monkeypatch, tmp_path):
    def tauschen(q, o):
        raise akt.AustauschFehler("gesperrt", alt_heil=True)
    reihe, ende = _updater_nachspielen(monkeypatch, tmp_path, tauschen)
    assert reihe[-2:] == ["starten", ("ende", 1)]
    assert ende["schritt"] == "fehler" and ende["alt_heil"] is True and "gesperrt" in ende["fehler"]

def test_app_starten_ohne_zweites_fenster(tmp_path):
    rufe = []
    assert akt.app_starten(tmp_path, lambda befehl, **kw: rufe.append((befehl, kw)))
    befehl, kw = rufe[0]
    assert befehl == [str(tmp_path / akt.APP_EXE)]
    assert kw["env"]["SWI_NO_BROWSER"] == "1"      # das alte Fenster lädt sich selbst neu
    assert "SWS_UPDATER_TAUSCHT" not in kw["env"]
    # Tauscht der Updater sich gleich selbst, soll die App nicht auch nachziehen.
    akt.app_starten(tmp_path, lambda befehl, **kw: rufe.append((befehl, kw)), tauscht_selbst=True)
    assert rufe[1][1]["env"]["SWS_UPDATER_TAUSCHT"] == "1"

    def kaputt(*a, **k):
        raise OSError("weg")
    assert akt.app_starten(tmp_path, kaputt) is False


# --- V3 Beenden-Nachfrage ----------------------------------------------------------

def _aufn(aktiv=None, letztes=0, pausiert=False):
    return SimpleNamespace(aktiv=aktiv, _letztes_stueck=letztes, pausiert=pausiert)


def test_beenden_warnung_nur_bei_laufender_aufnahme():
    jetzt = 10_000_000
    assert R.beenden_warnung(_aufn(), jetzt) == ""
    lauf = {"name": "a", "start": jetzt - 161 * 60000}
    text = R.beenden_warnung(_aufn(lauf, jetzt - 2000), jetzt)
    assert "2:41 h" in text and "Aufnahme" in text
    # Fenster vor 10 Minuten zugemacht: es kommt kein Ton mehr, nichts zu retten.
    assert R.beenden_warnung(_aufn(lauf, jetzt - 10 * 60000), jetzt) == ""
    # In der Pause kommt auch nichts an - die zählt aber.
    assert R.beenden_warnung(_aufn(lauf, jetzt - 10 * 60000, pausiert=True), jetzt)


def test_infobereich_fragt_vor_dem_beenden(tmp_path):
    beendet, gefragt = [], []
    antwort = [False]

    def fragen(text):
        gefragt.append(text)
        return antwort[0]
    warnung = ["Die Aufnahme läuft noch."]
    s = F.Infobereich("http://localhost:8000/", tmp_path, tmp_path / "x.png", lambda: beendet.append(1),
                      warnung=lambda: warnung[0], fragen=fragen)
    s._ende()
    assert gefragt and not beendet                 # „Nein" -> läuft weiter
    antwort[0] = True
    s._ende()
    assert beendet == [1]
    # Ohne Warnung wird nicht gefragt.
    gefragt.clear(); warnung[0] = ""
    s._ende()
    assert not gefragt and beendet == [1, 1]


# --- V2 Speicherplatz ---------------------------------------------------------------

def test_speicherplatz_zaehlt_aufnahmen_und_modelle(tmp_path, monkeypatch):
    aufn, mod = tmp_path / "aufnahmen", tmp_path / "modelle"
    (aufn).mkdir(); (mod / "tief").mkdir(parents=True)
    (aufn / "a.webm").write_bytes(b"x" * 1000)
    (aufn / "a.json").write_bytes(b"x" * 10)
    (mod / "tief" / "m.onnx").write_bytes(b"x" * 5000)
    monkeypatch.setattr(A.aufnahmen, "ordner", aufn)
    monkeypatch.setattr(A.sprache, "modelle", mod)
    monkeypatch.setattr(A, "DATA_DIR", tmp_path)
    p = A._speicherplatz()
    assert p["aufnahmen"] == 1010 and p["modelle"] == 5000 and p["frei"] > 0
    # Fehlt ein Ordner (noch nie aufgenommen): 0 statt Fehler.
    monkeypatch.setattr(A.aufnahmen, "ordner", tmp_path / "gibtsnicht")
    assert A._speicherplatz()["aufnahmen"] == 0


# --- I9 Foto vom Papierbogen ----------------------------------------------------------

def test_bogen_foto_nur_eigene_uploads():
    assert _bogen_sauber({"foto": FOTO})["foto"] == FOTO
    for boese in ("https://boese.example/x.jpg", "/uploads/../session.json", "/uploads/x.jpg",
                  "javascript:alert(1)", 5, None, FOTO + "?x"):
        assert "foto" not in _bogen_sauber({"foto": boese}), boese
    # Ohne Foto bleibt der Bogen, wie er immer war (alte Sicherungen).
    assert "foto" not in _bogen_sauber({"parade": "6"})


def test_bogen_foto_ueberlebt_aufraeumen_und_sicherung(fresh_game):
    g = fresh_game
    char = g.charakter_anlegen("Tessa")
    p = g.register_player("Tessa", char["id"], None)
    c = next(x for x in g.combatants if x.get("playerId") == p["id"])
    g.bogen_setzen(c["id"], {"foto": FOTO})
    assert g.roster[0]["bogen"]["foto"] == FOTO
    name = FOTO.rsplit("/", 1)[-1]
    assert name in g.benutzte_bilder()
    assert name in S.bilder_der_sicherung(g.export_data())
    # Entfernen: Feld weg, Bild gilt wieder als unbenutzt.
    g.bogen_setzen(c["id"], {"foto": ""})
    assert "foto" not in g.roster[0]["bogen"] and name not in g.benutzte_bilder()


# --- I3 Abend beenden: sofort sichern ----------------------------------------------------

def test_sicherung_jetzt(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "SICHERUNG_DIR", tmp_path / "s")
    fremd = SimpleNamespace(client=SimpleNamespace(host="192.168.1.20"), headers={"host": "192.168.1.5:8000"}, cookies={})

    async def lauf():
        assert (await A.sicherung_jetzt(fremd)).status_code == 403
        eins = _json(await A.sicherung_jetzt(_req()))
        zwei = _json(await A.sicherung_jetzt(_req()))
        return eins, zwei
    eins, zwei = asyncio.run(lauf())
    assert eins == {"ok": True, "neu": True}
    assert zwei == {"ok": True, "neu": False}       # nichts geändert -> keine zweite gleiche
    assert len(list((tmp_path / "s").glob("auto-*.zip"))) == 1
