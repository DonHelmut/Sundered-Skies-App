"""Aktualisieren.exe – holt die neueste Version von GitHub (Releases) und tauscht
nur die Programmdateien aus. Der Ordner ``data`` (Charaktere, Bilder,
Spielstand) bleibt unangetastet: man bleibt für immer im selben Ordner, statt
jedes Mal ein neues Zip zu entpacken und den Spielstand zu suchen.

Gebaut als Ordnerversion wie die App (Aktualisieren.spec, eigener Unterordner
``_aktualisieren``) – Einzeldatei-.exe starten aus %TEMP% und werden auf
Firmen-Laptops blockiert.

Sich selbst kann ein laufendes Programm nicht überschreiben (Windows sperrt
die geladenen Dateien). Neue Updater-Dateien landen deshalb als ``*.neu``
daneben; die App tauscht sie beim nächsten Start aus (``updater_nachziehen``),
dann läuft der Updater nicht.

Nur Standardbibliothek: die .exe bleibt klein.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

REPO = "DonHelmut/Sundered-Skies-App"
APP_EXE = "SunderedSkiesInitiative.exe"
ZIP_NAME = "SunderedSkies-App.zip"
SELBST_EXE = "Aktualisieren.exe"
SELBST_ORDNER = "_aktualisieren"
# Nie anfassen: der Spielstand.
BEHALTEN = {"data"}
# Vorgänger des Updaters (1.4.1) – fliegen raus, sobald es die .exe gibt.
# Dazu die alten Netzwerk-Skripte (bis 1.5.16 lose im Hauptordner, jetzt in
# „Netzwerk-Hilfe"): das alte WLAN-Skript war kaputt, und doppelt herumliegende
# Skripte verwirren nur.
AUSGEMUSTERT = ("Aktualisieren.bat", "Aktualisieren.ps1", "Firewall-freigeben.bat",
                "Firewall-sperren.bat", "WLAN-Stromsparen-aus.bat")


# --- Reine Hilfsfunktionen (getestet) ---------------------------------------

def version_tupel(text: str | None) -> tuple[int, ...] | None:
    """„1.4.1" -> (1, 4, 1). Zahlen statt Text, sonst wäre 1.10 < 1.9."""
    if not text:
        return None
    m = re.match(r"^\s*v?(\d+(?:\.\d+)*)", text)
    return tuple(int(t) for t in m.group(1).split(".")) if m else None


def ist_neuer(neu: str | None, lokal: str | None) -> bool:
    n, l = version_tupel(neu), version_tupel(lokal)
    if n is None:
        return False
    if l is None:
        return True           # Version unbekannt -> lieber aktualisieren
    laenge = max(len(n), len(l))  # 1.4 == 1.4.0
    return n + (0,) * (laenge - len(n)) > l + (0,) * (laenge - len(l))


def version_aus_starthier(ordner: Path) -> str | None:
    """Die installierte Version steht in der ersten Zeile von START-HIER.txt
    (wird bei jedem Release mitgezogen)."""
    datei = ordner / "START-HIER.txt"
    try:
        zeile = datei.read_text(encoding="utf-8", errors="replace").splitlines()[0]
    except (OSError, IndexError):
        return None
    m = re.search(r"Version\s+(\d+(?:\.\d+)*)", zeile)
    return m.group(1) if m else None


def app_laeuft(ordner: Path) -> bool:
    """Läuft die App aus DIESEM Ordner? Ihre python*.dll ist dann geladen und
    lässt sich nicht zum Schreiben öffnen (Windows sperrt geladene DLLs)."""
    intern = ordner / "_internal"
    for dll in intern.glob("python3*.dll"):
        try:
            with open(dll, "r+b"):
                pass
        except PermissionError:
            return True
        except OSError:
            pass
    return False


