"""Windows-Netzwerk-Helfer: erkennt ein „öffentliches" WLAN (Windows blockt dann
eingehend) und gibt die Firewall auf Port 8000 frei (per UAC-Abfrage).

Alles best-effort und Windows-only – auf anderen Systemen passiert nichts, und
jeder Fehler wird geschluckt (darf das Spiel nie stören)."""
from __future__ import annotations

import os
import subprocess

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
