"""Startet die App für die Browser-Tests: eigener Datenordner, eigener Port.

Aufruf: python tests/browser/testserver.py <port>  (SWI_DATA_DIR vorher setzen)

Die Spieler-Ansicht gibt es eigentlich nur über die LAN-Adresse - über
localhost ist man immer SL. Im Test laufen aber alle Browser auf demselben
Rechner. Darum gilt hier: wer den Cookie ``swi_test_rolle=spieler`` mitschickt,
zählt als Handy. Nur in diesem Testserver, nie im echten Spiel.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import uvicorn  # noqa: E402

from server import app as A  # noqa: E402

_echt = A._is_loopback


def _is_loopback(request_or_ws) -> bool:
    try:
        if request_or_ws.cookies.get("swi_test_rolle") == "spieler":
            return False
    except Exception:  # noqa: BLE001
        pass
    return _echt(request_or_ws)


A._is_loopback = _is_loopback

# Update-Hinweis: nie GitHub fragen. Nur wenn der Test SWI_NEUESTE_VERSION
# setzt, „gibt es" eine neue Version.
import os  # noqa: E402

os.environ.setdefault("SWI_NEUESTE_VERSION", "")
A.update.pruefen_im_hintergrund()

if __name__ == "__main__":
    uvicorn.run(A.app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