# --- Dateien tauschen, auch wenn Windows/OneDrive dazwischenfunkt -------------
#
# Vorgeschichte (1.5.35, Kalles App im OneDrive-Desktop): Der Updater hat erst
# gelöscht und dann denselben Namen neu angelegt. Unter Windows ist ein
# gelöschter Ordner aber nur „zum Löschen vorgemerkt", solange noch jemand
# (OneDrive, Virenscanner, Explorer) einen Griff darauf hat – ein neuer Ordner
# mit demselben Namen gibt dann „Zugriff verweigert" (WinError 5), bei jedem
# Versuch wieder. Beim App-Start wurde ``_aktualisieren`` gelöscht, das
# Umbenennen von ``.neu`` scheiterte – übrig blieb ein LEERER Updater-Ordner.
# Darum jetzt: nie löschen und gleich wieder anlegen. Alte Sachen werden nur
# beiseite UMBENANNT (frei gewordener Name sofort nutzbar), Neues kommt unter
# einem frischen Namen dazu und wird erst ganz am Ende eingesetzt. Klappt ein
# Schritt nicht, wird zurückgetauscht – die alte Version bleibt lauffähig.
# Weggeräumtes (``*.weg-…``) löscht der nächste Start, wenn nichts mehr sperrt.

WEG = ".weg-"         # beiseite gelegt, wird später gelöscht
KOMMT = ".kommt"      # neu kopiert, noch nicht eingesetzt
# Sperren durch OneDrive/Virenscanner lösen sich meist nach Sekunden.
GEDULD_S = 60.0
# Für Nebensachen (Updater-eigene Dateien) und beim App-Start nicht so lange.
GEDULD_KURZ_S = 5.0
PAUSE_S = 0.5


class AustauschFehler(RuntimeError):
    """``alt_heil``: die bisherige Version ist unverändert und startet weiter."""

    def __init__(self, text: str, alt_heil: bool):
        super().__init__(text)
        self.alt_heil = alt_heil


def _geduldig(aktion, geduld_s: float | None = None, was: str = ""):
    """``aktion`` wiederholen, solange Windows „gesperrt" meldet. Fehlende
    Dateien sind kein Sperren – die gehen sofort durch."""
    geduld = GEDULD_S if geduld_s is None else geduld_s
    ende = time.monotonic() + geduld
    gemeldet = False
    while True:
        try:
            return aktion()
        except FileNotFoundError:
            raise
        except OSError:
            if time.monotonic() >= ende:
                raise
            if was and not gemeldet:
                gemeldet = True
                print(f"  {was} ist gerade gesperrt (OneDrive/Virenscanner?) – warte …", flush=True)
            time.sleep(PAUSE_S)


def _schreibbar_machen(funktion, pfad, _info):
    """rmtree-Helfer: schreibgeschützte Dateien (OneDrive setzt das manchmal)
    freigeben und nochmal versuchen."""
    try:
        os.chmod(pfad, 0o700)
        funktion(pfad)
    except OSError:
        pass


def _loeschen(pfad: Path) -> bool:
    """Löschen, so gut es geht – ohne zu warten. Rückgabe: ob weg."""
    try:
        if pfad.is_dir() and not pfad.is_symlink():
            if sys.version_info >= (3, 12):
                shutil.rmtree(pfad, onexc=_schreibbar_machen)
            else:  # pragma: no cover
                shutil.rmtree(pfad, onerror=_schreibbar_machen)
        elif pfad.exists() or pfad.is_symlink():
            try:
                pfad.unlink()
            except PermissionError:
                os.chmod(pfad, 0o700)
                pfad.unlink()
    except OSError:
        pass
    return not (pfad.exists() or pfad.is_symlink())


def _freier_name(pfad: Path, endung: str) -> Path:
    stempel = time.strftime("%Y%m%d-%H%M%S")
    for n in range(1000):
        kandidat = pfad.with_name(f"{pfad.name}{endung}{stempel}{'-' + str(n) if n else ''}")
        if not (kandidat.exists() or kandidat.is_symlink()):
            return kandidat
    raise AustauschFehler(f"Kein freier Name für {pfad.name}", alt_heil=True)


