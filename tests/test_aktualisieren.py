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
