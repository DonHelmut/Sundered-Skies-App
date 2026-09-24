"""Windows-Netzwerk-Helfer: erkennt ein „öffentliches" WLAN (Windows blockt dann
eingehend) und gibt die Firewall auf Port 8000 frei (per UAC-Abfrage).

Alles best-effort und Windows-only – auf anderen Systemen passiert nichts, und
jeder Fehler wird geschluckt (darf das Spiel nie stören)."""
from __future__ import annotations

import os
import subprocess
import time

FIREWALL_RULE_NAME = "Sundered Skies Initiative"
# ALLE moeglichen Ports freigeben - die App kann auf einen Ausweich-Port gehen,
# wenn 8000 von einem anderen Programm belegt ist (siehe paths.PORT_CANDIDATES).
from .paths import PORT_CANDIDATES
PORT = PORT_CANDIDATES[0]
PORT_LIST = ",".join(str(p) for p in PORT_CANDIDATES)
_NO_WINDOW = 0x08000000   # CREATE_NO_WINDOW – kein aufblitzendes Konsolenfenster

_public: bool | None = None   # None = unbekannt, True = öffentlich, False = privat


def _is_windows() -> bool:
    return os.name == "nt"


def _compute_public() -> bool | None:
    if not _is_windows():
        return None
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-NetConnectionProfile).NetworkCategory"],
            capture_output=True, text=True, timeout=6, creationflags=_NO_WINDOW,
        ).stdout
    except Exception:
        return None
    cats = [ln.strip().lower() for ln in out.splitlines() if ln.strip()]
    if not cats:
        return None
    return any(c == "public" for c in cats)


def detect_public() -> bool | None:
    """Einmalig beim Start aufrufen (blockiert ~0,3 s)."""
    global _public
    _public = _compute_public()
    return _public


def is_public() -> bool | None:
    return _public


def rule_active() -> bool | None:
    """Existiert unsere Firewall-Regel wirklich? (Nur lesen, keine Aenderung.)
    None = unbekannt/kein Windows."""
    if not _is_windows():
        return None
    try:
        r = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule",
             f"name={FIREWALL_RULE_NAME}"],
            capture_output=True, text=True, timeout=6, creationflags=_NO_WINDOW)
        return r.returncode == 0 and FIREWALL_RULE_NAME in (r.stdout or "")
    except Exception:
        return None


def allow_firewall() -> bool:
    """Legt die eingehende Firewall-Regel für Port 8000 an – per ERHÖHTEM Prozess
    (UAC-Abfrage beim SL). True, wenn die Elevation gestartet wurde."""
    if not _is_windows():
        return False
    try:
        import ctypes
        params = (
            f'/c netsh advfirewall firewall delete rule name="{FIREWALL_RULE_NAME}" >nul 2>&1 '
            f'& netsh advfirewall firewall add rule name="{FIREWALL_RULE_NAME}" '
            f'dir=in action=allow protocol=TCP localport={PORT_LIST}'
        )
        rc = ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", params, None, 0)
        ok = int(rc) > 32   # >32 = Prozess gestartet (UAC bestätigt)
        if ok:
            detect_public()   # Status neu erfassen
        return ok
    except Exception:
        return False


def ist_admin() -> bool | None:
    """Hat der Nutzer Administratorrechte? Ohne die laesst sich KEINE
    Firewall-Regel anlegen - auf Firmen-Laptops der Normalfall."""
    if not _is_windows():
        return None
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return None


