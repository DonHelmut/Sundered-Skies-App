"""Aktualisieren.exe: Versionsvergleich und Austausch ohne den Spielstand."""
import aktualisieren as akt


def test_versionen_als_zahlen():
    assert akt.version_tupel("v1.4.1") == (1, 4, 1)
    assert akt.ist_neuer("1.10", "1.9")          # als Text wäre 1.10 < 1.9
    assert akt.ist_neuer("1.4.1", "1.4")
    assert not akt.ist_neuer("1.4", "1.4.0")
    assert not akt.ist_neuer("1.4.1", "1.4.1")
    assert akt.ist_neuer("1.5", None)            # unbekannt -> aktualisieren
    assert not akt.ist_neuer(None, "1.4")


def test_version_aus_starthier(tmp_path):
    (tmp_path / "START-HIER.txt").write_text("Sundered Skies – Initiative  (Version 1.4.1)\n===\n", encoding="utf-8")
    assert akt.version_aus_starthier(tmp_path) == "1.4.1"
    assert akt.version_aus_starthier(tmp_path / "fehlt") is None


def _paket(wurzel, version, updater_text):
    wurzel.mkdir()
    (wurzel / akt.APP_EXE).write_text("exe " + version)
    (wurzel / "_internal").mkdir()
    (wurzel / "_internal" / "neu.dll").write_text(version)
    (wurzel / "START-HIER.txt").write_text(f"x (Version {version})")
    (wurzel / akt.SELBST_EXE).write_text(updater_text)
    (wurzel / akt.SELBST_ORDNER).mkdir()
    (wurzel / akt.SELBST_ORDNER / "base.zip").write_text(updater_text)
    return wurzel


def test_austauschen_laesst_data_und_legt_updater_als_neu(tmp_path):
    ordner = tmp_path / "App"
    ordner.mkdir()
    (ordner / akt.APP_EXE).write_text("exe alt")
    (ordner / "_internal").mkdir()
    (ordner / "_internal" / "alt.dll").write_text("alt")
    (ordner / "data").mkdir()
    (ordner / "data" / "roster.json").write_text("[Korgo]")
    (ordner / akt.SELBST_EXE).write_text("updater alt")
    (ordner / "Aktualisieren.bat").write_text("alt")
    quelle = _paket(tmp_path / "neu", "1.5", "updater neu")
    (quelle / "data").mkdir()                    # ein data im Paket darf NIE gewinnen
    (quelle / "data" / "roster.json").write_text("[]")

    akt.austauschen(quelle, ordner)
    assert (ordner / "data" / "roster.json").read_text() == "[Korgo]"
    assert (ordner / akt.APP_EXE).read_text() == "exe 1.5"
    assert not (ordner / "_internal" / "alt.dll").exists()      # alte Reste weg
    assert (ordner / "_internal" / "neu.dll").exists()
    assert (ordner / akt.SELBST_EXE).read_text() == "updater alt"   # läuft ja gerade
    assert (ordner / (akt.SELBST_EXE + ".neu")).read_text() == "updater neu"

    # Beim nächsten App-Start: neue Updater-Dateien einsetzen, Vorgänger weg.
    assert akt.updater_nachziehen(ordner) is True
    assert (ordner / akt.SELBST_EXE).read_text() == "updater neu"
    assert (ordner / akt.SELBST_ORDNER / "base.zip").read_text() == "updater neu"
    assert not (ordner / (akt.SELBST_EXE + ".neu")).exists()
    assert not (ordner / "Aktualisieren.bat").exists()
    assert akt.updater_nachziehen(ordner) is False               # nichts mehr zu tun


def test_app_laeuft_ohne_dll_ist_falsch(tmp_path):
    assert akt.app_laeuft(tmp_path) is False


