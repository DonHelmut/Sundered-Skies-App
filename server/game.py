"""Autoritativer Spielzustand, Aktionen und Persistenz.

Der Server hält *einen* Zustand (ein Tisch). Alle Änderungen laufen über
``Game.apply`` und werden anschließend an alle verbundenen Geräte gesendet.
Charakterliste (Roster) und laufender Kampf werden als JSON auf Platte
gespeichert, damit nach einem Neustart fortgesetzt werden kann.
"""

from __future__ import annotations

import copy
import hashlib
import re
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from . import engine
from .paths import BASE_DIR

# Standard: data/ neben der .exe. Über SWI_DATA_DIR umlegbar (z. B. für Tests).
# Ist der Ort nicht beschreibbar (App liegt in C:\Programme, wird direkt AUS dem
# Zip gestartet, gesperrter Ordner), weichen wir aus statt abzustuerzen - sonst
# blitzt das Fenster nur kurz auf und es gibt nicht mal ein Log zum Nachsehen.
def _dir_beschreibbar(p: Path) -> bool:
    try:
        p.mkdir(parents=True, exist_ok=True)
        probe = p / ".schreibtest"
        probe.write_text("x", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def _waehle_data_dir() -> tuple[Path, Optional[str]]:
    """(Datenordner, ausgewichen_von). Reihenfolge: SWI_DATA_DIR -> neben der
    .exe -> AppData. Zweiter Rueckgabewert ist gesetzt, wenn ausgewichen wurde."""
    kandidaten = []
    env = os.environ.get("SWI_DATA_DIR")
    if env:
        kandidaten.append(Path(env))
    kandidaten.append(BASE_DIR / "data")
    heim = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    kandidaten.append((Path(heim) if heim else Path.home()) / "SunderedSkies" / "data")
    for nr, k in enumerate(kandidaten):
        if _dir_beschreibbar(k):
            return k, (str(kandidaten[0]) if nr > 0 else None)
    # Nichts beschreibbar: trotzdem weiterlaufen (nur im Speicher, ohne Sichern).
    return kandidaten[0], str(kandidaten[0])


DATA_DIR, DATA_DIR_AUSGEWICHEN_VON = _waehle_data_dir()
ROSTER_FILE = DATA_DIR / "roster.json"
BESTIARY_FILE = DATA_DIR / "bestiary.json"   # dauerhafte Gegner-Vorlagen (mit Bild)
ALLIES_FILE = DATA_DIR / "allies.json"        # dauerhafte Verbündeten-Vorlagen (mit Bild)
ENCOUNTERS_FILE = DATA_DIR / "encounters.json"  # gespeicherte Begegnungen (Gegner-Gruppen)
SESSION_FILE = DATA_DIR / "session.json"
SETTINGS_FILE = DATA_DIR / "settings.json"   # dauerhafte SL-Voreinstellungen
UPLOAD_DIR = DATA_DIR / "uploads"

MAX_MESSAGES = 50


def default_status() -> dict:
    """Kampfzustand eines Teilnehmers: Angeschlagen / Wunden / Ausgeschaltet
    plus schnelle Zusatz-Zustände."""
    return {
        "shaken": False, "wounds": 0, "out": False,
        "vulnerable": False, "distracted": False, "prone": False, "stunned": False,
    }


def max_wounds(c: dict) -> int:
    """Wie viele Wunden vertraegt die Figur? Wild Card 3, Statist 2."""
    return 3 if c.get("isWildCard") else 2


# Zusatz-Zustände, die als Chips umgeschaltet werden können.
CONDITIONS = {
    "vulnerable": "Verwundbar",
    "distracted": "Abgelenkt",
    "prone": "Am Boden",
    "stunned": "Betäubt",
}

# Talent-Metadaten für die Oberfläche (Schlüssel -> Anzeigename + Hinweis).
TALENTS: dict[str, dict[str, str]] = {
    "schnell": {"label": "Schnell", "kind": "draw"},
    "kuehler_kopf": {"label": "Kühler Kopf", "kind": "draw"},
    "sehr_kuehler_kopf": {"label": "Sehr Kühler Kopf", "kind": "draw"},
    "zoegerlich": {"label": "Zögerlich", "kind": "draw"},
    "berechnend": {"label": "Berechnend", "kind": "hint"},
    "maechtiger_hieb": {"label": "Mächtiger Hieb", "kind": "hint"},
    "volltreffer": {"label": "Volltreffer", "kind": "hint"},
    "energieschub": {"label": "Energieschub", "kind": "hint"},
}

# Kampfzonen: fünf abstrakte Entfernungsstufen (innen -> außen). Index = Zone.
ZONES = [
    {"key": "melee", "label": "Nahkampf", "emoji": "⚔️"},
    {"key": "near", "label": "Nahbereich", "emoji": "👣"},
    {"key": "far", "label": "Fernbereich", "emoji": "🏹"},
    {"key": "distant", "label": "Weitbereich", "emoji": "🎯"},
    {"key": "out", "label": "Außer Reichweite", "emoji": "🚫"},
]
ZONE_MIN, ZONE_MAX = 0, len(ZONES) - 1
DEFAULT_ZONE = 1          # Fallback (Backfill alter Sitzungen)
DEFAULT_ZONE_PLAYER = 1   # Spieler starten im Nahbereich
DEFAULT_ZONE_NPC = 4      # Gegner starten „Außer Reichweite"


def now_ms() -> int:
    return int(time.time() * 1000)


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _read_json(path: Path) -> Optional[Any]:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def _write_json(path: Path, data: Any, backup: bool = False) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        # Bei dauerhaften Dateien (Roster/Bibliotheken) die ALTE Version als .bak
        # behalten -> schützt gegen einen kaputten Schreibvorgang. Original bleibt
        # bis zum atomaren Tausch unangetastet.
        if backup and path.exists():
            try:
                path.with_suffix(path.suffix + ".bak").write_bytes(path.read_bytes())
            except OSError:
                pass
        tmp.replace(path)
    except OSError:
        pass


class Game:
    def __init__(self) -> None:
        # Darf NIE den Start verhindern - ohne Schreibrechte laeuft die Runde
        # eben nur im Speicher (Sichern schlaegt still fehl, siehe _write_json).
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

        self.roster: list[dict] = _read_json(ROSTER_FILE) or []
        self.bestiary: list[dict] = _read_json(BESTIARY_FILE) or []
        self.allies: list[dict] = _read_json(ALLIES_FILE) or []
        self.encounters: list[dict] = _read_json(ENCOUNTERS_FILE) or []
        self.combatants: list[dict] = []
        self.players: list[dict] = []
        self.messages: list[dict] = []
        self.requests: list[dict] = []      # Spieler-Anfragen an den SL
        self.tv_image: Optional[dict] = None  # Bild großflächig auf dem TV/Beamer
        self.round: int = 0
        self.deck: list[dict] = engine.shuffle(engine.full_deck())
        self.discard: list[dict] = []
        self.phase: str = "idle"           # idle | running | gate
        self.active_id: Optional[str] = None
        self.timer_seconds: int = 6        # wird gleich aus Einstellungen überschrieben
        self.timer_ends_at: Optional[int] = None
        self.joker_active: bool = False
        self.joker_flash: int = 0          # zählt bei jedem Joker-Zug hoch (für Effekt)
        self.reshuffle_next: bool = False  # nach Joker: vor nächster Runde komplett mischen
        self.sound_enabled: bool = True
        self.benny_start: int = 3          # Standard-Startwert je Wild Card
        self.sl_bennies: int = 0           # Benny-Pool des Spielleiters
        self.auto_incap: bool = True       # bei der 4. Wunde automatisch K.O.
        self.conditions_enabled: bool = True   # Zusatz-Zustaende ueberhaupt verwenden?
        self.requests_enabled: bool = True     # duerfen Spieler ueberhaupt anfragen?
        self.benny_to_gm: bool = True      # Hausregel: Spieler-Benny -> SL-Pool

        # Dauerhafte SL-Voreinstellungen (letzter Timer-/Benny-Startwert bleibt Default).
        settings = _read_json(SETTINGS_FILE) or {}
        try:
            self.timer_seconds = max(1, min(600, int(settings.get("timerSeconds", 6))))
        except (TypeError, ValueError):
            self.timer_seconds = 6
        try:
            self.benny_start = max(0, min(20, int(settings.get("bennyStart", 3))))
        except (TypeError, ValueError):
            self.benny_start = 3
        self.auto_incap = bool(settings.get("autoIncap", True))
        self.conditions_enabled = bool(settings.get("conditionsEnabled", True))
        self.requests_enabled = bool(settings.get("requestsEnabled", True))
        self.benny_to_gm = bool(settings.get("bennyToGm", True))

        # Gab es beim Start eine frühere Sitzung auf Platte? (für "Fortsetzen?")
        self.resume_available: bool = SESSION_FILE.exists()

        # Mehrstufiges Rückgängig: Stapel vollständiger Zustands-Kopien.
        self._history: list[dict] = []
        self._history_cap = 40

    # --- Undo / Verlauf ------------------------------------------------------

    # Felder, die eine Aktion verändern kann und die für Undo gesichert werden.
    _SNAPSHOT_FIELDS = (
        "combatants", "players", "messages", "round", "deck", "discard",
        "roster", "bestiary", "allies", "encounters",
        "phase", "active_id", "timer_seconds", "timer_ends_at", "joker_active",
        "sound_enabled", "benny_start", "sl_bennies", "reshuffle_next",
        "requests", "tv_image",
    )

    def _capture(self) -> dict:
        return {f: copy.deepcopy(getattr(self, f)) for f in self._SNAPSHOT_FIELDS}

    def _restore(self, snap: dict) -> None:
        for f, v in snap.items():
            setattr(self, f, copy.deepcopy(v))

    def _push_history(self) -> None:
        self._history.append(self._capture())
        if len(self._history) > self._history_cap:
            self._history.pop(0)

    # --- Persistenz ----------------------------------------------------------

    def save_roster(self) -> None:
        _write_json(ROSTER_FILE, self.roster, backup=True)

    def save_bestiary(self) -> None:
        _write_json(BESTIARY_FILE, self.bestiary, backup=True)

    def save_allies(self) -> None:
        _write_json(ALLIES_FILE, self.allies, backup=True)

    def save_encounters(self) -> None:
        _write_json(ENCOUNTERS_FILE, self.encounters, backup=True)

    def save_settings(self) -> None:
        """Sichert die dauerhaften Voreinstellungen (Timer-/Benny-Startwert)."""
        _write_json(SETTINGS_FILE, {
            "timerSeconds": self.timer_seconds,
            "bennyStart": self.benny_start,
            "autoIncap": self.auto_incap,
            "bennyToGm": self.benny_to_gm,
            "conditionsEnabled": self.conditions_enabled,
            "requestsEnabled": self.requests_enabled,
        })

    def export_data(self) -> dict:
        """Alles Dauerhafte (Charaktere + Bibliotheken + Begegnungen + Einstellungen)
        in einem Objekt – für die Sicherung."""
        return {
            "type": "sundered-skies-backup", "version": 1,
            "roster": self.roster, "bestiary": self.bestiary,
            "allies": self.allies, "encounters": self.encounters,
            "settings": {"bennyStart": self.benny_start,
                         "autoIncap": self.auto_incap,
                         "timerSeconds": self.timer_seconds},
        }

    def import_data(self, data: dict) -> bool:
        """Stellt eine Sicherung wieder her (ersetzt Charaktere + Bibliotheken +
        Begegnungen). Laufender Kampf bleibt unberührt."""
        if not isinstance(data, dict):
            return False
        touched = False
        if isinstance(data.get("roster"), list):
            self.roster = data["roster"]; self.save_roster(); touched = True
        if isinstance(data.get("bestiary"), list):
            self.bestiary = data["bestiary"]; self.save_bestiary(); touched = True
        if isinstance(data.get("allies"), list):
            self.allies = data["allies"]; self.save_allies(); touched = True
        if isinstance(data.get("encounters"), list):
            self.encounters = data["encounters"]; self.save_encounters(); touched = True
        s = data.get("settings")
        if isinstance(s, dict):
            try:
                self.benny_start = max(0, min(20, int(s.get("bennyStart", self.benny_start))))
                self.timer_seconds = max(1, min(600, int(s.get("timerSeconds", self.timer_seconds))))
            except (TypeError, ValueError):
                pass
            self.auto_incap = bool(s.get("autoIncap", self.auto_incap))
            self.save_settings()
            touched = True
        return touched

    def save_session(self) -> None:
        _write_json(SESSION_FILE, {
            "combatants": self.combatants,
            "players": [{**p, "connected": False} for p in self.players],
            "messages": self.messages[-MAX_MESSAGES:],
            "requests": self.requests,
            "tvImage": self.tv_image,
            "round": self.round,
            "deck": self.deck,
            "discard": self.discard,
            "phase": self.phase,
            "activeId": self.active_id,
            "timerSeconds": self.timer_seconds,
            "jokerActive": self.joker_active,
            "reshuffleNext": self.reshuffle_next,
            "soundEnabled": self.sound_enabled,
            "bennyStart": self.benny_start,
            "slBennies": self.sl_bennies,
        })

    def resume_session(self) -> bool:
        data = _read_json(SESSION_FILE)
        if not data:
            return False
        self.combatants = data.get("combatants", [])
        for c in self.combatants:
            merged = default_status()
            merged.update(c.get("status") or {})
            c["status"] = merged
            # Neue Felder für ältere Sitzungen nachziehen.
            c.setdefault("zone", DEFAULT_ZONE)
            c.setdefault("ran", False)
            c.setdefault("moved", False)
            c.setdefault("image", None)
            c.setdefault("draw", None)
            c.setdefault("benched", False)
            c.setdefault("ally", False)
            c.setdefault("note", "")
        self.players = data.get("players", [])
        self.requests = data.get("requests", [])
        self.tv_image = data.get("tvImage")
        self.messages = data.get("messages", [])
        self.round = data.get("round", 0)
        self.deck = data.get("deck") or engine.shuffle(engine.full_deck())
        self.discard = data.get("discard", [])
        self.phase = "gate" if data.get("phase") == "running" else data.get("phase", "idle")
        self.active_id = data.get("activeId")
        self.timer_seconds = data.get("timerSeconds", 30)
        self.timer_ends_at = None  # Timer läuft nach Neustart nicht weiter.
        self.joker_active = data.get("jokerActive", False)
        self.reshuffle_next = data.get("reshuffleNext", False)
        self.sound_enabled = data.get("soundEnabled", True)
        self.benny_start = data.get("bennyStart", 3)
        self.sl_bennies = data.get("slBennies", 0)
        self.resume_available = False
        for c in self.combatants:
            c.setdefault("bennies", self.benny_start if c.get("isWildCard") else 0)
            c.setdefault("gluck", False)
            c.setdefault("grosses_gluck", False)
        return True

    def discard_saved_session(self) -> None:
        """Fängt eine frische Sitzung an, ohne die alte zu laden."""
        try:
            SESSION_FILE.unlink(missing_ok=True)
        except OSError:
            pass
        self.resume_available = False

    # --- Helfer --------------------------------------------------------------

    def _combatant(self, cid: str) -> Optional[dict]:
        return next((c for c in self.combatants if c["id"] == cid), None)

    @staticmethod
    def _edge_bonus(src: dict) -> int:
        """Benny-Bonus aus Glück (+1) / Großes Glück (+2)."""
        if src.get("grosses_gluck"):
            return 2
        if src.get("gluck"):
            return 1
        return 0

    def _starting_bennies(self, src: dict) -> int:
        return self.benny_start + self._edge_bonus(src)

    def _resort(self) -> None:
        order = engine.sort_order(self.combatants)
        pos = {cid: i for i, cid in enumerate(order)}
        self.combatants.sort(key=lambda c: pos[c["id"]])

    def _collect_cards(self) -> None:
        for c in self.combatants:
            if c.get("card"):
                self.discard.append(c["card"])
            c["card"] = None
            c["draw"] = None
            c["held"] = False
            c["done"] = False
            c["revealed"] = False

    # --- Serialisierung für Clients -----------------------------------------

    def _tarnname(self, c: dict) -> str:
        """Unleserlicher Platzhalter statt des echten Gegnernamens.

        Der echte Name verlaesst den Laptop damit gar nicht erst - blosses
        Weichzeichnen im Browser waere nur Kosmetik. Aus der Figuren-ID
        abgeleitet, damit er bei jeder Aktualisierung gleich bleibt (sonst
        flackert die Zeile bei jedem Zustands-Update)."""
        roh = hashlib.md5(c["id"].encode("utf-8")).hexdigest()
        laenge = max(4, min(11, len(c.get("name") or "")))
        ab = "abcdefghijklmnopqrstuvwxyz"
        return "".join(ab[int(roh[i * 2:i * 2 + 2], 16) % 26] for i in range(laenge)).capitalize()

    def _fuer_spieler(self, combatants: list[dict]) -> list[dict]:
        """Gegner unkenntlich machen: Tarnname statt echtem Namen, Bild als
        'verdeckt' markiert. Verbuendete und Spielerfiguren bleiben normal -
        die eigene Seite soll man ja erkennen."""
        raus = []
        for c in combatants:
            if c.get("anon") and c.get("kind") == "npc" and not c.get("ally"):
                kopie = dict(c)
                kopie["name"] = self._tarnname(c)
                kopie["anon"] = True             # Client zeichnet das weich
                raus.append(kopie)
            else:
                raus.append(c)
        return raus

    def snapshot(self, fuer_spieler: bool = False) -> dict:
        # Verdeckte Gegner: der SL markiert sie einzeln, die Spieler bekommen
        # dann Tarnnamen statt der echten.
        anon = fuer_spieler and any(c.get("anon") for c in self.combatants)
        return {
            "serverNow": now_ms(),   # zum Ausgleich von Uhren-Versatz der Clients
            "round": self.round,
            "phase": self.phase,
            "activeId": self.active_id,
            "timerSeconds": self.timer_seconds,
            "timerEndsAt": self.timer_ends_at,
            "jokerActive": self.joker_active,
            "jokerFlash": self.joker_flash,
            "soundEnabled": self.sound_enabled,
            "bennyStart": self.benny_start,
            "slBennies": self.sl_bennies,
            "autoIncap": self.auto_incap,
            "bennyToGm": self.benny_to_gm,
            "conditionsEnabled": self.conditions_enabled,
            "requestsEnabled": self.requests_enabled,
            "deckCount": len(self.deck),
            "hasSavedSession": self.resume_available,
            "canUndo": len(self._history) > 0,
            "roster": self.roster,
            "bestiary": [] if fuer_spieler else self.bestiary,
            "allies": self.allies,
            "encounters": self.encounters,
            "players": self.players,
            "combatants": self._fuer_spieler(self.combatants) if anon else self.combatants,
            "messages": self.messages[-MAX_MESSAGES:],
            "requests": self.requests,
            "tvImage": self.tv_image,
            "talents": TALENTS,
            "conditions": CONDITIONS if self.conditions_enabled else {},
            "zones": ZONES,
        }

    # --- Aktionen ------------------------------------------------------------

    def apply(self, action: dict) -> None:
        """Führt eine SL-Aktion aus. ``action['type']`` bestimmt das Verhalten."""
        t = action.get("type")

        if t == "undo":
            if self._history:
                self._restore(self._history.pop())
                self.save_session()
                # Bibliotheken liegen in eigenen Dateien -> mitziehen, sonst
                # gewinnt beim naechsten Start wieder der alte Dateistand.
                self.save_roster()
                self.save_bestiary()
                self.save_allies()
                self.save_encounters()
            return

        # Aufdecken einer Karte: nur ein Sicht-Flag, KEIN Undo-Ziel, kein Reset des
        # Fortsetzen-Status. Wird von Spielern (eigene Karte) und SL genutzt.
        if t == "reveal":
            c = self._combatant(action.get("id"))
            if c and c.get("card") and not c.get("revealed"):
                c["revealed"] = True
                self.save_session()
            return

        handler = getattr(self, f"_do_{t}", None)
        if handler:
            # Erste Aktion = frische Sitzung begonnen -> keine Fortsetzen-Abfrage mehr.
            self.resume_available = False
            # Zustand vor der Änderung sichern (für Rückgängig).
            self._push_history()
            handler(action)
            self.save_session()

    # Roster ------------------------------------------------------------------

    def _do_roster_upsert(self, a: dict) -> None:
        char_id = a.get("id") or _new_id("char")
        prev = next((r for r in self.roster if r.get("id") == char_id), None)
        entry = {
            "id": char_id,
            "name": (a.get("name") or "Unbenannt").strip() or "Unbenannt",
            "isWildCard": bool(a.get("isWildCard", True)),
            "talents": [t for t in a.get("talents", []) if t in TALENTS],
            "gluck": bool(a.get("gluck", False)),
            "grosses_gluck": bool(a.get("grosses_gluck", False)),
            # Char-Bild beim Bearbeiten NICHT verlieren.
            "image": a.get("image", (prev or {}).get("image")),
        }
        for i, r in enumerate(self.roster):
            if r["id"] == entry["id"]:
                self.roster[i] = entry
                break
        else:
            self.roster.append(entry)
        # Aktive Teilnehmer, die auf diesem Charakter basieren, mitziehen.
        for c in self.combatants:
            if c.get("characterId") == entry["id"]:
                c["name"] = entry["name"]
                c["isWildCard"] = entry["isWildCard"]
                c["talents"] = entry["talents"]
                c["gluck"] = entry["gluck"]
                c["grosses_gluck"] = entry["grosses_gluck"]
        self.save_roster()

    def _do_roster_delete(self, a: dict) -> None:
        self.roster = [r for r in self.roster if r["id"] != a.get("id")]
        self.save_roster()

    def _do_add_from_roster(self, a: dict) -> None:
        """SL setzt einen Charakter aus der Liste direkt in den Kampf (SL-gesteuert,
        ohne dass ein Spieler beitreten muss)."""
        char = next((r for r in self.roster if r["id"] == a.get("id")), None)
        if char:
            self.add_combatant_from_character(char, None, player_name="", zone=a.get("zone"))

    # Gegner-Bibliothek (Bestiarium) – dauerhafte Vorlagen, wie das Roster ------

    def _do_bestiary_upsert(self, a: dict) -> None:
        ent_id = a.get("id") or _new_id("npc")
        prev = next((r for r in self.bestiary if r.get("id") == ent_id), None)
        entry = {
            "id": ent_id,
            "name": (a.get("name") or "Gegner").strip() or "Gegner",
            "isWildCard": bool(a.get("isWildCard", False)),
            "talents": [t for t in a.get("talents", []) if t in TALENTS],
            "gluck": bool(a.get("gluck", False)),
            "grosses_gluck": bool(a.get("grosses_gluck", False)),
            "image": a.get("image", (prev or {}).get("image")),   # Bild beim Bearbeiten behalten
        }
        for i, r in enumerate(self.bestiary):
            if r["id"] == entry["id"]:
                self.bestiary[i] = entry
                break
        else:
            self.bestiary.append(entry)
        self.save_bestiary()

    def _do_bestiary_delete(self, a: dict) -> None:
        self.bestiary = [r for r in self.bestiary if r.get("id") != a.get("id")]
        self.save_bestiary()

    def _do_add_npc_from_bestiary(self, a: dict) -> None:
        """SL holt eine Gegner-Vorlage schnell in den Kampf (inkl. Bild)."""
        tmpl = next((r for r in self.bestiary if r.get("id") == a.get("id")), None)
        if not tmpl:
            return
        self._do_add_npc({
            "name": tmpl.get("name"),
            "isWildCard": tmpl.get("isWildCard", False),
            "talents": tmpl.get("talents", []),
            "gluck": tmpl.get("gluck", False),
            "grosses_gluck": tmpl.get("grosses_gluck", False),
            "zone": a.get("zone"),
            "anon": a.get("anon", tmpl.get("anon", False)),
            "count": a.get("count", 1),
        })
        if tmpl.get("image") and self.combatants:
            self.combatants[-1]["image"] = tmpl["image"]

    # Verbündeten-Bibliothek – wie das Bestiarium, aber auf Spielerseite --------

    def _do_ally_upsert(self, a: dict) -> None:
        ent_id = a.get("id") or _new_id("ally")
        prev = next((r for r in self.allies if r.get("id") == ent_id), None)
        entry = {
            "id": ent_id,
            "name": (a.get("name") or "Verbündeter").strip() or "Verbündeter",
            "isWildCard": bool(a.get("isWildCard", False)),
            "talents": [t for t in a.get("talents", []) if t in TALENTS],
            "gluck": bool(a.get("gluck", False)),
            "grosses_gluck": bool(a.get("grosses_gluck", False)),
            "image": a.get("image", (prev or {}).get("image")),
        }
        for i, r in enumerate(self.allies):
            if r["id"] == entry["id"]:
                self.allies[i] = entry
                break
        else:
            self.allies.append(entry)
        self.save_allies()

    def _do_ally_delete(self, a: dict) -> None:
        self.allies = [r for r in self.allies if r.get("id") != a.get("id")]
        self.save_allies()

    def _do_add_ally_from_library(self, a: dict) -> None:
        """SL holt einen Verbündeten in den Kampf (NPC auf Spielerseite)."""
        tmpl = next((r for r in self.allies if r.get("id") == a.get("id")), None)
        if not tmpl:
            return
        self._do_add_npc({
            "name": tmpl.get("name"),
            "isWildCard": tmpl.get("isWildCard", False),
            "talents": tmpl.get("talents", []),
            "gluck": tmpl.get("gluck", False),
            "grosses_gluck": tmpl.get("grosses_gluck", False),
            "zone": a.get("zone", DEFAULT_ZONE_PLAYER),   # Verbündete starten wie Spieler
        })
        if self.combatants:
            self.combatants[-1]["ally"] = True
            if tmpl.get("image"):
                self.combatants[-1]["image"] = tmpl["image"]

    # Begegnungen (gespeicherte Gegner-/Verbündeten-Gruppen) ------------------

    def _do_save_encounter(self, a: dict) -> None:
        """Speichert die AKTUELLEN NSCs (Gegner + Verbündete) als benannte
        Begegnung – als Schnappschuss, damit sie unabhängig von den Bibliotheken
        wieder eingesetzt werden kann. Spieler bleiben außen vor (die treten bei)."""
        members = []
        for c in self.combatants:
            if c.get("kind") != "npc":
                continue
            members.append({
                "name": c.get("name", "Gegner"),
                "isWildCard": bool(c.get("isWildCard", False)),
                "talents": list(c.get("talents", [])),
                "gluck": bool(c.get("gluck", False)),
                "grosses_gluck": bool(c.get("grosses_gluck", False)),
                "zone": c.get("zone", DEFAULT_ZONE_NPC),
                "ally": bool(c.get("ally", False)),
                "image": c.get("image"),
                "note": c.get("note", ""),
            })
        if not members:
            return
        self.encounters.append({
            "id": _new_id("enc"),
            "name": (a.get("name") or "Begegnung").strip() or "Begegnung",
            "members": members,
        })
        self.save_encounters()

    def _do_delete_encounter(self, a: dict) -> None:
        self.encounters = [e for e in self.encounters if e.get("id") != a.get("id")]
        self.save_encounters()

    def _do_add_encounter(self, a: dict) -> None:
        """Setzt eine gespeicherte Begegnung komplett in den Kampf."""
        enc = next((e for e in self.encounters if e.get("id") == a.get("id")), None)
        if not enc:
            return
        for m in enc.get("members", []):
            self._do_add_npc({
                "name": m.get("name"),
                "isWildCard": m.get("isWildCard", False),
                "talents": m.get("talents", []),
                "gluck": m.get("gluck", False),
                "grosses_gluck": m.get("grosses_gluck", False),
                "zone": m.get("zone"),
            })
            if self.combatants:
                if m.get("ally"):
                    self.combatants[-1]["ally"] = True
                if m.get("image"):
                    self.combatants[-1]["image"] = m["image"]
                if m.get("note"):
                    self.combatants[-1]["note"] = m["note"]

    # Teilnehmer --------------------------------------------------------------

    def add_combatant_from_character(self, char: dict, player_id: Optional[str],
                                     player_name: str = "", zone: Optional[int] = None) -> dict:
        is_wc = char.get("isWildCard", True)
        try:
            start_zone = DEFAULT_ZONE_PLAYER if zone is None else max(ZONE_MIN, min(ZONE_MAX, int(zone)))
        except (TypeError, ValueError):
            start_zone = DEFAULT_ZONE_PLAYER
        c = {
            "id": _new_id("cbt"),
            "name": char["name"],
            "playerName": player_name,
            "kind": "player",
            "isWildCard": is_wc,
            "talents": list(char.get("talents", [])),
            "gluck": bool(char.get("gluck", False)),
            "grosses_gluck": bool(char.get("grosses_gluck", False)),
            "bennies": self._starting_bennies(char) if is_wc else 0,
            "characterId": char.get("id"),
            "playerId": player_id,
            "card": None,
            "held": False,
            "done": False,
            "revealed": False,
            "zone": start_zone,
            "ran": False,
            "moved": False,
            "benched": False,
            "ally": False,
            "note": "",
            "image": char.get("image"),
            "status": default_status(),
            "createdAt": now_ms(),
        }
        self.combatants.append(c)
        return c

    def add_guest_combatant(self, name: str, player_id: str) -> dict:
        c = {
            "id": _new_id("cbt"),
            "name": name.strip() or "Gast",
            "playerName": name.strip() or "Gast",
            "kind": "player",
            "isWildCard": True,
            "talents": [],
            "gluck": False,
            "grosses_gluck": False,
            "bennies": self.benny_start,
            "characterId": None,
            "playerId": player_id,
            "card": None,
            "held": False,
            "done": False,
            "revealed": False,
            "zone": DEFAULT_ZONE_PLAYER,
            "ran": False,
            "moved": False,
            "benched": False,
            "ally": False,
            "note": "",
            "image": None,
            "status": default_status(),
            "createdAt": now_ms(),
        }
        self.combatants.append(c)
        return c

    _NUMMER_AM_ENDE = re.compile(r"^(.*?)\s+(\d+)$")

    def _grundname(self, name: str) -> str:
        """'Ork 3' -> 'Ork'. Damit zaehlt der naechste Ork richtig weiter,
        egal ob schon nummeriert wurde."""
        treffer = self._NUMMER_AM_ENDE.match(name.strip())
        return treffer.group(1) if treffer else name.strip()

    def _nummeriere(self, name: str) -> str:
        """Mehrere gleiche Gegner auseinanderhalten: der erste heisst weiter
        'Ork', sobald der zweite dazukommt werden daraus 'Ork 1' und 'Ork 2'."""
        grund = self._grundname(name)
        gleiche = [c for c in self.combatants
                   if c.get("kind") == "npc" and self._grundname(c.get("name", "")) == grund]
        if not gleiche:
            return grund

        # Den ersten rueckwirkend mitnummerieren - sonst stuenden "Ork" und
        # "Ork 2" nebeneinander, was niemand versteht.
        hoechste = 0
        for c in gleiche:
            treffer = self._NUMMER_AM_ENDE.match(c.get("name", "").strip())
            if treffer:
                hoechste = max(hoechste, int(treffer.group(2)))
            else:
                c["name"] = f"{grund} 1"
                hoechste = max(hoechste, 1)
        return f"{grund} {hoechste + 1}"

    def _do_add_npc(self, a: dict) -> None:
        # Mehrere auf einmal ("3 Orks") - jeder bekommt seine eigene Nummer.
        try:
            anzahl = max(1, min(20, int(a.get("count", 1))))
        except (TypeError, ValueError):
            anzahl = 1
        if anzahl > 1:
            einzeln = dict(a)
            einzeln.pop("count", None)
            for _ in range(anzahl):
                self._do_add_npc(einzeln)
            return

        is_wc = bool(a.get("isWildCard", False))
        edges = {"gluck": bool(a.get("gluck", False)), "grosses_gluck": bool(a.get("grosses_gluck", False))}
        # Gegner starten „Außer Reichweite", sofern der SL keine Zone vorgibt.
        try:
            npc_zone = int(a.get("zone", DEFAULT_ZONE_NPC))
        except (TypeError, ValueError):
            npc_zone = DEFAULT_ZONE_NPC
        npc_zone = max(ZONE_MIN, min(ZONE_MAX, npc_zone))
        c = {
            "id": _new_id("cbt"),
            "name": self._nummeriere((a.get("name") or "Gegner").strip() or "Gegner"),
            "kind": "npc",
            "isWildCard": is_wc,
            "talents": [t for t in a.get("talents", []) if t in TALENTS],
            "gluck": edges["gluck"],
            "grosses_gluck": edges["grosses_gluck"],
            "bennies": self._starting_bennies(edges) if is_wc else 0,
            "characterId": None,
            "playerId": None,
            "anon": bool(a.get("anon", False)),   # verdeckt? (Spieler sehen Tarnnamen)
            "card": None,
            "held": False,
            "done": False,
            "revealed": False,
            "zone": npc_zone,
            "ran": False,
            "moved": False,
            "benched": False,
            "ally": False,
            "note": "",
            "image": None,
            "status": default_status(),
            "createdAt": now_ms(),
        }
        self.combatants.append(c)

    def _do_edit_combatant(self, a: dict) -> None:
        c = self._combatant(a.get("id"))
        if not c:
            return
        if "name" in a:
            c["name"] = (a["name"] or c["name"]).strip() or c["name"]
        if "isWildCard" in a:
            c["isWildCard"] = bool(a["isWildCard"])
        if "talents" in a:
            c["talents"] = [t for t in a["talents"] if t in TALENTS]
        if "gluck" in a:
            c["gluck"] = bool(a["gluck"])
        if "grosses_gluck" in a:
            c["grosses_gluck"] = bool(a["grosses_gluck"])
        if "note" in a:
            c["note"] = str(a.get("note") or "")[:500]

    def _do_set_note(self, a: dict) -> None:
        """SL-Kurznotiz an einer Figur (z. B. „flieht bei 2 Wunden")."""
        c = self._combatant(a.get("id"))
        if c is not None:
            c["note"] = str(a.get("note") or "")[:500]

    def _do_move_zone(self, a: dict) -> None:
        """Verschiebt eine Figur zwischen den Kampfzonen. ``dir`` = -1 (näher) /
        +1 (weiter); ``run`` erlaubt bis zu zwei Zonen und markiert „Gerannt".
        ``byPlayer`` = vom Spieler ausgelöst -> max. EINE Bewegung pro Runde
        (`moved`). Der SL (ohne ``byPlayer``) bewegt frei und beliebig oft."""
        c = self._combatant(a.get("id"))
        if not c:
            return
        by_player = bool(a.get("byPlayer"))
        if by_player and c.get("moved"):
            return   # Spieler hat sich diesen Zug schon bewegt
        try:
            direction = 1 if int(a.get("dir", 0)) > 0 else -1 if int(a.get("dir", 0)) < 0 else 0
        except (TypeError, ValueError):
            direction = 0
        if direction == 0:
            return
        run = bool(a.get("run"))
        step = 2 if run else 1
        cur = int(c.get("zone", DEFAULT_ZONE))
        new = max(ZONE_MIN, min(ZONE_MAX, cur + direction * step))
        if new == cur:
            return
        c["zone"] = new
        if run:
            c["ran"] = True
        if by_player:
            c["moved"] = True   # Bewegungs-Budget dieser Runde verbraucht

    def _do_set_zone(self, a: dict) -> None:
        """SL setzt den Standort einer Figur direkt (absolut, ohne Budget) –
        für die Aufstellung. Nur SL (Spieler-Whitelist enthält es nicht)."""
        c = self._combatant(a.get("id"))
        if not c:
            return
        try:
            z = int(a.get("zone"))
        except (TypeError, ValueError):
            return
        c["zone"] = max(ZONE_MIN, min(ZONE_MAX, z))

    def _do_set_image(self, a: dict) -> None:
        """Setzt (oder entfernt) das Char-Bild einer Figur. Nur lokale Uploads."""
        c = self._combatant(a.get("id"))
        if not c:
            return
        url = a.get("url") or None
        if url and not str(url).startswith("/uploads/"):
            return
        c["image"] = url
        # Falls die Figur auf einem Roster-Charakter basiert: Bild dort merken,
        # damit es beim nächsten Beitritt automatisch wieder da ist.
        cid = c.get("characterId")
        if cid:
            for r in self.roster:
                if r.get("id") == cid:
                    r["image"] = url
                    self.save_roster()
                    break

    def _do_bench(self, a: dict) -> None:
        """Nimmt eine Figur aus dem Kampf (pausiert – erhält keine Karten) oder
        wieder rein. ``on`` = True -> pausiert. Bleibt in der Liste."""
        c = self._combatant(a.get("id"))
        if not c:
            return
        on = bool(a.get("on", True))
        c["benched"] = on
        if on:
            if c.get("card"):
                self.discard.append(c["card"])
            c["card"] = None
            c["draw"] = None
            # War die pausierte Figur gerade dran, zum nächsten weiterrücken.
            if self.active_id == c["id"]:
                self._advance_active()
                self.phase = "gate"
                self.timer_ends_at = None
        self._resort()

    def _do_set_status(self, a: dict) -> None:
        c = self._combatant(a.get("id"))
        if not c:
            return
        st = c.setdefault("status", default_status())
        if "shaken" in a:
            st["shaken"] = bool(a["shaken"])
        if "wounds" in a:
            try:
                w = int(a["wounds"])
            except (TypeError, ValueError):
                w = st.get("wounds", 0)
            # Obergrenze je Typ: Wild Cards vertragen 3 Wunden, Statisten 2.
            # Eine Wunde darueber -> ausgeschaltet (sofern Auto-K.O. an ist).
            max_w = max_wounds(c)
            if self.auto_incap and w > max_w:
                st["wounds"] = max_w
                st["out"] = True
            else:
                st["wounds"] = max(0, min(max_w, w))
        if "out" in a:
            st["out"] = bool(a["out"])
        for cond in CONDITIONS:
            if cond in a:
                st[cond] = bool(a[cond])

    def _do_apply_hit(self, a: dict) -> None:
        """Ein Treffer nach Savage-Worlds-Logik in EINEM Klick:
        nicht angeschlagen -> Angeschlagen; schon angeschlagen -> +1 Wunde
        (und bei der 4. automatisch K.O., falls Auto-K.O. an)."""
        c = self._combatant(a.get("id"))
        if not c:
            return
        st = c.setdefault("status", default_status())
        if st.get("out"):
            return
        if not st.get("shaken"):
            st["shaken"] = True
        else:
            self._do_set_status({"id": c["id"], "wounds": st.get("wounds", 0) + 1})

    def _do_apply_heal(self, a: dict) -> None:
        """Heilung in EINEM Klick – Gegenstück zu ``apply_hit``: erst wieder wach,
        dann Wunden abbauen, zuletzt „Angeschlagen" aufheben."""
        c = self._combatant(a.get("id"))
        if not c:
            return
        st = c.setdefault("status", default_status())
        if st.get("out"):
            st["out"] = False
        elif st.get("wounds", 0) > 0:
            st["wounds"] = max(0, st.get("wounds", 0) - 1)
        elif st.get("shaken"):
            st["shaken"] = False

    def _do_recover(self, a: dict) -> None:
        """Erholung von „Angeschlagen": entweder frei (bestandene Willenskraft-
        Probe am Tisch) oder per Benny (Wild Card gibt einen aus)."""
        c = self._combatant(a.get("id"))
        if not c:
            return
        st = c.setdefault("status", default_status())
        if not st.get("shaken"):
            return
        if a.get("benny") and c.get("isWildCard") and c.get("bennies", 0) > 0:
            c["bennies"] -= 1
        st["shaken"] = False

    def _do_remove_combatant(self, a: dict) -> None:
        rid = a.get("id")
        c = self._combatant(rid)
        if c and c.get("card"):
            self.discard.append(c["card"])
        # Ist es ein Spieler, auch seinen Spieler-Eintrag entfernen (Kick).
        pid = c.get("playerId") if c else None
        # Wird der aktive Akteur entfernt, zum nächsten weiterrücken.
        if self.active_id == rid:
            order = [x["id"] for x in self.combatants]
            idx = order.index(rid) if rid in order else -1
            self.active_id = order[idx + 1] if 0 <= idx < len(order) - 1 else None
            self.phase = "gate"
            self.timer_ends_at = None
        # Offene Anfragen dieses Teilnehmers verwerfen.
        self.requests = [r for r in self.requests if r.get("combatantId") != rid]
        self.combatants = [x for x in self.combatants if x["id"] != rid]
        if pid:
            self.players = [p for p in self.players if p["id"] != pid]

    def _do_clear_defeated(self, a: dict) -> None:
        """Entfernt alle ausgeschalteten GEGNER auf einmal – keine Verbündeten,
        keine Spieler (die bleiben, auch wenn K.O.)."""
        def is_defeated_enemy(c):
            return (c.get("kind") == "npc" and not c.get("ally")
                    and (c.get("status") or {}).get("out"))
        vids = {c["id"] for c in self.combatants if is_defeated_enemy(c)}
        if not vids:
            return
        for c in self.combatants:
            if c["id"] in vids and c.get("card"):
                self.discard.append(c["card"])
        # War der aktive Akteur dabei, zum nächsten verbleibenden weiterrücken.
        if self.active_id in vids:
            order = [x["id"] for x in self.combatants]
            idx = order.index(self.active_id)
            self.active_id = next((order[j] for j in range(idx + 1, len(order))
                                   if order[j] not in vids), None)
            self.phase = "gate"
            self.timer_ends_at = None
        self.requests = [r for r in self.requests if r.get("combatantId") not in vids]
        self.combatants = [x for x in self.combatants if x["id"] not in vids]

    # Karten austeilen --------------------------------------------------------

    def _deal(self, new_round: bool) -> None:
        self._collect_cards()
        # Regelkonform: wurde letzte Runde ein Joker gezogen, jetzt komplett mischen.
        if self.reshuffle_next:
            self.deck = engine.shuffle(self.deck + self.discard)
            self.discard = []
            self.reshuffle_next = False
        dm = engine.DeckManager(self.deck, self.discard)
        for c in self.combatants:
            if c.get("benched"):
                # Pausierte Figuren erhalten keine Karte (nehmen nicht am Kampf teil).
                c["card"] = None
                c["draw"] = None
                continue
            kept, seq = engine.deal_one_combatant(dm, c.get("talents", []))
            c["card"] = kept
            # Ziehsequenz für die schrittweise Aufdeck-Animation (nur bei Talent).
            c["draw"] = seq if len(seq) > 1 else None
            # Aufdeck-Status: NPCs sofort offen, Spieler verdeckt bis zum Antippen.
            c["revealed"] = (c.get("kind") == "npc")
            c["ran"] = False   # „Gerannt"-Markierung gilt nur bis zur nächsten Runde
            c["moved"] = False  # Bewegungs-Budget: 1 Zug = 1 Spieler-Bewegung
        self.deck = dm.deck
        self.discard = dm.discard
        self.joker_active = dm.joker_drawn
        if dm.joker_drawn:
            self.joker_flash += 1
            self.reshuffle_next = True
        if new_round:
            self.round += 1
        elif self.round == 0:
            self.round = 1
        self._resort()
        # Zug-Ablauf zurücksetzen: erster Akteur, aber im Freigabe-Gate.
        self.active_id = self.combatants[0]["id"] if self.combatants else None
        self.phase = "gate"
        self.timer_ends_at = None

    def _do_deal_current(self, a: dict) -> None:
        self._deal(new_round=False)

    def _do_new_round(self, a: dict) -> None:
        self._deal(new_round=True)

    def _do_redraw(self, a: dict) -> None:
        c = self._combatant(a.get("id"))
        if not c:
            return
        if c.get("card"):
            self.discard.append(c["card"])
        dm = engine.DeckManager(self.deck, self.discard)
        kept, seq = engine.deal_one_combatant(dm, c.get("talents", []))
        c["card"] = kept
        c["draw"] = seq if len(seq) > 1 else None
        c["held"] = False
        c["revealed"] = (c.get("kind") == "npc")   # neu gezogen -> Spieler deckt neu auf
        self.deck = dm.deck
        self.discard = dm.discard
        if dm.joker_drawn:
            self.joker_active = True
            self.joker_flash += 1
            self.reshuffle_next = True
        self._resort()

    def _do_reshuffle(self, a: dict) -> None:
        self.deck = engine.shuffle(self.deck + self.discard)
        self.discard = []

    def _do_reset(self, a: dict) -> None:
        self._collect_cards()
        self.deck = engine.shuffle(engine.full_deck())
        self.discard = []
        self.round = 0
        self.phase = "idle"
        self.active_id = None
        self.timer_ends_at = None
        self.joker_active = False
        self.reshuffle_next = False
        self.requests = []   # Anfragen aus dem alten Kampf verwerfen

    # Zug-/Timer-Steuerung ----------------------------------------------------

    def _do_set_timer(self, a: dict) -> None:
        try:
            self.timer_seconds = max(1, min(600, int(a.get("seconds", 6))))
        except (TypeError, ValueError):
            pass
        if self.phase == "running" and self.timer_ends_at is not None:
            self.timer_ends_at = now_ms() + self.timer_seconds * 1000
        self.save_settings()   # letzter Wert bleibt Default

    def _do_release(self, a: dict) -> None:
        """SL gibt den nächsten Zug frei: Timer des aktuellen Akteurs startet."""
        if not self.combatants:
            return
        if self.active_id is None:
            self.active_id = self.combatants[0]["id"]
        self.phase = "running"
        self.timer_ends_at = now_ms() + self.timer_seconds * 1000

    def _do_confirm_turn(self, a: dict) -> None:
        """Aktueller Akteur (oder SL) bestätigt den Zug -> Freigabe-Gate."""
        cur = self._combatant(self.active_id) if self.active_id else None
        if cur:
            cur["done"] = True
        self._advance_active()
        self.phase = "gate"
        self.timer_ends_at = None

    def _do_timeout(self, a: dict) -> None:
        """Timer ausgelaufen: Zug endet, aber es geht nicht automatisch weiter."""
        cur = self._combatant(self.active_id) if self.active_id else None
        if cur:
            cur["done"] = True
        self._advance_active()
        self.phase = "gate"
        self.timer_ends_at = None

    def _advance_active(self) -> None:
        order = [c["id"] for c in self.combatants]
        if self.active_id in order:
            idx = order.index(self.active_id)
            nxt = order[idx + 1] if idx + 1 < len(order) else None
        else:
            nxt = order[0] if order else None
        self.active_id = nxt

    def _do_set_active(self, a: dict) -> None:
        """SL springt manuell zu einem Akteur (z. B. Korrektur)."""
        if self._combatant(a.get("id")):
            self.active_id = a.get("id")
            self.phase = "gate"
            self.timer_ends_at = None

    # Abwarten (nur Joker-Halter) --------------------------------------------

    def _do_hold(self, a: dict) -> None:
        """Aktion aufsparen. In Savage Worlds darf das JEDE Figur (nicht nur
        Joker-Halter) – sie greift dann spaeter ein."""
        c = self._combatant(a.get("id"))
        if c and c.get("card") and not c.get("out"):
            c["held"] = True
            if self.active_id == c["id"]:
                self.phase = "gate"
                self.timer_ends_at = None
                self._advance_active()

    def _do_intervene(self, a: dict) -> None:
        """Ein abwartender Joker-Halter greift ein: wird sofort aktiver Akteur."""
        c = self._combatant(a.get("id"))
        if c and c.get("held"):
            c["held"] = False
            c["done"] = False
            self.active_id = c["id"]
            self.phase = "running"
            self.timer_ends_at = now_ms() + self.timer_seconds * 1000

    # Nachrichten -------------------------------------------------------------

    def _do_message(self, a: dict) -> None:
        target = a.get("target", "all")   # "all" | playerId | "beamer"
        text = (a.get("text") or "").strip()
        image_url = a.get("imageUrl")
        if not text and not image_url:
            return
        # Ziel Beamer/TV: Bild großflächig auf dem TV anzeigen (kein Chat-Eintrag).
        if target == "beamer":
            self.tv_image = {"imageUrl": image_url, "text": text, "ts": now_ms()}
            return
        msg = {
            "id": _new_id("msg"),
            "target": target,
            "sender": a.get("sender", "gm"),   # "gm" | "mimi"
            "text": text,
            "imageUrl": image_url,
            "ts": now_ms(),
        }
        self.messages.append(msg)
        self.messages = self.messages[-MAX_MESSAGES:]

    def _do_clear_messages(self, a: dict) -> None:
        self.messages = []

    def _do_clear_tv_image(self, a: dict) -> None:
        self.tv_image = None

    # Spieler-Anfragen (Spieler ändern nichts selbst, sondern fragen an) -------

    def _do_request(self, a: dict) -> None:
        if not self.requests_enabled:
            return                      # Anfragen sind abgeschaltet
        cid = a.get("combatantId")
        c = self._combatant(cid)
        if not c:
            return
        # Doppelte gleiche Anfrage vermeiden.
        for r in self.requests:
            if r["combatantId"] == cid and r["kind"] == a.get("kind") and r.get("detail") == a.get("detail"):
                return
        self.requests.append({
            "id": _new_id("req"),
            "combatantId": cid,
            "name": c.get("name", "?"),
            "playerName": c.get("playerName", ""),
            "kind": a.get("kind", ""),
            "detail": a.get("detail") or {},
            "label": (a.get("label") or "").strip(),
            "ts": now_ms(),
        })

    def _do_resolve_request(self, a: dict) -> None:
        req = next((r for r in self.requests if r["id"] == a.get("id")), None)
        if not req:
            return
        if a.get("apply"):
            cid = req["combatantId"]
            if req["kind"] == "benny":
                self._do_benny_adjust({"id": cid, "delta": req["detail"].get("delta", -1)})
            elif req["kind"] == "recover":
                self._do_recover({"id": cid, "benny": (req.get("detail") or {}).get("benny")})
            elif req["kind"] == "status":
                d = dict(req["detail"])
                if "woundsDelta" in d:
                    c = self._combatant(cid)
                    cur = (c.get("status") or {}).get("wounds", 0) if c else 0
                    lim = max_wounds(c) if c else 3
                    d = {"wounds": max(0, min(lim + 1, cur + d.pop("woundsDelta")))}
                self._do_set_status({"id": cid, **d})
        self.requests = [r for r in self.requests if r["id"] != a.get("id")]

    def _do_toggle_sound(self, a: dict) -> None:
        self.sound_enabled = not self.sound_enabled

    # Bennies ----------------------------------------------------------------

    def _do_set_benny_start(self, a: dict) -> None:
        try:
            self.benny_start = max(0, min(20, int(a.get("value", 3))))
        except (TypeError, ValueError):
            pass
        self.save_settings()   # letzter Wert bleibt Default

    def _do_set_requests_enabled(self, a: dict) -> None:
        """Anfragen der Spieler ganz abschalten (dann sehen sie den Knopf nicht)."""
        self.requests_enabled = bool(a.get("on", True))
        if not self.requests_enabled:
            self.requests = []          # offene Anfragen wegraeumen
        self.save_settings()

    def _do_set_anon(self, a: dict) -> None:
        """SL deckt einen einzelnen Gegner auf oder verdeckt ihn wieder."""
        c = self._combatant(a.get("id"))
        if c and c.get("kind") == "npc" and not c.get("ally"):
            c["anon"] = bool(a.get("on", False))

    def _do_set_conditions_enabled(self, a: dict) -> None:
        """Zusatz-Zustaende (Verwundbar/Abgelenkt/Am Boden/Betaeubt) ein- oder
        ausblenden. Gesetzte Flags bleiben erhalten, sind nur unsichtbar."""
        self.conditions_enabled = bool(a.get("on", True))
        self.save_settings()

    def _do_set_auto_incap(self, a: dict) -> None:
        self.auto_incap = bool(a.get("on", True))
        self.save_settings()

    def _do_set_benny_to_gm(self, a: dict) -> None:
        self.benny_to_gm = bool(a.get("on", True))
        self.save_settings()

    def _do_benny_adjust(self, a: dict) -> None:
        c = self._combatant(a.get("id"))
        if not c or not c.get("isWildCard"):
            return
        try:
            delta = int(a.get("delta", 0))
        except (TypeError, ValueError):
            return
        before = max(0, int(c.get("bennies", 0)))
        c["bennies"] = max(0, before + delta)
        # Hausregel (optional): ein von einem SPIELER ausgegebener Benny wandert in
        # den SL-Pool. Nur echte Ausgaben zählen (nicht wenn schon bei 0).
        if self.benny_to_gm and delta < 0 and c.get("kind") == "player":
            self.sl_bennies += before - c["bennies"]

    def _do_benny_refresh(self, a: dict) -> None:
        """Setzt alle Wild Cards auf ihren Startwert (+ Glück-Boni)."""
        for c in self.combatants:
            if c.get("isWildCard"):
                c["bennies"] = self._starting_bennies(c)

    def _do_sl_benny_adjust(self, a: dict) -> None:
        try:
            delta = int(a.get("delta", 0))
        except (TypeError, ValueError):
            return
        self.sl_bennies = max(0, self.sl_bennies + delta)

    # Spielerverwaltung (nicht persistenzkritisch, aber gespeichert) ----------

    def set_player_connected(self, player_id: str, connected: bool) -> None:
        for p in self.players:
            if p["id"] == player_id:
                p["connected"] = connected

    def register_player(self, name: str, character_id: Optional[str],
                        existing_player_id: Optional[str]) -> dict:
        # Rejoin: bekannte Spieler-ID wiederverwenden.
        if existing_player_id:
            for p in self.players:
                if p["id"] == existing_player_id:
                    p["connected"] = True
                    p["name"] = name or p["name"]
                    # Spielernamen auch am Teilnehmer aktualisieren.
                    for c in self.combatants:
                        if c.get("playerId") == p["id"]:
                            c["playerName"] = name or c.get("playerName", "")
                    return p

        player_id = _new_id("plr")
        player = {"id": player_id, "name": name, "connected": True,
                  "characterId": character_id}
        self.players.append(player)

        if character_id:
            # Steht die Figur schon im Kampf? Dann UEBERNEHMEN statt ein zweites
            # Mal anlegen. Passiert, wenn jemand rausgeflogen ist oder die
            # gespeicherte Spieler-ID verloren hat (neuer Tab, Speicher geleert)
            # und denselben Charakter erneut waehlt.
            vorhanden = next((c for c in self.combatants
                              if c.get("characterId") == character_id), None)
            if vorhanden:
                alte_id = vorhanden.get("playerId")
                vorhanden["playerId"] = player_id
                vorhanden["playerName"] = name
                # Verwaisten Spielereintrag der alten Sitzung aufraeumen - aber
                # nur, wenn dort niemand mehr dranhaengt (sonst haette man die
                # Figur jemandem weggenommen, der noch verbunden ist).
                if alte_id and alte_id != player_id:
                    self.players = [pl for pl in self.players
                                    if pl["id"] != alte_id or pl.get("connected")]
            else:
                char = next((r for r in self.roster if r["id"] == character_id), None)
                if char:
                    self.add_combatant_from_character(char, player_id, player_name=name)
        else:
            self.add_guest_combatant(name, player_id)
        return player