def _beiseite(pfad: Path, geduld_s: float | None = None) -> Path:
    """Umbenennen statt löschen: der Name ist danach sofort frei."""
    weg = _freier_name(pfad, WEG)
    _geduldig(lambda: pfad.rename(weg), geduld_s, pfad.name)
    return weg


def _kopieren(quelle: Path, ziel: Path) -> None:
    if quelle.is_dir():
        # dirs_exist_ok: ein Wiederholungsversuch macht weiter, wo es hing.
        _geduldig(lambda: shutil.copytree(quelle, ziel, dirs_exist_ok=True), was=quelle.name)
    else:
        _geduldig(lambda: shutil.copy2(quelle, ziel), was=quelle.name)


def aufraeumen(ordner: Path) -> None:
    """Reste früherer Updates (``*.weg-…``, halbe ``*.kommt``) löschen, soweit
    nichts mehr sperrt. Was noch hängt, kommt beim nächsten Mal dran."""
    try:
        eintraege = list(ordner.iterdir())
    except OSError:
        return
    for p in eintraege:
        if WEG in p.name or p.name.endswith(KOMMT):
            _loeschen(p)


def _reihenfolge(name: str) -> tuple[int, str]:
    # START-HIER.txt (daraus liest der Updater die Version) zuletzt: steht dort
    # die neue Nummer, ist auch alles andere neu. Sonst hielte ein halber
    # Austausch sich für fertig, und ein zweiter Versuch täte nichts mehr.
    return (1 if name.lower() == "start-hier.txt" else 0, name.lower())


def austauschen(quelle: Path, ordner: Path) -> list[str]:
    """Neue Version aus ``quelle`` nach ``ordner`` bringen. ``data`` bleibt;
    ``_internal`` & Co. werden ganz ersetzt (keine Reste der alten Version).
    Die eigenen Dateien des Updaters kommen als ``*.neu`` daneben – und sind
    Nebensache: hakt es dort, wird die App trotzdem aktualisiert.

    1. Alles unter ``*.kommt`` in den App-Ordner kopieren (alte Version
       unberührt – scheitert das, ist nichts kaputt).
    2. Je Eintrag: alt beiseite umbenennen, neu einsetzen. Scheitert das,
       alles zurück.
    3. Beiseitegelegtes löschen, soweit es geht.

    Rückgabe: Liste der eingesetzten Einträge (für Anzeige/Tests)."""
    aufraeumen(ordner)
    plan = []          # (ziel, kommt, nebensache)
    for eintrag in sorted(quelle.iterdir(), key=lambda p: _reihenfolge(p.name)):
        name = eintrag.name
        if name in BEHALTEN:
            continue
        nebensache = name in (SELBST_EXE, SELBST_ORDNER)
        ziel = ordner / (name + ".neu" if nebensache else name)
        plan.append((eintrag, ziel, nebensache))

    # 1. Kopieren
    bereit = []
    for eintrag, ziel, nebensache in plan:
        kommt = _freier_name(ziel, KOMMT)
        try:
            _kopieren(eintrag, kommt)
        except OSError as fehler:
            _loeschen(kommt)
            if nebensache:
                continue
            for _, k, _n in bereit:
                _loeschen(k)
            raise AustauschFehler(f"Kopieren von {eintrag.name} ging nicht: {fehler}", alt_heil=True) from fehler
        bereit.append((ziel, kommt, nebensache))

    # 2. Einsetzen
    getauscht = []     # (ziel, beiseite oder None)
    weggeraeumt = []
    for ziel, kommt, nebensache in bereit:
        alt = None
        try:
            if ziel.exists() or ziel.is_symlink():
                alt = _beiseite(ziel, GEDULD_KURZ_S if nebensache else None)
            _geduldig(lambda: kommt.rename(ziel), GEDULD_KURZ_S if nebensache else None, ziel.name)
        except OSError as fehler:
            if alt is not None and not ziel.exists():
                try:
                    _geduldig(lambda: alt.rename(ziel))
                    alt = None
                except OSError:
                    pass
            _loeschen(kommt)
            if nebensache:
                if alt is not None:
                    weggeraeumt.append(alt)
                continue
            heil = _zuruecktauschen(getauscht) and alt is None
            for _, k, _n in bereit:
                _loeschen(k)
            raise AustauschFehler(f"Einsetzen von {ziel.name} ging nicht: {fehler}", alt_heil=heil) from fehler
        getauscht.append((ziel, alt))

    # 3. Aufräumen
    for _, alt in getauscht:
        if alt is not None:
            _loeschen(alt)
    for alt in weggeraeumt:
        _loeschen(alt)
    return [ziel.name for ziel, _ in getauscht]


