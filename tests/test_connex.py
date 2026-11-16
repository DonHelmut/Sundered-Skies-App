"""Sitzplatz-Erkennung einrichten (server/connex.py): Link von SSL ablesen,
nur SSLs Installer laden, nur signiert starten."""

import io
import json
import time

from server import connex


def _seite(link: str) -> bytes:
    body = f'<p><button class="dl" data-link="{link}">Download SSL Windows ASIO/WDM Driver</button></p>'
    return json.dumps({"article": {"body": body}}).encode()


GUT = connex._ERLAUBT + "Audio Interfaces/SSL2 and plus/SolidStateLogic_UsbAudio_v6.01.00_2026-01-02_setup.exe"


def test_link_von_der_seite():
    link = connex.treiber_link(lambda url: _seite(GUT))
    assert link == GUT.replace(" ", "%20")
    assert connex.link_erlaubt(link)


def test_fremder_link_wird_nicht_genommen():
    # Seite gekapert oder umgebaut: nie etwas anderes als SSLs Installer laden.
    for boese in ("https://example.com/SolidStateLogic_UsbAudio_v1_2020-01-01_setup.exe",
                  connex._ERLAUBT + "x/irgendwas.exe",
                  connex._ERLAUBT + "../fremd/SolidStateLogic_UsbAudio_v1_2020-01-01_setup.exe",
                  "http://s3.eu-west-2.amazonaws.com/zendesk.download.solidstatelogic.com/SolidStateLogic_UsbAudio_v1_2020-01-01_setup.exe"):
        assert not connex.link_erlaubt(boese)
        assert connex.treiber_link(lambda url, b=boese: _seite(b)) == connex._BEKANNT


def test_seite_nicht_erreichbar_nimmt_bekannten_link():
    def kaputt(url):
        raise OSError("kein Netz")
    assert connex.treiber_link(kaputt) == connex._BEKANNT
    assert connex.link_erlaubt(connex._BEKANNT)


def test_nicht_windows_zeigt_nichts(tmp_path):
    e = connex.Einrichtung(tmp_path, windows=False)
    e.pruefen()
    assert e.zustand() is None
    assert e.treiber_holen() is False


def _einrichtung(tmp_path, geraete, treiber=False):
    e = connex.Einrichtung(tmp_path, windows=True)
    e.geraete_lesen = lambda neu: geraete
    e.treiber_da = lambda: treiber
    return e


def test_zustand(tmp_path):
    e = _einrichtung(tmp_path, {"connex": True, "kapseln": False})
    assert e.zustand() is None          # noch nicht nachgesehen
    e.pruefen()
    z = e.zustand()
    assert (z["connex"], z["treiber"], z["kapseln"]) == (True, False, False)
    # Kapseln einzeln sichtbar heißt NICHT „SSL-Treiber da": Windows' eigener
    # USB-Treiber gibt sie auch her (Jonsbo). Die Anzeige darf das nicht behaupten.
    e = _einrichtung(tmp_path, {"connex": True, "kapseln": True})
    e.pruefen()
    z = e.zustand()
    assert z["kapseln"] is True and z["treiber"] is False


class _Antwort(io.BytesIO):
    def __init__(self, daten):
        super().__init__(daten)
        self.headers = {"Content-Length": str(len(daten))}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _warten(e):
    for _ in range(200):
        if e.laden and (e.laden["fehler"] or e.laden["schritt"] == "gestartet"):
            return
        time.sleep(0.02)
    raise AssertionError("Laden wurde nicht fertig")


def test_treiber_laden_und_starten(tmp_path):
    e = _einrichtung(tmp_path, {"connex": True, "kapseln": False})
    gestartet, geholt = [], []
    e.holen = lambda url: _seite(GUT)
    e.oeffnen = lambda req, timeout=0: (geholt.append(req.full_url), _Antwort(b"MZ" + b"x" * 5000))[1]
    e.signatur_gueltig = lambda p: True
    e.starten = gestartet.append
    assert e.treiber_holen() is True
    _warten(e)
    assert e.laden["fehler"] is None and e.laden["anteil"] == 1.0
    assert geholt == [GUT.replace(" ", "%20")]
    assert gestartet and gestartet[0].name == "SolidStateLogic_UsbAudio_v6.01.00_2026-01-02_setup.exe"
    assert gestartet[0].read_bytes().startswith(b"MZ")


def test_ohne_gueltige_signatur_wird_nichts_gestartet(tmp_path):
    e = _einrichtung(tmp_path, {"connex": True, "kapseln": False})
    gestartet = []
    e.holen = lambda url: _seite(GUT)
    e.oeffnen = lambda req, timeout=0: _Antwort(b"boese")
    e.signatur_gueltig = lambda p: False
    e.starten = gestartet.append
    e.treiber_holen()
    _warten(e)
    assert e.laden["fehler"] == "Signatur"
    assert not gestartet
    assert not list(tmp_path.glob("*.exe"))      # liegt auch nicht mehr herum
    # Nach einem Fehler geht ein neuer Versuch.
    assert e.treiber_holen() is True
    _warten(e)


def test_kein_netz_meldet_fehler(tmp_path):
    e = _einrichtung(tmp_path, {"connex": True, "kapseln": False})
    def kaputt(*a, **k):
        raise OSError("kein Netz")
    e.holen = kaputt
    e.oeffnen = kaputt
    e.starten = lambda p: (_ for _ in ()).throw(AssertionError("darf nicht starten"))
    e.treiber_holen()
    _warten(e)
    assert e.laden["fehler"] == "OSError"


def test_route_nur_am_sl_rechner(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from server import app as A

    geholt = []
    monkeypatch.setattr(A.sprache.einrichtung, "treiber_holen", lambda: geholt.append(1))
    monkeypatch.setattr(A.sprache, "richtung_pruefen", lambda: geholt.append("p"))

    def anfrage(ip, aktion):
        async def body():
            return {"aktion": aktion}
        return SimpleNamespace(client=SimpleNamespace(host=ip), headers={"host": "localhost:8000"}, cookies={}, json=body)
    # Vom Handy darf niemand am SL-Rechner ein Programm starten.
    fremd = anfrage("192.168.1.20", "treiber")
    fremd.headers = {"host": "192.168.1.5:8000"}
    assert asyncio.run(A.sprache_sitzplatz(fremd)).status_code == 403
    assert not geholt
    assert asyncio.run(A.sprache_sitzplatz(anfrage("127.0.0.1", "treiber"))).status_code == 200
    assert asyncio.run(A.sprache_sitzplatz(anfrage("127.0.0.1", "pruefen"))).status_code == 200
    assert geholt == [1, "p"]
