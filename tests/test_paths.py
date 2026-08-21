"""Netzwerk-/Adress-Erkennung – der Kern des v44-Fixes."""
import ipaddress

from server import paths as P


def test_is_lan_ipv4_accepts_typical_wlan():
    assert P._is_lan_ipv4("192.168.178.22") is True
    assert P._is_lan_ipv4("10.0.0.5") is True
    assert P._is_lan_ipv4("172.16.5.9") is True


def test_is_lan_ipv4_rejects_loopback_and_apipa():
    assert P._is_lan_ipv4("127.0.0.1") is False        # Loopback
    assert P._is_lan_ipv4("169.254.10.10") is False    # APIPA / Link-Local
    assert P._is_lan_ipv4("8.8.8.8") is False          # öffentlich
    assert P._is_lan_ipv4("nonsense") is False


def test_all_lan_ips_returns_valid_addresses_only():
    ips = P.all_lan_ips()
    assert isinstance(ips, list)
    for ip in ips:
        a = ipaddress.ip_address(ip)
        assert a.version == 4 and a.is_private
        assert not a.is_loopback and not a.is_link_local


def test_local_ip_never_returns_apipa_or_linklocal():
    ip = P.local_ip()
    a = ipaddress.ip_address(ip)
    # Erlaubt sind private LAN-Adressen; 127.0.0.1 nur als Notnagel (kein Netz).
    assert not a.is_link_local
    assert a.is_private or ip == "127.0.0.1"