def _zuruecktauschen(getauscht: list) -> bool:
    """Schon eingesetzte Einträge wieder gegen die alten tauschen."""
    heil = True
    for ziel, alt in reversed(getauscht):
        try:
            neu_weg = _beiseite(ziel)
            if alt is not None:
                _geduldig(lambda: alt.rename(ziel))
            _loeschen(neu_weg)
        except OSError:
            heil = False
    return heil


def updater_nachziehen(ordner: Path) -> bool:
    """Liegen neue Updater-Dateien (*.neu) bereit, jetzt einsetzen. Läuft beim
    Start der App (dann ist der Updater nicht offen) – darf den Start nicht
    lange aufhalten und nie einen kaputten Updater hinterlassen: der alte
    wird nur beiseite umbenannt und zurückgeholt, wenn der neue nicht passt.
    Repariert auch einen leeren ``_aktualisieren`` (Folge des alten Fehlers).
    Räumt außerdem Vorgänger und Reste weg. Rückgabe: ob etwas getauscht wurde."""
    getauscht = False
    for name in (SELBST_ORDNER, SELBST_EXE):
        neu = ordner / (name + ".neu")
        alt = ordner / name
        if not neu.exists():
            continue
        if neu.is_dir() and not any(neu.iterdir()):
            _loeschen(neu)          # leerer Rest eines gescheiterten Updates
            continue
        weg = None
        try:
            if alt.exists() or alt.is_symlink():
                weg = _beiseite(alt, GEDULD_KURZ_S)
            _geduldig(lambda: neu.rename(alt), GEDULD_KURZ_S)
            getauscht = True
        except OSError:
            if weg is not None and not alt.exists():
                try:
                    weg.rename(alt)
                except OSError:
                    pass
    try:
        if (ordner / SELBST_EXE).is_file():
            for name in AUSGEMUSTERT:
                _loeschen(ordner / name)
    except OSError:
        pass
    aufraeumen(ordner)
    return getauscht


# --- Netz ---------------------------------------------------------------------

def _anfrage(url: str, methode: str = "GET") -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": "SunderedSkies-Aktualisieren"}, method=methode)


def _tag_aus_adresse(adresse: str) -> str | None:
    """…/releases/tag/v2.0.4  ->  "v2.0.4" (sonst None)."""
    m = re.search(r"/releases/tag/([^/?#]+)", adresse)
    return urllib.parse.unquote(m.group(1)) if m else None


def _neueste_ueber_link() -> tuple[str, str, int]:
    """Über den normalen Release-Link statt über die GitHub-API: die API
    erlaubt ohne Anmeldung nur 60 Abfragen pro Stunde je Internetanschluss
    („HTTP Error 403: rate limit exceeded“, Kalle 09.11.2026). Der Link
    …/releases/latest leitet auf …/releases/tag/vX weiter, der Download liegt
    unter …/releases/download/vX/<Zip> – beides ohne dieses Limit."""
    with urllib.request.urlopen(_anfrage(f"https://github.com/{REPO}/releases/latest", "HEAD"), timeout=20) as r:
        tag = _tag_aus_adresse(r.geturl())
    if not tag:
        raise RuntimeError("Kein Release gefunden.")
    url = f"https://github.com/{REPO}/releases/download/{tag}/{ZIP_NAME}"
    try:
        with urllib.request.urlopen(_anfrage(url, "HEAD"), timeout=20) as r:
            groesse = int(r.headers.get("Content-Length") or 0)
    except urllib.error.HTTPError as fehler:
        if fehler.code == 404:
            raise RuntimeError(f"Im neuesten Release fehlt {ZIP_NAME}.") from fehler
        raise
    return tag.lstrip("v"), url, groesse