# Eine einzige PowerShell-Abfrage fuer alles, was auf einem verwalteten Laptop
# den Zugriff blockieren kann. Jede Teilabfrage einzeln abgesichert - fehlende
# Rechte oder abgeschaltete Dienste duerfen den Rest nicht mitreissen.
_BERICHT_PS = r"""
try { Write-Output ('NETZWERKPROFIL: ' + (((Get-NetConnectionProfile) | ForEach-Object { $_.Name + ' = ' + $_.NetworkCategory }) -join ' | ')) } catch { Write-Output 'NETZWERKPROFIL: unbekannt' }
try { $f = (Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction Stop | ForEach-Object { $_.displayName }) -join ', '; if (-not $f) { $f = 'nur Windows-Firewall' }; Write-Output ('FIREWALL-PRODUKT: ' + $f) } catch { Write-Output 'FIREWALL-PRODUKT: nicht abfragbar' }
try { $a = (Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | ForEach-Object { $_.displayName }) -join ', '; Write-Output ('VIRENSCANNER: ' + $a) } catch { Write-Output 'VIRENSCANNER: nicht abfragbar' }
try { Write-Output ('FIRMEN-DOMAENE: ' + (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).PartOfDomain) } catch { Write-Output 'FIRMEN-DOMAENE: unbekannt' }
try { $v = (Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'VPN|TAP|WireGuard|AnyConnect|GlobalProtect|Zscaler|Netskope|Pulse|Forti') } | ForEach-Object { $_.InterfaceDescription }) -join ', '; if (-not $v) { $v = 'keiner aktiv' }; Write-Output ('VPN-ADAPTER: ' + $v) } catch { Write-Output 'VPN-ADAPTER: unbekannt' }
"""


def umgebungsbericht() -> list[str]:
    """Was auf DIESEM Rechner ueber den Netzzugriff bestimmt. Rein lesend.

    Dauert ein paar Sekunden (mehrere WMI-Abfragen) - deshalb im Hintergrund
    aufrufen, nie im Startpfad."""
    zeilen: list[str] = []
    admin = ist_admin()
    zeilen.append(f"ADMINRECHTE: {admin}")
    if not _is_windows():
        return zeilen
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive",
                            "-ExecutionPolicy", "Bypass", "-Command", _BERICHT_PS],
                           capture_output=True, text=True, timeout=30,
                           creationflags=_NO_WINDOW)
        zeilen += [z.strip() for z in (r.stdout or "").splitlines() if z.strip()]
    except Exception as exc:
        zeilen.append(f"UMGEBUNGSBERICHT nicht moeglich: {exc}")
    return zeilen


# --- Welches WLAN nutzt der Laptop gerade? -----------------------------------
# Anlass: Bei einem Gastgeber kamen Spieler "manchmal" nicht rein. Der Laptop
# hing im Zusatznetz "Bengals!" (nur 2,4 GHz, Wi-Fi 4, 72 MBit/s), die iPhones
# je nach Empfang im Hauptnetz "Regelanto!" (5 GHz) - zwei WLANs aus demselben
# Geraet. Diese Angabe macht so etwas beim SL und im Log sichtbar.
#
# Quelle ist `netsh wlan show interfaces`. Die Ausgabe ist UEBERSETZT: deutsch
# heisst das Band "Bereich", englisch "Band"; Kanal/Channel, Funktyp/Radio type.
# Das Ue in "Uebertragungsrate" haengt an der Kodierung - darum Wortrest-Vergleich.
# Unbekannte Sprache oder LAN-Kabel -> was sich erkennen laesst, sonst None.

_WLAN_FELDER = (
    ("ssid", lambda k: k == "ssid"),
    ("status", lambda k: k in ("status", "state")),
    ("band", lambda k: k in ("bereich", "band")),
    ("kanal", lambda k: k in ("kanal", "channel")),
    ("funktyp", lambda k: k in ("funktyp", "radio type")),
    ("empfang", lambda k: k.startswith(("empfangsrate", "receive rate"))),
    ("senden", lambda k: "bertragungsrate" in k or k.startswith("transmit rate")),
    ("signal", lambda k: k == "signal"),
)
_WLAN_STANDARD = {"802.11be": "Wi-Fi 7", "802.11ax": "Wi-Fi 6", "802.11ac": "Wi-Fi 5",
                  "802.11n": "Wi-Fi 4"}


def _zahl(text: str | None) -> int | None:
    try:
        return round(float((text or "").replace("%", "").replace(",", ".").strip()))
    except ValueError:
        return None


