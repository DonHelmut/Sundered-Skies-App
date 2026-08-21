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