def _neueste_ueber_api() -> tuple[str, str, int]:
    with urllib.request.urlopen(_anfrage(f"https://api.github.com/repos/{REPO}/releases/latest"), timeout=20) as r:
        info = json.load(r)
    zip_ = next((a for a in info.get("assets", []) if a.get("name") == ZIP_NAME), None)
    if not zip_:
        raise RuntimeError(f"Im neuesten Release fehlt {ZIP_NAME}.")
    return info.get("tag_name", "").lstrip("v"), zip_["browser_download_url"], int(zip_.get("size") or 0)


def neueste_version() -> tuple[str, str, int]:
    """(Version, Download-Adresse, Größe) des neuesten Releases. Erst über den
    Release-Link (kein Abfrage-Limit), nur wenn das scheitert über die API."""
    try:
        return _neueste_ueber_link()
    except Exception as fehler_link:
        try:
            return _neueste_ueber_api()
        except Exception:
            raise fehler_link


def fortschritt_balken(geladen: int, groesse: int, breite: int = 30, zeichen: str = "█░") -> str:
    """Eine Zeile wie  [██████████░░░░░░░░░░]  52 %   13,4 / 25,9 MB"""
    anteil = min(1.0, geladen / groesse) if groesse else 0.0
    voll = round(anteil * breite)
    mb = lambda n: f"{n / 1024 / 1024:.1f}".replace(".", ",")
    return f"  [{zeichen[0] * voll}{zeichen[1] * (breite - voll)}] {round(anteil * 100):3d} %   {mb(geladen)} / {mb(groesse)} MB"


