"""WLAN-Erkennung des Laptops (Netz, Band, Wi-Fi-Standard) aus `netsh`.

Die netsh-Ausgabe ist uebersetzt - beide Sprachen muessen gehen. Die deutsche
Vorlage ist eine echte Ausgabe (Netzname ersetzt)."""
from server import winnet as W

DEUTSCH = """
Es ist 1 Schnittstelle auf dem System vorhanden:

    Name                   : WLAN
    Beschreibung            : Intel(R) Wi-Fi 6 AX101
    GUID                   : 97be9a66-2042-4da1-88cf-8d1d48e51383
    Physische Adresse       : 90:10:57:81:1b:3b
    Benutzeroberflächentyp         : Primär
    Status                  : Verbunden
    SSID                   : Hauptnetz
    AP BSSID               : 3c:7c:3f:31:22:ac
    Bereich                   : 5 GHz
    Kanal                : 108
    Netzwerktyp            : Infrastruktur
    Funktyp                   : 802.11ac
    Authentifizierung   : WPA2-Personal
    Verbindungsmodus        : Profil
    Empfangsrate (MBit/s)  : 263.3
    Übertragungsrate (MBit/s) : 390
    Signal              : 81%
    RSSI                   : -61
    Profil                 : Hauptnetz
"""

ENGLISCH = """
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX201 160MHz
    Physical address       : 90:10:57:81:1b:3b
    State                  : connected
    SSID                   : Home Net
    AP BSSID               : 3c:7c:3f:31:22:aa
    Band                   : 2.4 GHz
    Channel                : 5
    Radio type             : 802.11n
    Receive rate (Mbps)    : 72.2
    Transmit rate (Mbps)   : 72.2
    Signal                 : 90%
    Profile                : Home Net
"""


def test_deutsches_windows():
    w = W.wlan_aus_netsh(DEUTSCH)
    assert w == {"ssid": "Hauptnetz", "band": "5 GHz", "kanal": 108,
                 "funktyp": "802.11ac", "standard": "Wi-Fi 5",
                 "empfang": 263, "senden": 390, "signal": 81}


def test_englisches_windows_und_24_ghz_deutsch_geschrieben():
    w = W.wlan_aus_netsh(ENGLISCH)
    assert w["ssid"] == "Home Net"
    assert w["band"] == "2,4 GHz"          # einheitlich mit Komma
    assert w["standard"] == "Wi-Fi 4"
    assert (w["kanal"], w["empfang"], w["senden"], w["signal"]) == (5, 72, 72, 90)


def test_verstuemmeltes_ue_wird_trotzdem_erkannt():
    # Falsche Codepage: "Ü" kommt als "Ã\x9c" an - der Wortrest reicht.
    w = W.wlan_aus_netsh(DEUTSCH.replace("Übertragungsrate", "Ã\x9cbertragungsrate"))
    assert w["senden"] == 390


def test_ap_bssid_und_profil_verdraengen_die_ssid_nicht():
    w = W.wlan_aus_netsh(DEUTSCH.replace("Profil                 : Hauptnetz",
                                         "Profil                 : Anderes"))
    assert w["ssid"] == "Hauptnetz"


def test_nicht_verbunden_ergibt_none():
    assert W.wlan_aus_netsh(DEUTSCH.replace(": Verbunden", ": Getrennt")) is None
    assert W.wlan_aus_netsh(ENGLISCH.replace(": connected", ": disconnected")) is None
    assert W.wlan_aus_netsh("") is None
    assert W.wlan_aus_netsh("Der Dienst \"WLAN-AutoConfig\" wird nicht ausgeführt.") is None


def test_aelteres_windows_ohne_bandzeile_leitet_band_vom_kanal_ab():
    ohne = "\n".join(z for z in DEUTSCH.splitlines() if "Bereich" not in z)
    assert W.wlan_aus_netsh(ohne)["band"] == "5 GHz"
    ohne24 = "\n".join(z for z in ENGLISCH.splitlines() if "Band" not in z)
    assert W.wlan_aus_netsh(ohne24)["band"] == "2,4 GHz"


def test_wifi_generationen():
    def standard(funktyp, band="5 GHz"):
        text = DEUTSCH.replace("802.11ac", funktyp).replace("Bereich                   : 5 GHz",
                                                             f"Bereich                   : {band}")
        return W.wlan_aus_netsh(text)["standard"]
    assert standard("802.11n") == "Wi-Fi 4"
    assert standard("802.11ac") == "Wi-Fi 5"
    assert standard("802.11ax") == "Wi-Fi 6"
    assert standard("802.11ax", "6 GHz") == "Wi-Fi 6E"
    assert standard("802.11be") == "Wi-Fi 7"
    assert standard("802.11g") == "802.11g"     # Aelteres bleibt beim Namen


def test_logzeile():
    assert W.wlan_text(W.wlan_aus_netsh(DEUTSCH)) == (
        "Hauptnetz · 5 GHz · Wi-Fi 5 (802.11ac) · Kanal 108 · 263/390 MBit/s · Signal 81 %")
    assert "nicht per WLAN" in W.wlan_text(None)


def test_wechsel_nur_bei_anderem_netz_band_oder_standard():
    a = W.wlan_aus_netsh(DEUTSCH)
    schwankt = dict(a, empfang=120, signal=60)          # Rate/Signal allein: kein Wechsel
    assert W.wlan_wechsel(a, schwankt) is None
    b = W.wlan_aus_netsh(ENGLISCH)
    assert W.wlan_wechsel(a, b).startswith("WLAN: Home Net · 2,4 GHz · Wi-Fi 4")
    assert W.wlan_wechsel(a, None).startswith("WLAN: nicht per WLAN")
    assert W.wlan_wechsel(None, None) is None
