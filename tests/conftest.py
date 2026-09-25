"""Pytest-Grundlagen: sorgt dafür, dass Tests NIE echte Nutzerdaten anfassen."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Ganz früh (vor jedem Import von server.game/app): Datenverzeichnis auf einen
# Wegwerf-Ordner legen. So schreibt/liest kein Test die echte roster.json etc.
_TMP_ROOT = Path(tempfile.mkdtemp(prefix="swi-test-"))
os.environ["SWI_DATA_DIR"] = str(_TMP_ROOT / "data")

# Projektwurzel (mit dem Paket „server") importierbar machen.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def fresh_game(tmp_path, monkeypatch):
    """Ein frisches Game mit leerem, isoliertem Datenverzeichnis je Test."""
    from server import game as gmod

    d = tmp_path / "data"
    (d / "uploads").mkdir(parents=True)
    monkeypatch.setattr(gmod, "DATA_DIR", d)
    monkeypatch.setattr(gmod, "ROSTER_FILE", d / "roster.json")
    monkeypatch.setattr(gmod, "BESTIARY_FILE", d / "bestiary.json")
    monkeypatch.setattr(gmod, "ALLIES_FILE", d / "allies.json")
    # Fehlte lange: gespeicherte Begegnungen landeten im gemeinsamen Ordner und
    # tauchten im naechsten Test wieder auf.
    monkeypatch.setattr(gmod, "ENCOUNTERS_FILE", d / "encounters.json")
    monkeypatch.setattr(gmod, "SESSION_FILE", d / "session.json")
    monkeypatch.setattr(gmod, "SETTINGS_FILE", d / "settings.json")
    monkeypatch.setattr(gmod, "UPLOAD_DIR", d / "uploads")
    return gmod.Game()