def herunterladen(url: str, ziel: Path, groesse: int) -> None:
    # Ein Balken, der sich in DERSELBEN Zeile füllt (\r) - statt zehn Zeilen
    # „… 10 %", „… 20 %" (Stefan: sieht besser aus). Ohne echtes Konsolenfenster
    # (umgeleitete Ausgabe, Tests) nur ab und zu eine Zeile, sonst Zeichenmüll.
    fenster = sys.stdout.isatty()
    with urllib.request.urlopen(_anfrage(url), timeout=60) as r, open(ziel, "wb") as f:
        groesse = groesse or int(r.headers.get("Content-Length") or 0)
        geladen, zuletzt, zuletzt_zeit = 0, -1, 0.0
        while True:
            stueck = r.read(128 * 1024)
            if not stueck:
                break
            f.write(stueck)
            geladen += len(stueck)
            if not groesse:
                continue
            if fenster:
                jetzt = time.monotonic()
                if jetzt - zuletzt_zeit > 0.08 or geladen >= groesse:
                    zuletzt_zeit = jetzt
                    print("\r" + fortschritt_balken(geladen, groesse), end="", flush=True)
            else:
                zehntel = min(10, geladen * 10 // groesse)
                if zehntel != zuletzt:
                    zuletzt = zehntel
                    # Umgeleitet schreibt Windows in cp1252 - dort gibt es █/░ nicht.
                    print(fortschritt_balken(geladen, groesse, zeichen="#-"), flush=True)
        if fenster and groesse:
            print("\r" + fortschritt_balken(groesse, groesse), flush=True)


# --- Ablauf -------------------------------------------------------------------

def _ende(code: int) -> None:
    print()
    if not os.environ.get("SWS_OHNE_PAUSE"):          # (Tests)
        try:
            input("Enter drücken zum Schließen … ")
        except EOFError:
            pass
    sys.exit(code)


def main() -> None:
    # Nie an einem Zeichen scheitern, das die Konsole nicht kennt.
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    ordner = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path.cwd()
    print("============================================")
    print("  Sundered Skies – Initiative: Aktualisieren")
    print("============================================")
    print()
    if not (ordner / APP_EXE).is_file():
        print(f"Hier liegt keine {APP_EXE} – Aktualisieren.exe gehört in den App-Ordner.")
        _ende(1)

    lokal = version_aus_starthier(ordner)
    try:
        neu, url, groesse = neueste_version()
    except Exception as fehler:  # kein Netz, GitHub down, Proxy …
        print("Keine Verbindung zu GitHub. Ist der Laptop im Internet?")
        print(f"({fehler})")
        _ende(1)
    print(f"Installiert: {lokal or 'unbekannt'}")
    print(f"Neueste:     {neu}")
    print()
    if not ist_neuer(neu, lokal):
        print("Du hast schon die neueste Version. Nichts zu tun.")
        _ende(0)

    if app_laeuft(ordner):
        print("Die App läuft noch. Sie muss zum Aktualisieren kurz beendet werden.")
        # Nur den ersten Buchstaben werten - unsichtbare Zeichen (BOM aus
        # umgeleiteter Eingabe, Leerzeichen) dürfen kein „Nein" erzeugen.
        antwort = re.sub(r"[^a-z]", "", input("Jetzt beenden? (j/n) ").lower())
        if not antwort.startswith(("j", "y")):
            print("Abgebrochen – nichts geändert.")
            _ende(1)
        subprocess.run(["taskkill", "/F", "/IM", APP_EXE], capture_output=True)
        for _ in range(20):
            time.sleep(0.5)
            if not app_laeuft(ordner):
                break

    # ignore_cleanup_errors: ein Virenscanner, der noch im Download liest, darf
    # nach geglücktem Austausch keinen „Fehler" mehr erzeugen.
    with tempfile.TemporaryDirectory(prefix="sws-update-", ignore_cleanup_errors=True) as tmp:
        tmp = Path(tmp)
        datei = tmp / "app.zip"
        try:
            print(f"Lade Version {neu} herunter" + (f" ({round(groesse / 1024 / 1024)} MB)" if groesse else "") + " …")
            herunterladen(url, datei, groesse)
            print("Entpacke …")
            with zipfile.ZipFile(datei) as z:
                z.extractall(tmp / "neu")
            quelle = next((p.parent for p in (tmp / "neu").rglob(APP_EXE)), None)
            if quelle is None:
                raise RuntimeError(f"Im Download fehlt {APP_EXE}.")
            print("Tausche Programmdateien aus (data bleibt) …")
            austauschen(quelle, ordner)
        except AustauschFehler as fehler:
            print()
            print(f"FEHLER: {fehler}")
            if fehler.alt_heil:
                print(f"Nichts kaputt – Version {lokal or 'bisher'} startet wie gewohnt.")
            print()
            print("Meist sperrt OneDrive (synchronisiert gerade) oder ein Virenscanner die")
            print("Dateien. Ein paar Minuten warten oder OneDrive kurz anhalten (Wolke unten")
            print("rechts > Synchronisierung anhalten) und Aktualisieren.exe nochmal starten.")
            if not fehler.alt_heil:
                print("Falls die App nicht startet: neueste SunderedSkies-App.zip von")
                print(f"https://github.com/{REPO}/releases/latest holen und den Ordner data hineinkopieren.")
            _ende(1)
        except Exception as fehler:
            print()
            print(f"FEHLER: {fehler}")
            print(f"Nichts geändert – Version {lokal or 'bisher'} startet wie gewohnt.")
            print("Falls die App jetzt nicht startet: neueste SunderedSkies-App.zip von")
            print(f"https://github.com/{REPO}/releases/latest holen und den Ordner data hineinkopieren.")
            _ende(1)

    print()
    print(f"Fertig – jetzt Version {neu}. Starten wie immer mit START.bat")
    print(f"oder {APP_EXE}.")
    _ende(0)


if __name__ == "__main__":
    main()
