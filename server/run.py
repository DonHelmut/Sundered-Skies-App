"""Start-Einstiegspunkt (auch der Entry-Point der gebündelten .exe).

- Ermittelt die LAN-IP, druckt QR-Code + Adresse im Terminal.
- Registriert best-effort den Namen ``pen-and-paper.local`` per mDNS.
- Öffnet die SL-Ansicht im Browser (localhost -> Loopback -> SL-Rolle).
- Startet den Uvicorn-Server mit dem App-Objekt (bundle-fest, kein Import-String).
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser

import qrcode
import uvicorn

from .paths import PORT, PORT_CANDIDATES, HOSTNAME, APP_VERSION, local_ip, all_lan_ips, active_port, set_active_port
from .app import app
from . import diag
from . import winnet


def print_banner(ip: str) -> None:
    url = f"http://{ip}:{active_port()}/"
    others = [x for x in all_lan_ips() if x != ip]
    print("\n" + "=" * 52)
    print(f"  Sundered Skies - Initiative laeuft!  (v{APP_VERSION})")
    print("=" * 52)
    print("\n  Spieler-Handys: diesen QR-Code scannen")
    print(f"  oder im Browser oeffnen:  {url}")
    if others:
        print("\n  Geht die obige Adresse nicht? Dann eine davon probieren")
        print("  (dieselbe muss auch beim WLAN des Handys passen):")
        for x in others:
            print(f"      http://{x}:{active_port()}/")
    if ip.startswith("127."):
        print("\n  ACHTUNG: keine LAN-Adresse gefunden (WLAN verbunden?).")
        print("  127.0.0.1 erreicht NUR diesen Laptop, keine Handys.")
    print(f"\n  (alternativ, falls verfuegbar:  http://{HOSTNAME}.local:{PORT}/)\n")
    # QR im Terminal ist nur Komfort. Schlaegt die Ausgabe fehl (Zeichensatz),
    # bleibt der Server trotzdem erreichbar - der QR steht auch in der SL-Ansicht.
    try:
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except Exception:
        print("  (QR-Code im Terminal nicht darstellbar - QR steht in der SL-Ansicht.)")
    print(f"\n  Spielleiter-Ansicht (dieser Laptop):  http://localhost:{PORT}/")
    print("  Zum Beenden dieses Fenster schliessen oder Strg+C.\n")


def register_mdns(ip: str):
    """Best-effort mDNS-Registrierung für den hübschen Namen. Schlägt das
    fehl (manche Netzwerke/Android), funktionieren IP + QR trotzdem."""
    try:
        from zeroconf import ServiceInfo, Zeroconf

        zc = Zeroconf()
        info = ServiceInfo(
            "_http._tcp.local.",
            f"{HOSTNAME}._http._tcp.local.",
            addresses=[socket.inet_aton(ip)],
            port=active_port(),
            server=f"{HOSTNAME}.local.",
        )
        zc.register_service(info)
        return zc
    except Exception as exc:  # pragma: no cover - rein optional
        print(f"  (Hinweis: mDNS-Name nicht verfügbar: {exc})")
        return None


def open_browser_later() -> None:
    if os.environ.get("SWI_NO_BROWSER"):
        return

    def _open():
        time.sleep(1.2)
        try:
            webbrowser.open(f"http://localhost:{active_port()}/")
        except Exception:
            pass

    threading.Thread(target=_open, daemon=True).start()


def _port_in_use(port: int) -> bool:
    """True, wenn Port bereits belegt ist (z. B. die App läuft schon)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("0.0.0.0", port))
        return False
    except OSError:
        return True
    finally:
        s.close()


def _is_our_app(port: int) -> bool:
    """Laeuft auf dem Port bereits DIESE App? (dann nicht ausweichen, sondern
    Bescheid sagen – zwei Server wuerden den Spielstand aufteilen)."""
    try:
        import json as _json
        import urllib.request
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/info", timeout=1.5) as r:
            data = _json.loads(r.read().decode("utf-8"))
        return isinstance(data, dict) and "prettyUrl" in data and "version" in data
    except Exception:
        return False


def _pick_port() -> int | None:
    """Erster freier Port aus der Kandidatenliste (8000 bevorzugt)."""
    for p in PORT_CANDIDATES:
        if not _port_in_use(p):
            return p
    return None


