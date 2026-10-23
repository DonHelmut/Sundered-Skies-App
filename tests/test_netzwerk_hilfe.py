"""Netzwerk-Skripte im Paket (paket/Netzwerk-Hilfe). Laufen nur unter Windows -
hier wird geprueft, was sich ohne Windows pruefen laesst: dass sie zur App
passen. Anlass: Das alte WLAN-Skript war monatelang kaputt (PowerShell-
Syntaxfehler), ohne dass es jemand gemerkt hat."""
import re
from pathlib import Path

import aktualisieren
from server import winnet
from server.paths import PORT_CANDIDATES

ORDNER = Path(__file__).resolve().parent.parent / "paket" / "Netzwerk-Hilfe"
PS1 = ORDNER / "netzwerk-hilfe.ps1"


def test_ports_und_regelname_wie_in_der_app():
    # Sonst gibt das Skript andere Ports frei als die App benutzt, oder der
    # Knopf in der App und "rueckgaengig" finden die Regel des anderen nicht.
    text = PS1.read_text(encoding="ascii")
    ports = re.search(r"^\$Ports = @\(([^)]*)\)", text, re.M).group(1)
    assert [int(p) for p in ports.split(",")] == PORT_CANDIDATES
    assert f"$RegelName = '{winnet.FIREWALL_RULE_NAME}'" in text


def test_nur_ascii():
    # PowerShell 5.1 liest .ps1 ohne BOM als ANSI, cmd die .bat in der OEM-Codepage.
    for datei in ORDNER.iterdir():
        datei.read_bytes().decode("ascii")


def test_jede_bat_ruft_eine_vorhandene_aktion():
    erlaubt = re.search(r"ValidateSet\(([^)]*)\)", PS1.read_text()).group(1)
    bats = sorted(ORDNER.glob("*.bat"))
    assert len(bats) == 4
    for bat in bats:
        roh = bat.read_bytes()
        assert b"\r\n" in roh and b"\n" not in roh.replace(b"\r\n", b"")   # cmd braucht CRLF
        aktion = re.search(r"-Aktion (\w+)", roh.decode()).group(1)
        assert f"'{aktion}'" in erlaubt


def test_alte_skripte_im_hauptordner_werden_aufgeraeumt():
    for name in ("Firewall-freigeben.bat", "Firewall-sperren.bat", "WLAN-Stromsparen-aus.bat"):
        assert name in aktualisieren.AUSGEMUSTERT
