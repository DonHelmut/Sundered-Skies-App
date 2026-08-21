"""Leises Diagnose-Log für Verbindungsprobleme (v. a. WLAN-Flackern).

Schreibt wichtige Ereignisse mit Zeitstempel nach ``data/log.txt`` – klein
gehalten (rotiert bei Überschreitung), damit es nie die Platte füllt. Logging
darf NIEMALS das Spiel stören: alle Fehler werden geschluckt.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

_lock = threading.Lock()
_MAX_BYTES = 512 * 1024   # ab ~0,5 MB wird einmal rotiert (log.txt -> log.1.txt)


def _log_path() -> Path:
    # Lazy, um Zirkular-Import zu vermeiden; nutzt dasselbe Datenverzeichnis.
    from .game import DATA_DIR
    return DATA_DIR / "log.txt"


def log(msg: str) -> None:
    try:
        p = _log_path()
        with _lock:
            try:
                if p.exists() and p.stat().st_size > _MAX_BYTES:
                    bak = p.with_name("log.1.txt")
                    if bak.exists():
                        bak.unlink()
                    p.rename(bak)
            except OSError:
                pass
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            with p.open("a", encoding="utf-8") as fh:
                fh.write(f"[{ts}] {msg}\n")
    except Exception:
        pass   # Diagnose darf das Spiel nie beeinträchtigen