def _already_running(running_port: int) -> str:
    """Die App laeuft schon. Der Nutzer entscheidet: laufende oeffnen (Normalfall)
    oder trotzdem eine zweite Kopie auf einem Ausweich-Port starten.
    Rueckgabe: "zweite" oder "oeffnen"."""
    url = f"http://localhost:{running_port}/"
    print()
    print("=" * 52)
    print("  Sundered Skies laeuft bereits.")
    print("=" * 52)
    print()
    print(f"  Sie ist schon gestartet und erreichbar unter:  {url}")
    print()
    print("  [Enter]     laufende App oeffnen  (das willst du meistens)")
    print("  [z] Enter   trotzdem eine ZWEITE Kopie auf einem anderen Port")
    print("              starten - Achtung: beide nutzen denselben data-Ordner,")
    print("              und die Handys muessen die NEUE Adresse scannen.")
    print()
    print("  Kein Fenster zu finden? Dann haengt sie im Hintergrund:")
    print("  Task-Manager (Strg+Shift+Esc) -> Details -> 'SunderedSkies-")
    print("  Initiative.exe' bzw. 'python.exe' beenden.")
    print()
    try:
        wahl = input("  Deine Wahl: ").strip().lower()
    except Exception:
        wahl = ""
    if wahl.startswith("z"):
        return "zweite"
    if not os.environ.get("SWI_NO_BROWSER"):
        try:
            webbrowser.open(url)
        except Exception:
            pass
    print()
    print(f"  Geoeffnet: {url}  - dieses Fenster kann zu.")
    try:
        input("  Zum Schliessen die Eingabetaste druecken... ")
    except Exception:
        time.sleep(8)
    return "oeffnen"


def main() -> None:
    # Windows-Konsole (cp1252) vertraegt Umlaute/Blockzeichen sonst nicht.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

    # Port waehlen: 8000 bevorzugt. Belegt? -> Laeuft dort UNSERE App, brechen wir
    # ab (zwei Server wuerden den Spielstand aufteilen). Blockiert ein FREMDES
    # Programm, weichen wir auf einen anderen Port aus.
    port = PORT
    zweite_kopie = False
    if _port_in_use(PORT):
        # Laeuft die App bereits - egal auf welchem Kandidaten-Port?
        running = next((p for p in PORT_CANDIDATES if _port_in_use(p) and _is_our_app(p)), None)
        if running:
            diag.log(f"App laeuft bereits auf Port {running} - Nutzer entscheidet.")
            if _already_running(running) != "zweite":
                return
            diag.log("Nutzer startet bewusst eine zweite Kopie.")
            zweite_kopie = True
        alt = _pick_port()
        if alt is None:
            diag.log("ABBRUCH: alle Kandidaten-Ports belegt.")
            print()
            print("  Alle moeglichen Ports sind belegt. Bitte den Laptop neu starten.")
            print()
            try:
                input("  Zum Schliessen die Eingabetaste druecken... ")
            except Exception:
                time.sleep(12)
            return
        port = alt
        print()
        if zweite_kopie:
            print(f"  ZWEITE Kopie: laeuft auf Port {port}. Die Handys muessen die")
            print("  Adresse unten neu scannen - die erste App bleibt daneben offen.")
        else:
            print(f"  Hinweis: Port {PORT} ist von einem anderen Programm belegt -")
            print(f"  die App laeuft deshalb auf Port {port}. Die Adressen unten stimmen.")
        print()
        diag.log(f"Port {PORT} fremd belegt -> Ausweich-Port {port}")
    set_active_port(port)

    ip = local_ip()
    public = winnet.detect_public()   # WLAN oeffentlich? (Windows blockt dann eingehend)
    fw = winnet.rule_active()
    from .game import DATA_DIR, DATA_DIR_AUSGEWICHEN_VON
    diag.log(f"===== START v{APP_VERSION} - primaer={ip}:{port}, erkannt={all_lan_ips()}, "
             f"wlan_oeffentlich={public}, firewall_regel={fw}, daten={DATA_DIR} =====")
    if DATA_DIR_AUSGEWICHEN_VON:
        diag.log(f"ACHTUNG: '{DATA_DIR_AUSGEWICHEN_VON}' nicht beschreibbar -> "
                 f"Daten liegen jetzt in {DATA_DIR}")
    print_banner(ip)
    if DATA_DIR_AUSGEWICHEN_VON:
        print("  ! Der Ordner neben der App ist schreibgeschuetzt. Spielstand und")
        print(f"    Log liegen deshalb hier:  {DATA_DIR}")
        print("    Besser: den App-Ordner auf den Desktop legen (nicht in")
        print("    'Programme' und nicht direkt aus dem Zip starten).")
        print()
    if public:
        print("  ! Dein WLAN ist als OEFFENTLICH eingestuft - Windows blockt dann")
        print("    eingehende Verbindungen. Wenn sich niemand verbinden kann:")
        print("    in der Spielleiter-Ansicht auf 'Firewall freigeben' klicken")
        print("    (oder WLAN auf Privat stellen).")
        print()
    zc = register_mdns(ip)
    open_browser_later()
    try:
        uvicorn.run(app, host="0.0.0.0", port=active_port(), log_level="warning",
                    ws_ping_interval=10, ws_ping_timeout=10, timeout_keep_alive=10)
    finally:
        if zc:
            try:
                zc.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