def test_fortschrittsbalken():
    mb = 1024 * 1024
    assert akt.fortschritt_balken(0, 26 * mb) == "  [" + "░" * 30 + "]   0 %   0,0 / 26,0 MB"
    halb = akt.fortschritt_balken(13 * mb, 26 * mb)
    assert halb.count("█") == 15 and " 50 %" in halb and "13,0 / 26,0 MB" in halb
    assert akt.fortschritt_balken(26 * mb, 26 * mb).count("█") == 30
    assert akt.fortschritt_balken(30 * mb, 26 * mb).count("█") == 30      # nie über 100 %


# --- Gesperrte Dateien (OneDrive, Virenscanner) -----------------------------
# Vorgeschichte 1.5.35: „Zugriff verweigert" auf _aktualisieren.neu, bei jedem
# Versuch – und danach war _aktualisieren leer. Gesperrt wird hier simuliert,
# indem rename für bestimmte Namen scheitert.

import pathlib

import pytest


def _alte_app(ordner):
    ordner.mkdir()
    (ordner / akt.APP_EXE).write_text("exe alt")
    (ordner / "_internal").mkdir()
    (ordner / "_internal" / "alt.dll").write_text("alt")
    (ordner / "START-HIER.txt").write_text("x (Version 1.4)")
    (ordner / "data").mkdir()
    (ordner / "data" / "roster.json").write_text("[Korgo]")
    (ordner / akt.SELBST_EXE).write_text("updater alt")
    (ordner / akt.SELBST_ORDNER).mkdir()
    (ordner / akt.SELBST_ORDNER / "base.zip").write_text("updater alt")
    return ordner


@pytest.fixture
def sperren(monkeypatch):
    """Namen in ``gesperrt`` lassen sich nicht umbenennen; Zahl = wie oft noch."""
    monkeypatch.setattr(akt, "GEDULD_S", 0.3)
    monkeypatch.setattr(akt, "GEDULD_KURZ_S", 0.1)
    monkeypatch.setattr(akt, "PAUSE_S", 0.01)
    gesperrt = {}
    echt = pathlib.Path.rename

    def rename(self, ziel):
        for name in (self.name, pathlib.Path(ziel).name):
            if name in gesperrt and gesperrt[name] != 0:
                gesperrt[name] -= 1
                raise PermissionError(5, "Zugriff verweigert", str(self))
        return echt(self, ziel)

    monkeypatch.setattr(pathlib.Path, "rename", rename)
    return gesperrt


def test_haengendes_updater_neu_blockiert_die_app_nicht(tmp_path, sperren):
    ordner = _alte_app(tmp_path / "App")
    (ordner / (akt.SELBST_ORDNER + ".neu")).mkdir()      # Rest, dauerhaft gesperrt
    sperren[akt.SELBST_ORDNER + ".neu"] = -1
    quelle = _paket(tmp_path / "neu", "1.5", "updater neu")

    akt.austauschen(quelle, ordner)
    assert (ordner / akt.APP_EXE).read_text() == "exe 1.5"
    assert (ordner / "_internal" / "neu.dll").exists()
    assert akt.version_aus_starthier(ordner) == "1.5"
    assert (ordner / akt.SELBST_ORDNER / "base.zip").read_text() == "updater alt"
    assert not [p for p in ordner.iterdir() if akt.KOMMT in p.name]


def test_kurze_sperre_wird_abgewartet(tmp_path, sperren):
    ordner = _alte_app(tmp_path / "App")
    sperren["_internal"] = 3
    akt.austauschen(_paket(tmp_path / "neu", "1.5", "u"), ordner)
    assert (ordner / "_internal" / "neu.dll").exists()
    assert not (ordner / "_internal" / "alt.dll").exists()


