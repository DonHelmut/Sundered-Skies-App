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


# --- Netz-Waechter: der blinde Fleck des Protokolls -------------------------
# Reisst das WLAN am Laptop ab, kommt bei den Handys nichts mehr an - und im
# Log stand bisher gar nichts, weil dort nur ankommende Anfragen auftauchen.

from server import run as run_modul


def test_netz_weg_wird_gemeldet():
    z = {"bekannt": {"192.168.0.5"}, "weg_seit": None}
    zeilen = run_modul.netz_pruefen(z, set(), pause=20)
    assert any("NETZ WEG" in x for x in zeilen)
    assert z["weg_seit"] is not None


def test_netz_weg_meldet_nur_einmal_und_zaehlt_die_dauer():
    z = {"bekannt": {"192.168.0.5"}, "weg_seit": None}
    run_modul.netz_pruefen(z, set(), pause=20)
    weitere = run_modul.netz_pruefen(z, set(), pause=20)
    assert weitere == []                      # kein Log-Spam im Sekundentakt

    zurueck = run_modul.netz_pruefen(z, {"192.168.0.5"}, pause=20)
    assert any("NETZ ZURUECK nach 40 s" in x for x in zurueck)
    assert z["weg_seit"] is None


def test_adresswechsel_wird_gemeldet():
    z = {"bekannt": {"192.168.0.5"}, "weg_seit": None}
    zeilen = run_modul.netz_pruefen(z, {"192.168.0.99"}, pause=20)
    assert any("ADRESSWECHSEL" in x for x in zeilen)
    assert z["adresswechsel"] == ["192.168.0.99"]


def test_gleiche_adresse_meldet_nichts():
    z = {"bekannt": {"192.168.0.5"}, "weg_seit": None}
    assert run_modul.netz_pruefen(z, {"192.168.0.5"}, pause=20) == []


def test_zeitsprung_wird_gemeldet():
    """Standby oder eingefrorenes Fenster: fuer die Handys war die App weg."""
    z = {"bekannt": {"192.168.0.5"}, "weg_seit": None}
    zeilen = run_modul.netz_pruefen(z, {"192.168.0.5"}, pause=600)
    assert any("ZEITSPRUNG" in x and "10.0 min" in x for x in zeilen)
