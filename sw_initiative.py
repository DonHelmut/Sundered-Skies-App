"""Entry-Point fuer die gebuendelte .exe (PyInstaller).

Faengt JEDEN unerwarteten Fehler ab: sonst schliesst sich das schwarze Fenster
sofort wieder und der Spielleiter sieht nie, woran es lag.
"""
import sys
import traceback

# ZUERST: ohne Konsole (console=False) sind stdout/stderr None - fenster merkt
# sich das beim Import und leitet dann um, bevor uvicorn & Co. darauf zugreifen.
from server import fenster
fenster.ausgaben_umleiten()

from server.run import main  # noqa: E402

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        spur = traceback.format_exc()
        try:
            from server import diag
            diag.log("ABSTURZ beim Start:" + chr(10) + spur)
        except Exception:
            pass
        if fenster.OHNE_KONSOLE:
            fenster.meldung("Die App konnte nicht starten.\n\n" + spur[-1500:] +
                            "\n\nBitte data\\log.txt an Stefan schicken.", fehler=True)
            sys.exit(1)
        print()
        print("=" * 52)
        print("  Die App konnte nicht starten.")
        print("=" * 52)
        print()
        print(spur)
        print(r"  Bitte diesen Text (oder data\log.txt) an Stefan schicken.")
        print()
        try:
            input("  Zum Schliessen die Eingabetaste druecken... ")
        except Exception:
            import time
            time.sleep(30)
        sys.exit(1)