def test_dauersperre_tauscht_zurueck_und_alte_version_bleibt(tmp_path, sperren):
    ordner = _alte_app(tmp_path / "App")
    sperren["_internal"] = -1
    with pytest.raises(akt.AustauschFehler) as fehler:
        akt.austauschen(_paket(tmp_path / "neu", "1.5", "u"), ordner)
    assert fehler.value.alt_heil
    assert (ordner / akt.APP_EXE).read_text() == "exe alt"
    assert (ordner / "_internal" / "alt.dll").exists()
    assert akt.version_aus_starthier(ordner) == "1.4"      # zweiter Versuch tut was
    assert (ordner / "data" / "roster.json").read_text() == "[Korgo]"
    sperren.clear()
    akt.aufraeumen(ordner)
    assert sorted(p.name for p in ordner.iterdir()) == sorted(
        ["Aktualisieren.exe", "START-HIER.txt", akt.APP_EXE, "_aktualisieren", "_internal", "data"])


def test_nachziehen_laesst_nie_einen_leeren_updater_zurueck(tmp_path, sperren):
    ordner = _alte_app(tmp_path / "App")
    neu = ordner / (akt.SELBST_ORDNER + ".neu")
    neu.mkdir()
    (neu / "base.zip").write_text("updater neu")
    sperren[akt.SELBST_ORDNER + ".neu"] = -1
    assert akt.updater_nachziehen(ordner) is False
    assert (ordner / akt.SELBST_ORDNER / "base.zip").read_text() == "updater alt"
    sperren.clear()
    assert akt.updater_nachziehen(ordner) is True
    assert (ordner / akt.SELBST_ORDNER / "base.zip").read_text() == "updater neu"
    assert not [p for p in ordner.iterdir() if akt.WEG in p.name]


def test_nachziehen_raeumt_leere_reste_weg(tmp_path):
    ordner = _alte_app(tmp_path / "App")
    (ordner / (akt.SELBST_ORDNER + ".neu")).mkdir()
    (ordner / ("_internal" + akt.WEG + "20261104")).mkdir()
    (ordner / ("_internal" + akt.WEG + "20261104") / "x.dll").write_text("x")
    assert akt.updater_nachziehen(ordner) is False
    assert (ordner / akt.SELBST_ORDNER / "base.zip").read_text() == "updater alt"
    assert sorted(p.name for p in ordner.iterdir()) == sorted(
        ["Aktualisieren.exe", "START-HIER.txt", akt.APP_EXE, "_aktualisieren", "_internal", "data"])


# --- Neueste Version ohne API-Limit (09.11.2026) --------------------------------

class _Antwort:
    def __init__(self, adresse="", laenge=None):
        self._adresse, self.headers = adresse, {"Content-Length": laenge} if laenge else {}
    def geturl(self):
        return self._adresse
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


def test_neueste_version_ueber_release_link_ohne_api(monkeypatch):
    aufrufe = []
    def urlopen(anfrage, timeout=None):
        url = anfrage.full_url
        aufrufe.append(url)
        assert "api.github.com" not in url
        if url.endswith("/releases/latest"):
            return _Antwort(f"https://github.com/{akt.REPO}/releases/tag/v2.0.5")
        return _Antwort(url, "1234")
    monkeypatch.setattr(akt.urllib.request, "urlopen", urlopen)
    neu, url, groesse = akt.neueste_version()
    assert (neu, groesse) == ("2.0.5", 1234)
    assert url == f"https://github.com/{akt.REPO}/releases/download/v2.0.5/{akt.ZIP_NAME}"


def test_neueste_version_faellt_auf_api_zurueck(monkeypatch):
    import io, json
    def urlopen(anfrage, timeout=None):
        if "api.github.com" in anfrage.full_url:
            daten = {"tag_name": "v2.0.6", "assets": [{"name": akt.ZIP_NAME, "browser_download_url": "https://x/z.zip", "size": 5}]}
            return io.BytesIO(json.dumps(daten).encode())
        return _Antwort("https://github.com/irgendwo/ohne-tag")
    monkeypatch.setattr(akt.urllib.request, "urlopen", urlopen)
    assert akt.neueste_version() == ("2.0.6", "https://x/z.zip", 5)