def wlan_aus_netsh(text: str) -> dict | None:
    """Liest die erste Schnittstelle aus `netsh wlan show interfaces`. Rein
    rechnend (testbar ohne WLAN). None = nicht per WLAN verbunden/nicht lesbar."""
    roh: dict[str, str] = {}
    for zeile in (text or "").splitlines():
        schluessel, trenner, wert = zeile.partition(":")
        if not trenner:
            continue
        k = schluessel.strip().lower()
        for feld, passt in _WLAN_FELDER:
            if feld not in roh and passt(k):
                roh[feld] = wert.strip()
                break
    status = roh.get("status", "").lower()
    if not roh.get("ssid") or (status and status not in ("verbunden", "connected")):
        return None

    kanal = _zahl(roh.get("kanal"))
    band = roh.get("band", "").replace("2.4", "2,4")
    if not band and kanal:
        band = "2,4 GHz" if kanal <= 14 else "5 GHz"     # aeltere Windows ohne Band-Zeile
    funktyp = roh.get("funktyp", "")
    standard = _WLAN_STANDARD.get(funktyp, funktyp)
    if standard == "Wi-Fi 6" and band.startswith("6"):
        standard = "Wi-Fi 6E"
    return {
        "ssid": roh["ssid"], "band": band, "kanal": kanal,
        "funktyp": funktyp, "standard": standard,
        "empfang": _zahl(roh.get("empfang")), "senden": _zahl(roh.get("senden")),
        "signal": _zahl(roh.get("signal")),
    }


_wlan_puffer: dict = {"zeit": -1e9, "wert": None}


def wlan_info(max_alter: float = 15.0) -> dict | None:
    """Aktuelles WLAN des Laptops. Kurz gepuffert: /api/info fragen alle Handys
    regelmaessig ab - netsh soll nicht bei jedem Aufruf neu starten."""
    if not _is_windows():
        return None
    jetzt = time.monotonic()
    if jetzt - _wlan_puffer["zeit"] < max_alter:
        return _wlan_puffer["wert"]
    try:
        roh = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True,
                             timeout=5, creationflags=_NO_WINDOW).stdout
        # netsh schreibt in der Windows-ANSI-Codepage ("mbcs"), nicht in der OEM-
        # Konsolen-Codepage - mit "oem" kaeme "Uebertragungsrate" verstuemmelt an.
        wert = wlan_aus_netsh(roh.decode("mbcs", errors="replace"))
    except Exception:
        wert = None
    _wlan_puffer.update(zeit=jetzt, wert=wert)
    return wert


def wlan_text(w: dict | None) -> str:
    """Eine Zeile fuers Log, z. B. „Heimnetz · 5 GHz · Wi-Fi 5 (802.11ac) ·
    Kanal 36 · 351/390 MBit/s · Signal 82 %"."""
    if not w:
        return "nicht per WLAN verbunden (LAN-Kabel?) oder nicht lesbar"
    teile = [w["ssid"], w.get("band") or ""]
    if w.get("standard"):
        teile.append(w["standard"] + (f" ({w['funktyp']})" if w.get("funktyp") and w["funktyp"] != w["standard"] else ""))
    if w.get("kanal"):
        teile.append(f"Kanal {w['kanal']}")
    if w.get("empfang") or w.get("senden"):
        teile.append(f"{w.get('empfang') or '?'}/{w.get('senden') or '?'} MBit/s")
    if w.get("signal") is not None:
        teile.append(f"Signal {w['signal']} %")
    return " · ".join(t for t in teile if t)


def wlan_wechsel(vorher: dict | None, jetzt: dict | None) -> str | None:
    """Logzeile, wenn der Laptop in ein anderes WLAN/Band/Standard wechselt
    (Rate und Signal schwanken staendig - die allein sind kein Wechsel)."""
    def kern(w):
        return (w.get("ssid"), w.get("band"), w.get("standard")) if w else None
    if kern(vorher) == kern(jetzt):
        return None
    return "WLAN: " + wlan_text(jetzt)
