"""Helfer für den Release-Workflow (.github/workflows/release.yml).

Drei Schritte, jeweils als eigener Aufruf, damit man im Actions-Log sieht,
woran es hängt:

  python .github/release/release.py pruefen   Version überall gleich? RELEASE.md passt?
  python .github/release/release.py paket     dist/… zu SunderedSkies-App.zip packen
  python .github/release/release.py rauch     gepackte App starten, /api/info fragen

Vorher lief das alles von Hand auf dem Jonsbo (Skripte im Scratchpad). Seit
2.0.25 macht es GitHub nach jedem Merge auf main, damit Kalle nicht mehr für
jedes Release „go“ schreiben muss: der Merge des PRs ist die Freigabe.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
PAKET = DIST / "paket" / "SunderedSkies-App"
ZIP = DIST / "paket" / "SunderedSkies-App.zip"


def _ausgabe(**werte):
    """Werte an spätere Workflow-Schritte weiterreichen (GITHUB_OUTPUT)."""
    ziel = os.environ.get("GITHUB_OUTPUT")
    for k, v in werte.items():
        print(f"{k} = {v}")
        if ziel:
            with open(ziel, "a", encoding="utf-8") as f:
                f.write(f"{k}={v}\n")


def version():
    text = (ROOT / "server" / "paths.py").read_text(encoding="utf-8")
    return re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', text, re.M).group(1)


def pruefen():
    """Bricht ab, wenn eine der Versionsstellen vergessen wurde.

    Sonst käme ein Release heraus, bei dem der Browser alte Dateien aus dem
    Cache nimmt (?v= nicht gezählt) oder der Updater es nie anbietet
    (START-HIER.txt nicht gezählt) – beides ist früher schon passiert.
    """
    v = version()
    fehler = []
    app_js = (ROOT / "web/static/app.js").read_text(encoding="utf-8")
    m = re.search(r'ASSET_VERSION\s*=\s*"([^"]+)"', app_js)
    if not m or m.group(1) != v:
        fehler.append(f"web/static/app.js ASSET_VERSION ist {m and m.group(1)!r}, nicht {v!r}")
    for html in ("web/index.html", "web/tv.html"):
        andere = set(re.findall(r"\?v=([0-9.]+)", (ROOT / html).read_text(encoding="utf-8"))) - {v}
        if andere:
            fehler.append(f"{html}: ?v= steht noch auf {sorted(andere)}")
    erste = (ROOT / "paket/START-HIER.txt").read_text(encoding="utf-8").splitlines()[0]
    if f"(Version {v})" not in erste:
        fehler.append(f"paket/START-HIER.txt erste Zeile passt nicht: {erste!r}")

    # RELEASE.md: erste Zeile „# <version> – <was gemacht wurde>“, Rest = Notizen.
    # Die Version vorn verhindert, dass ein vergessenes RELEASE.md den Titel
    # des letzten Releases wiederverwendet.
    zeilen = (ROOT / "RELEASE.md").read_text(encoding="utf-8").splitlines()
    kopf = re.match(r"#\s*(\S+)\s+[–-]\s+(.+)", zeilen[0] if zeilen else "")
    if not kopf:
        fehler.append("RELEASE.md: erste Zeile muss „# X.Y.Z – Titel“ sein")
    elif kopf.group(1) != v:
        fehler.append(f"RELEASE.md ist für {kopf.group(1)}, die App hat aber {v}")
    if fehler:
        print("Version nicht stimmig:\n  " + "\n  ".join(fehler))
        sys.exit(1)
    notizen = DIST / "notes.md"
    DIST.mkdir(exist_ok=True)
    notizen.write_text("\n".join(zeilen[1:]).strip() + "\n", encoding="utf-8")
    _ausgabe(version=v, tag=f"v{v}",
             titel=f"Sundered Skies Initiative {v} – {kopf.group(2).strip()}")


def paket():
    """Gleicher Aufbau wie bisher von Hand (paket/LIESMICH-ENTWICKLER.txt)."""
    if PAKET.parent.exists():
        shutil.rmtree(PAKET.parent)
    shutil.copytree(DIST / "SunderedSkies-Ordnerversion", PAKET)
    shutil.copytree(DIST / "Aktualisieren", PAKET, dirs_exist_ok=True)
    for n in (ROOT / "paket").iterdir():
        if n.name == "LIESMICH-ENTWICKLER.txt":
            continue
        if n.is_dir():
            shutil.copytree(n, PAKET / n.name)
        else:
            shutil.copy2(n, PAKET)
    # Nur Datei-Einträge: make_archive schreibt zusätzlich Ordner-Einträge,
    # Pfade mit / (PowerShell-Compress-Archive schreibt Backslashes).
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for datei in sorted(PAKET.rglob("*")):
            if datei.is_file():
                zf.write(datei, datei.relative_to(PAKET.parent).as_posix())
    print(sorted(p.name for p in PAKET.iterdir()), ZIP.stat().st_size // 1048576, "MB")


def rauch():
    """Gepackte App aus dem Zip starten und fragen, ob die richtige Version läuft."""
    v = version()
    tmp = Path(tempfile.mkdtemp(prefix="rauch-"))
    with zipfile.ZipFile(ZIP) as zf:
        zf.extractall(tmp)
    app = tmp / "SunderedSkies-App"
    data = tmp / "data"
    data.mkdir()
    env = dict(os.environ, SWI_NO_BROWSER="1", SWI_DATA_DIR=str(data))
    p = subprocess.Popen([str(app / "SunderedSkiesInitiative.exe")], cwd=app, env=env,
                         stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        p.stdin.write(b"z\n")
        p.stdin.flush()
    except OSError:
        pass
    info = None
    log = data / "log.txt"
    try:
        for _ in range(90):
            time.sleep(1)
            # Den Port aus dem eigenen log.txt lesen statt 8000 zu raten: läuft
            # nebenbei schon eine App (Kalles echte am Jonsbo), weicht die Test-
            # App aus, und auf 8000 würde die FALSCHE antworten.
            m = log.exists() and re.search(r"primaer=[^ ]*:(\d+)", log.read_text(encoding="utf-8", errors="replace"))
            for port in ([int(m.group(1))] if m else []):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/info", timeout=2) as r:
                        info = json.load(r)
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as r:
                        seite = r.read().decode("utf-8", "replace")
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/static/app.js?v={v}", timeout=5) as r:
                        js = r.read().decode("utf-8", "replace")
                    break
                except Exception:
                    info = None
            if info:
                break
    finally:
        subprocess.run(["taskkill", "/PID", str(p.pid), "/F", "/T"], capture_output=True)
    if log.exists():
        print("log.txt:\n" + "\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[:8]))
    if not info:
        print("App antwortet nicht auf /api/info")
        sys.exit(1)
    print("api/info version:", info.get("version"))
    probleme = []
    if info.get("version") != v:
        probleme.append(f"App meldet {info.get('version')!r} statt {v!r}")
    if f"?v={v}" not in seite:
        probleme.append("Startseite lädt nicht die neuen ?v=-Dateien")
    if f'ASSET_VERSION = "{v}"' not in js:
        probleme.append("app.js in der exe hat nicht die neue ASSET_VERSION")
    if any((app / "_internal" / "web" / "static").glob("_lab*")):
        probleme.append("_lab*-Dateien sind im Paket gelandet")
    if probleme:
        print("Rauchtest:\n  " + "\n  ".join(probleme))
        sys.exit(1)
    print("Rauchtest ok")


if __name__ == "__main__":
    {"pruefen": pruefen, "paket": paket, "rauch": rauch}[sys.argv[1]]()
