"""Pfade & Basis-Konfig – funktioniert normal (python -m server.run) UND als
einzelne PyInstaller-.exe.

- RESOURCE_DIR: Nur-Lese-Ressourcen (das Web-Frontend). Im .exe-Bundle liegt das
  in ``sys._MEIPASS``.
- BASE_DIR: Ort mit Schreibrechten für ``data/`` (neben der .exe bzw. im Projekt).
"""

from __future__ import annotations

import ipaddress
import socket
import sys
from pathlib import Path

PORT = 8000            # Wunsch-Port
# Ausweich-Ports, falls 8000 von einem anderen Programm belegt ist.
PORT_CANDIDATES = [8000, 8001, 8010, 8080, 8088, 8123, 8765, 8899]
ACTIVE_PORT = PORT     # wird beim Start auf den tatsaechlich benutzten Port gesetzt
# Kurz halten - Spieler tippen ihn am Handy ab (früher "pen-and-paper", zu lang).
HOSTNAME = "pnp"


def active_port() -> int:
    """Port, auf dem der Server WIRKLICH laeuft (kann ein Ausweich-Port sein)."""
    return ACTIVE_PORT


def set_active_port(port: int) -> None:
    global ACTIVE_PORT
    ACTIVE_PORT = int(port)
APP_VERSION = "1.5.4"   # sichtbare Version (deckt sich mit ?v= der Web-Assets); ab 1.0 als 1.1, 1.2 …

# Adapter-Namen, die (fast) nie das echte Tisch-WLAN sind -> ans Ende sortieren.
_VIRTUAL_HINTS = (
    "virtualbox", "hyper-v", "vmware", "vethernet", "wi-fi direct", "wifi direct",
    "bluetooth", "loopback", "docker", "tailscale", "zerotier", "vpn", "tap-",
    "npcap", "wan miniport", "teredo", "isatap",
)


def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


if is_frozen():
    BASE_DIR = Path(sys.executable).resolve().parent
    RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", str(Path(sys.executable).resolve().parent)))
else:
    BASE_DIR = Path(__file__).resolve().parent.parent
    RESOURCE_DIR = Path(__file__).resolve().parent.parent


def _route_guess() -> str | None:
    """Beste Vermutung: welche Karte routet nach draußen? Unzuverlässig bei
    flackerndem Internet / mehreren Adaptern -> nur als Sortier-Hinweis nutzen."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # kein echter Traffic – nur Routing-Wahl
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def _is_lan_ipv4(ip: str) -> bool:
    """Private IPv4, die ein Handy im selben WLAN erreichen kann – ohne Loopback
    (127.x) und ohne APIPA/Link-Local (169.254.x, = 'kein DHCP bekommen')."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return (a.version == 4 and a.is_private
            and not a.is_loopback and not a.is_link_local)


def all_lan_ips() -> list[str]:
    """Vom LAN erreichbare IPv4-Adressen dieses Rechners – beste zuerst.

    Echte (physische) Adapter zuerst. Virtuelle (VirtualBox/Hyper-V/Bluetooth …)
    sind für Handys nutzlos und werden NUR gezeigt, wenn es gar keine echte gibt.
    Fällt NIE still auf 127.0.0.1."""
    real: list[str] = []
    virtual: list[str] = []
    try:
        import ifaddr
        for ad in ifaddr.get_adapters():
            name = (ad.nice_name or "").lower()
            is_virtual = any(h in name for h in _VIRTUAL_HINTS)
            for ip in ad.ips:
                if isinstance(ip.ip, str) and _is_lan_ipv4(ip.ip):
                    (virtual if is_virtual else real).append(ip.ip)
    except Exception:
        pass

    # Gibt es echte Adapter, bleiben die virtuellen (VM-Netze) außen vor.
    pool = real if real else virtual
    ordered: list[str] = []
    guess = _route_guess()
    if guess and guess in pool:
        ordered.append(guess)
    for ip in pool:
        if ip not in ordered:
            ordered.append(ip)
    return ordered


def local_ip() -> str:
    """Beste einzelne LAN-IP (für QR/Primär-URL). 127.0.0.1 nur als letzter
    Notnagel, wenn wirklich keine LAN-Adresse gefunden wird."""
    ips = all_lan_ips()
    if ips:
        return ips[0]
    return _route_guess() or "127.0.0.1"
