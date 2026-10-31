"""Spielabend aufnehmen und daraus einen Protokoll-Prompt bauen.

Der SL-Laptop nimmt im Browser übers Tischmikro auf (MediaRecorder). Über
``localhost`` darf der Browser das ohne HTTPS - an den Handys ging das nicht,
und dort stoppt das Mikro ohnehin, sobald der Bildschirm ausgeht. Der Browser
schickt alle paar Sekunden ein Stück, der Server hängt es an die Datei an:
stürzt der Browser nach drei Stunden ab, ist trotzdem fast alles da.

Nebenbei merkt sich der Server, wann Kämpfe anfangen und enden und wer welchen
Charakter spielt. Die Transkription macht server/sprache.py (live und danach,
lokal) - aus dem Transkript baut die App einen fertigen Prompt für Claude:
Namen, Kampfzeiten (dort nur kurz zusammenfassen), Marken.
Ein Kampf-Protokoll ist das bewusst NICHT (Kalle hat das abgelehnt) - nur
Zeitmarken, damit die Zusammenfassung Kämpfe kurz halten kann.

Sprecher heißen im Transkript S00, S01 … - der SL kann ihnen nachträglich
(oder live) Namen geben („S01 = Korgo"); der Prompt nennt dann die Namen statt
der Nummern. Live und genau zählen unterschiedlich (live: wer zuerst redet,
genau: wer am meisten redet), darum je eine eigene Zuordnung.

Die Live-Mitschrift landet Zeile für Zeile in „…-live.txt" der laufenden
Aufnahme und erscheint dezent in der SL-Ansicht. Daraus geht der Prompt sofort
nach dem Abend; der genaue Durchgang („…-transkript.txt") ist besser.
"""

from __future__ import annotations

import html
import json
import re
import time
from pathlib import Path
from typing import Optional

# Dateiname = Startzeit, z. B. „2026-10-30_19-42". Mehr Zeichen sind nie
# erlaubt - der Name kommt vom Browser zurück und landet in einem Pfad.
_NAME_MUSTER = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(-\d+)?$")
_ENDUNGEN = (".webm", ".ogg", ".m4a")
MAX_STUECK = 8 * 1024 * 1024        # ein Stück alle 10 s ist ein paar 100 KB
MAX_TRANSKRIPT = 20 * 1024 * 1024   # 4 h Transkript sind ca. 0,5 MB Text
LIVE_MERKEN = 60                    # so viele Live-Zeilen hält der Server für die Anzeige
_SPRECHER_MUSTER = re.compile(r"^S\d{2}$")
_ZEILE = re.compile(r"^\[(\d{2}:\d{2}:\d{2})\] (S\d{2}): (.*)$")
SPIELLEITER = "Spielleiter"


def now_ms() -> int:
    return int(time.time() * 1000)


def uhrzeit(ms: int) -> str:
    """Millisekunden seit Aufnahmebeginn -> „01:23:45" (wie noScribe stempelt)."""
    s = max(0, int(ms // 1000))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def name_gueltig(name) -> bool:
    return isinstance(name, str) and bool(_NAME_MUSTER.match(name))


def endung_fuer(mime: str) -> str:
    """Chrome/Edge liefern webm/opus, Firefox ogg, Safari mp4."""
    m = (mime or "").lower()
    if "ogg" in m:
        return ".ogg"
    if "mp4" in m or "aac" in m:
        return ".m4a"
    return ".webm"


def transkript_text(roh: str) -> str:
    """noScribe speichert standardmäßig HTML (sonst TXT/VTT). Für den Prompt
    reicht der reine Text - Tags und Kopf-Gerümpel würden Claude nur Platz
    kosten."""
    if "<" not in roh or not re.search(r"<(html|p|body|span|br|div)\b", roh, re.I):
        return roh.strip()
    t = re.sub(r"(?is)<(head|style|script)\b.*?</\1>", "", roh)
    t = re.sub(r"(?i)<br\s*/?>", "\n", t)
    t = re.sub(r"(?i)</(p|div|h\d|li|tr)>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("\xa0", " ")
    zeilen = [z.strip() for z in t.splitlines()]
    return "\n".join(z for z in zeilen if z).strip()


class Aufnahmen:
    """Alle Aufnahmen in ``ordner``: je Abend eine Audiodatei plus eine
    gleichnamige .json mit Zeitmarken und Namen."""

    def __init__(self, ordner: Path) -> None:
        self.ordner = ordner
        # Namen & Begriffe des SL (server/sprache.py hält die Liste) - kommen
        # mit in den Prompt. Von app.py gesetzt.
        self.begriffe_quelle = lambda: []
        self.aktiv: Optional[dict] = None      # Metadaten der laufenden Aufnahme
        self._letztes_stueck = 0
        self._war_im_kampf = False
        self._runden = 0
        self.live_zeilen: list[dict] = []      # letzte Live-Zeilen der laufenden Aufnahme
        self._live_n = 0

    # --- Dateien ---------------------------------------------------------------

    def _meta_pfad(self, name: str) -> Path:
        return self.ordner / f"{name}.json"

    def audio_pfad(self, name: str) -> Optional[Path]:
        if not name_gueltig(name):
            return None
        for e in _ENDUNGEN:
            p = self.ordner / f"{name}{e}"
            if p.exists():
                return p
        return None

    def _meta_lesen(self, name: str) -> Optional[dict]:
        try:
            return json.loads(self._meta_pfad(name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _meta_schreiben(self, meta: dict) -> None:
        # Nach jeder Marke sofort schreiben: Laptop aus, Akku leer - die
        # Kampfzeiten bis dahin sind trotzdem da.
        try:
            self.ordner.mkdir(parents=True, exist_ok=True)
            pfad = self._meta_pfad(meta["name"])
            tmp = pfad.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(pfad)
        except OSError:
            pass

    # --- Aufnehmen -------------------------------------------------------------

    def starten(self, mime: str, game=None) -> dict:
        """Neue Aufnahme. Läuft noch eine (Seite neu geladen, Browser
        abgestürzt), wird die sauber beendet - ihr Ton bleibt erhalten."""
        if self.aktiv:
            self.stoppen(game)
        self.ordner.mkdir(parents=True, exist_ok=True)
        jetzt = now_ms()
        name = time.strftime("%Y-%m-%d_%H-%M", time.localtime(jetzt / 1000))
        basis, n = name, 2
        while self._meta_pfad(name).exists() or self.audio_pfad(name):
            name = f"{basis}-{n}"
            n += 1
        meta = {
            "name": name, "start": jetzt, "ende": None, "dauerMs": 0,
            "endung": endung_fuer(mime), "mime": str(mime or "")[:80],
            "personen": {}, "ereignisse": [],
        }
        self.aktiv = meta
        self._letztes_stueck = jetzt
        self._war_im_kampf = False
        self._runden = 0
        self._zug = None
        self.live_zeilen = []
        if game is not None:
            self.beobachten(game)
        self._meta_schreiben(meta)
        return meta

    def stueck(self, name: str, daten: bytes) -> bool:
        if not self.aktiv or self.aktiv["name"] != name or not daten:
            return False
        if len(daten) > MAX_STUECK:
            return False
        pfad = self.ordner / f"{name}{self.aktiv['endung']}"
        with open(pfad, "ab") as f:
            f.write(daten)
        self._letztes_stueck = now_ms()
        self.aktiv["dauerMs"] = self._letztes_stueck - self.aktiv["start"]
        return True

    def stoppen(self, game=None) -> Optional[dict]:
        meta = self.aktiv
        if not meta:
            return None
        if game is not None:
            self.beobachten(game)
        # Ende = letztes angekommenes Stück, nicht „jetzt": nach einem Absturz
        # käme sonst die ganze Zeit bis zum Neustart als Tonlänge dazu.
        ende_ms = max(self._letztes_stueck, meta["start"])
        if self._war_im_kampf:
            self._ereignis({"art": "kampf_ende", "runden": self._runden}, ende_ms)
        meta["ende"] = ende_ms
        meta["dauerMs"] = ende_ms - meta["start"]
        self._meta_schreiben(meta)
        self.aktiv = None
        self._war_im_kampf = False
        return meta

    def marke(self, text: str = "") -> bool:
        """SL tippt 📌: „das hier war wichtig" - kommt betont ins Protokoll."""
        if not self.aktiv:
            return False
        self._ereignis({"art": "marke", "text": str(text or "")[:200]})
        self._meta_schreiben(self.aktiv)
        return True

    def _ereignis(self, e: dict, zeit_ms: Optional[int] = None) -> None:
        t = (zeit_ms if zeit_ms is not None else now_ms()) - self.aktiv["start"]
        self.aktiv["ereignisse"].append({"t": max(0, t), **e})

    # --- Live-Mitschrift -------------------------------------------------------------

    def live(self, zeit_ms, sprecher: str, text: str) -> bool:
        """Eine Zeile der Live-Mitschrift. zeit_ms = Wanduhr, als das Gesagte
        anfing; daraus wird die Zeit ab Aufnahmebeginn wie im Transkript."""
        if not self.aktiv:
            return False
        text = " ".join(str(text or "").split())[:2000]
        if not text:
            return True
        sprecher = sprecher if isinstance(sprecher, str) and _SPRECHER_MUSTER.match(sprecher) else "S??"
        try:
            t = int(zeit_ms) - self.aktiv["start"]
        except (TypeError, ValueError):
            t = now_ms() - self.aktiv["start"]
        t = max(0, t)
        try:
            with open(self.ordner / f"{self.aktiv['name']}-live.txt", "a", encoding="utf-8") as f:
                f.write(f"[{uhrzeit(t)}] {sprecher}: {text}\n")
        except OSError:
            pass
        self._live_n += 1
        self.live_zeilen.append({"n": self._live_n, "t": t, "sprecher": sprecher, "text": text,
                                 "empfangen": now_ms()})
        del self.live_zeilen[:-LIVE_MERKEN]
        return True

    def live_ab(self, n: int = 0) -> dict:
        """Zeilen nach Nummer n (die Anzeige fragt nur nach Neuem)."""
        return {"zeilen": [z for z in self.live_zeilen if z["n"] > n],
                "aufnahme": self.aktiv["name"] if self.aktiv else None,
                "namen": ((self.aktiv or {}).get("sprecher") or {}).get("live") or {}}

    # --- Spielstand mitschreiben ------------------------------------------------

    def beobachten(self, game) -> None:
        """Nach jeder Änderung aufgerufen. Erkennt Kampfbeginn (Runde 0 -> 1)
        und Kampfende (Runde zurück auf 0: Abräumen/Zurücksetzen) und merkt
        sich, wer welchen Charakter spielt."""
        if not self.aktiv:
            return
        geaendert = False
        for c in game.combatants:
            if c.get("kind") != "player":
                continue
            figur = str(c.get("name") or "").strip()
            spieler = str(c.get("playerName") or "").strip()
            if figur and self.aktiv["personen"].get(figur) != spieler:
                self.aktiv["personen"][figur] = spieler
                geaendert = True
        # Kampf = Karten liegen UND noch ein Gegner steht. Nur auf „Abräumen"
        # zu warten reichte nicht: viele SL lassen nach dem letzten Treffer
        # alles liegen, dann wäre der halbe Abend ein einziger Kampf.
        dabei = [c for c in game.combatants if not c.get("benched")]
        gegner = [c for c in dabei if c.get("kind") == "npc" and not c.get("ally")]
        im_kampf = (game.round or 0) > 0 and any(not (c.get("status") or {}).get("out") for c in gegner)
        if im_kampf and not self._war_im_kampf:
            self._ereignis({
                "art": "kampf_start",
                "gegner": _gezaehlt(gegner),
                "verbuendete": _gezaehlt([c for c in dabei if c.get("kind") == "npc" and c.get("ally")]),
                "spieler": [str(c.get("name") or "?") for c in dabei if c.get("kind") == "player"],
            })
            geaendert = True
        elif not im_kampf and self._war_im_kampf:
            self._ereignis({"art": "kampf_ende", "runden": self._runden})
            geaendert = True
        # Wer gerade dran ist: im Kampf redet meist der, dessen Zug es ist -
        # daraus rät sprecher_raten() nachher, welcher Sprecher wer ist.
        zug = None
        if im_kampf:
            dran = next((c for c in dabei if c.get("id") == getattr(game, "active_id", None)), None)
            if dran is not None:
                zug = str(dran.get("name") or "") if dran.get("kind") == "player" else ""
        if zug != getattr(self, "_zug", None):
            self._ereignis({"art": "zug", "figur": zug or None})
            self._zug = zug
            geaendert = True
        # Rundenzahl nur als Zähler („Kampf über 4 Runden"), kein Verlauf.
        self._runden = max(self._runden, game.round or 0) if im_kampf else 0
        self._war_im_kampf = im_kampf
        if geaendert:
            self._meta_schreiben(self.aktiv)

    # --- Übersicht ---------------------------------------------------------------

    def status(self) -> dict:
        a = self.aktiv
        return {
            "aktiv": None if not a else {
                "name": a["name"], "start": a["start"],
                "letztesStueck": self._letztes_stueck,
                "marken": sum(1 for e in a["ereignisse"] if e.get("art") == "marke"),
            },
            "liste": self.liste(),
            "ordner": str(self.ordner),
        }

    def liste(self) -> list[dict]:
        erg = []
        if not self.ordner.exists():
            return erg
        for p in self.ordner.glob("*.json"):
            meta = self._meta_lesen(p.stem)
            if not meta or not name_gueltig(meta.get("name")):
                continue
            audio = self.audio_pfad(meta["name"])
            ev = meta.get("ereignisse", [])
            dauer = meta.get("dauerMs", 0)
            if not meta.get("ende") and audio and not (self.aktiv and self.aktiv["name"] == meta["name"]):
                # Server mittendrin beendet (Absturz, Fenster zu): die Länge
                # steht dann nur im Speicher. Letzte Änderung der Tondatei
                # = letztes angekommenes Stück.
                dauer = max(dauer, int(audio.stat().st_mtime * 1000) - (meta.get("start") or 0))
            erg.append({
                "name": meta["name"], "start": meta.get("start"),
                "dauerMs": dauer,
                "laeuft": bool(self.aktiv and self.aktiv["name"] == meta["name"]),
                "bytes": audio.stat().st_size if audio else 0,
                "datei": audio.name if audio else None,
                "kaempfe": sum(1 for e in ev if e.get("art") == "kampf_start"),
                "marken": sum(1 for e in ev if e.get("art") == "marke"),
                "personen": meta.get("personen", {}),
                "hatTranskript": (self.ordner / f"{meta['name']}-transkript.txt").exists(),
                "hatLive": (self.ordner / f"{meta['name']}-live.txt").exists(),
            })
        # Neueste oben. Nach Startzeit, nicht nach Namen: „…_19-42-2" (zweite
        # Aufnahme derselben Minute) sortiert als Text VOR „…_19-42".
        erg.sort(key=lambda x: (x.get("start") or 0, len(x["name"])), reverse=True)
        return erg

    def loeschen(self, name: str) -> bool:
        if not name_gueltig(name) or (self.aktiv and self.aktiv["name"] == name):
            return False
        weg = False
        for p in [self._meta_pfad(name), self.audio_pfad(name),
                  self.ordner / f"{name}-transkript.txt", self.ordner / f"{name}-prompt.txt",
                  self.ordner / f"{name}-live.txt"]:
            if p and p.exists():
                p.unlink()
                weg = True
        return weg

    # --- Namen, Sprecher ---------------------------------------------------------

    def _meta(self, name: str) -> Optional[dict]:
        if self.aktiv and self.aktiv["name"] == name:
            return self.aktiv
        return self._meta_lesen(name) if name_gueltig(name) else None

    def namen(self, name: str) -> list[str]:
        """Namen, die in dieser Aufnahme vorkamen: Figuren, Spieler, Gegner
        (für die Namenskorrektur im genauen Durchgang)."""
        meta = self._meta(name) or {}
        erg = [x for paar in (meta.get("personen") or {}).items() for x in paar if x]
        for e in meta.get("ereignisse", []):
            for k in ("gegner", "verbuendete", "spieler"):
                erg += [x for x in e.get(k) or [] if isinstance(x, str)]
        return erg

    def personen_zahl(self, name: str) -> int:
        """Leute am Tisch laut App: verschiedene Spieler + SL. 0 = unbekannt."""
        meta = self._meta(name) or {}
        leute = {(sp or figur).strip().lower() for figur, sp in (meta.get("personen") or {}).items()}
        leute.discard("")
        return len(leute) + 1 if leute else 0

    def _text(self, name: str, quelle: str) -> Optional[str]:
        datei = f"{name}-transkript.txt" if quelle == "genau" else f"{name}-live.txt"
        try:
            return (self.ordner / datei).read_text(encoding="utf-8")
        except OSError:
            return None

    def sprecher(self, name: str, quelle: str) -> Optional[dict]:
        """Für „Wer ist wer?": je Sprecher Redeanteil und ein paar typische
        Sätze, dazu die bisherige Zuordnung und Namensvorschläge."""
        if not name_gueltig(name) or quelle not in ("genau", "live"):
            return None
        meta = self._meta(name)
        text = self._text(name, quelle)
        if not meta or text is None:
            return None
        je: dict[str, dict] = {}
        for z in text.splitlines():
            m = _ZEILE.match(z.strip())
            if not m:
                continue
            d = je.setdefault(m.group(2), {"sprecher": m.group(2), "zeichen": 0, "beispiele": []})
            d["zeichen"] += len(m.group(3))
            d["beispiele"].append(m.group(3))
        gesamt = sum(d["zeichen"] for d in je.values()) or 1
        liste = []
        for d in sorted(je.values(), key=lambda x: x["sprecher"]):
            # Die längsten Sätze sagen am meisten darüber, wer das ist.
            bsp = sorted(d["beispiele"], key=len, reverse=True)[:3]
            liste.append({"sprecher": d["sprecher"], "anteil": round(d["zeichen"] / gesamt, 3),
                          "beispiele": [b[:160] for b in bsp]})
        vorschlaege = [SPIELLEITER] + [f"{figur} ({sp})" if sp else figur
                                       for figur, sp in sorted((meta.get("personen") or {}).items())]
        return {"sprecher": liste, "namen": (meta.get("sprecher") or {}).get(quelle) or {},
                "vorschlaege": vorschlaege,
                "automatisch": quelle == "genau" and bool(meta.get("sprecherAuto"))}

    def sprecher_benennen(self, name: str, quelle: str, namen: dict) -> bool:
        if quelle not in ("genau", "live") or not isinstance(namen, dict):
            return False
        meta = self._meta(name)
        if not meta:
            return False
        sauber = {k: " ".join(str(v).split())[:60] for k, v in namen.items()
                  if isinstance(k, str) and _SPRECHER_MUSTER.match(k) and isinstance(v, str) and v.strip()}
        meta.setdefault("sprecher", {})[quelle] = sauber
        if quelle == "genau":
            meta["sprecherAuto"] = False      # jetzt vom SL bestätigt
        self._meta_schreiben(meta)
        return True

    # --- Prompt -------------------------------------------------------------------

    def prompt(self, name: str, transkript_roh: str, extra: str = "", speichern: bool = True,
               sprecher: Optional[dict] = None) -> Optional[str]:
        """Transkript (Text oder noScribe-HTML) -> Prompt. speichern: das
        Transkript als „…-transkript.txt" ablegen (nur bei fremden Dateien -
        ein Live-Prompt soll nicht als genaues Transkript gelten)."""
        if not name_gueltig(name):
            return None
        meta = self._meta_lesen(name)
        if not meta:
            return None
        text = transkript_text(transkript_roh)
        if not text:
            return None
        try:
            begriffe = list(self.begriffe_quelle() or [])
        except Exception:
            begriffe = []
        p = baue_prompt(meta, text, extra, begriffe=begriffe, sprecher=sprecher)
        try:
            if speichern:
                (self.ordner / f"{name}-transkript.txt").write_text(text, encoding="utf-8")
            (self.ordner / f"{name}-prompt.txt").write_text(p, encoding="utf-8")
        except OSError:
            pass
        return p


    def sprecher_automatisch(self, name: str) -> bool:
        """Nach dem genauen Durchgang: Sprecher selbst zuordnen (Kalle: „will
        nicht alles selber auswählen"). Nur wenn noch niemand zugeordnet hat;
        „Wer ist wer?" zeigt das Ergebnis vorausgewählt zum Korrigieren."""
        meta = self._meta(name)
        text = self._text(name, "genau")
        if not meta or text is None or (meta.get("sprecher") or {}).get("genau"):
            return False
        namen = sprecher_raten(text, meta)
        if not namen:
            return False
        meta.setdefault("sprecher", {})["genau"] = namen
        meta["sprecherAuto"] = True
        self._meta_schreiben(meta)
        return True

    def prompt_aus(self, name: str, quelle: str = "genau", extra: str = "") -> Optional[str]:
        """Prompt aus dem genauen Transkript oder der Live-Mitschrift."""
        if not name_gueltig(name) or quelle not in ("genau", "live"):
            return None
        text = self._text(name, quelle)
        if text is None:
            return None
        meta = self._meta(name) or {}
        return self.prompt(name, text, extra, speichern=False,
                           sprecher=(meta.get("sprecher") or {}).get(quelle) or {})


# --- Wer ist wer? (automatisch) ----------------------------------------------------

def _sekunden(hms: str) -> int:
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def sprecher_raten(transkript: str, meta: dict) -> dict:
    """S00, S01 … -> „Spielleiter", „Korgo (Tim)" aus dem Kontext:
    - Spielleiter = wer am meisten redet (erzählt, spricht alle NSCs).
    - Spieler sagen ihre Figur selbst an („Korgo zieht seine Axt") - nennt ein
      Sprecher (nicht der SL) eine Figur, zählt das für sie; am Satzanfang mehr.
      „Tessa, hilf mir!" (Name + Komma) ist Anreden, zählt nicht.
    - Spricht der SL eine Figur an („Korgo, was machst du?"), antwortet meist
      deren Spieler: der nächste andere Sprecher bekommt einen Punkt.
    - Im Kampf redet, wessen Zug es ist (Zug-Ereignisse der App).
    Jede Figur höchstens einmal, nur bei klarem Vorsprung; Rest bleibt S0x
    (der Prompt lässt Claude dann über den Inhalt zuordnen)."""
    zeilen = []
    for z in transkript.splitlines():
        m = _ZEILE.match(z.strip())
        if m:
            zeilen.append((_sekunden(m.group(1)), m.group(2), m.group(3)))
    if not zeilen:
        return {}
    zeichen: dict[str, int] = {}
    for _, sp, t in zeilen:
        zeichen[sp] = zeichen.get(sp, 0) + len(t)
    sl = max(zeichen, key=zeichen.get)
    erg = {sl: SPIELLEITER}
    figuren = {f: (sp or "") for f, sp in (meta.get("personen") or {}).items() if f}
    if not figuren:
        return erg
    # Wörter, an denen man eine Figur erkennt: ihr Name (auch Teile:
    # „Korgo der Starke" -> korgo) und der Name des Spielers.
    kennung = {}
    for f, sp in figuren.items():
        w = {x.lower() for x in re.findall(r"\w+", f) if len(x) >= 3}
        if sp:
            w |= {x.lower() for x in re.findall(r"\w+", sp) if len(x) >= 3}
        kennung[f] = w
    punkte: dict[tuple, float] = {}

    def plus(sp, f, p):
        if sp != sl:
            punkte[(sp, f)] = punkte.get((sp, f), 0.0) + p
    for i, (t0, sp, text) in enumerate(zeilen):
        for satz in re.split(r"(?<=[.!?])\s+", text):
            woerter = re.findall(r"\w+", satz.lower())
            for f, w in kennung.items():
                treffer = [k for k, x in enumerate(woerter) if x in w]
                if not treffer:
                    continue
                angesprochen = bool(re.match(r"\s*(\w+\s*){1,2},", satz)) and treffer[0] <= 1
                if sp == sl:
                    if angesprochen or satz.rstrip().endswith("?"):
                        nach = next((z for z in zeilen[i + 1:i + 4] if z[1] != sl), None)
                        if nach and nach[0] - t0 <= 30:
                            plus(nach[1], f, 1.0)
                elif not angesprochen:
                    plus(sp, f, 2.0 if treffer[0] <= 1 else 1.0)
    # Züge im Kampf: Redezeit (grob aus der Textlänge) im Zug einer Figur.
    zuege = [(e["t"] / 1000, e.get("figur")) for e in meta.get("ereignisse", []) if e.get("art") == "zug"]
    for k, (ab, f) in enumerate(zuege):
        if f not in figuren:
            continue
        bis = zuege[k + 1][0] if k + 1 < len(zuege) else ab + 120
        for t0, sp, text in zeilen:
            if ab <= t0 < bis:
                plus(sp, f, min(1.0, len(text) / 60))
    vergeben, figur_weg = set(), set()
    for (sp, f), p in sorted(punkte.items(), key=lambda x: -x[1]):
        if sp in vergeben or f in figur_weg or p < 2.0:
            continue
        # Klarer Vorsprung vor der zweitbesten Figur dieses Sprechers.
        andere = max((q for (s2, f2), q in punkte.items() if s2 == sp and f2 != f and f2 not in figur_weg),
                     default=0.0)
        if p < 1.5 * andere:
            continue
        erg[sp] = f"{f} ({figuren[f]})" if figuren[f] else f
        vergeben.add(sp)
        figur_weg.add(f)
    return erg


def _gezaehlt(figuren: list[dict]) -> list[str]:
    """„Ork 1", „Ork 2", „Ork 3" -> „3× Ork" (die App nummeriert Statisten)."""
    zahl: dict[str, int] = {}
    for c in figuren:
        basis = re.sub(r"\s+\d+$", "", str(c.get("name") or "?").strip()) or "?"
        zahl[basis] = zahl.get(basis, 0) + 1
    return [f"{n}× {b}" if n > 1 else b for b, n in sorted(zahl.items())]


def _kampf_zeilen(ereignisse: list[dict]) -> list[str]:
    zeilen, start = [], None
    for e in ereignisse:
        if e.get("art") == "kampf_start":
            start = e
        elif e.get("art") == "kampf_ende" and start is not None:
            wer = ", ".join(start.get("gegner") or []) or "unbekannte Gegner"
            runden = e.get("runden") or 0
            zusatz = f", {runden} Runde{'n' if runden != 1 else ''}" if runden else ""
            zeilen.append(f"- {uhrzeit(start['t'])} bis {uhrzeit(e['t'])}: Kampf gegen {wer}{zusatz}")
            start = None
    return zeilen


def sprecher_einsetzen(transkript: str, namen: dict) -> str:
    """„[00:01:02] S01: …" -> „[00:01:02] Korgo (Stefan): …" für zugeordnete."""
    if not namen:
        return transkript
    aus = []
    for z in transkript.splitlines():
        m = _ZEILE.match(z.strip())
        if m and namen.get(m.group(2)):
            z = f"[{m.group(1)}] {namen[m.group(2)]}: {m.group(3)}"
        aus.append(z)
    return "\n".join(aus)


def baue_prompt(meta: dict, transkript: str, extra: str = "", begriffe: Optional[list] = None,
                sprecher: Optional[dict] = None) -> str:
    datum = time.strftime("%d.%m.%Y", time.localtime((meta.get("start") or now_ms()) / 1000))
    personen = meta.get("personen") or {}
    namen = [f"- {figur}" + (f" (gespielt von {sp})" if sp else "")
             for figur, sp in sorted(personen.items())]
    kaempfe = _kampf_zeilen(meta.get("ereignisse", []))
    marken = [f"- {uhrzeit(e['t'])}" + (f": {e['text']}" if e.get("text") else "")
              for e in meta.get("ereignisse", []) if e.get("art") == "marke"]
    teile = [
        f"Du bist Chronist einer Pen-&-Paper-Runde (Savage Worlds: Sundered Skies). "
        f"Unten steht das automatische Transkript des Spielabends vom {datum}. "
        "Schreib daraus ein Story-Protokoll auf Deutsch, 1–2 Seiten.",
        "",
        "SO SOLL ES SEIN:",
        "- Erzählend, in der Vergangenheit, aus Sicht der Gruppe – wie ein Kapitel einer Chronik.",
        "- Nur was in der Spielwelt passiert. Regelfragen, Würfelergebnisse, Pausen und Gespräche außerhalb des Spiels weglassen.",
        "- Kämpfe nur kurz: 1–2 Sätze (gegen wen, wie ging es aus, Folgen). Kein Rundenverlauf.",
        "- Danach kurze Listen: Wichtige NSCs (mit einem Halbsatz), Orte, Beute/Belohnungen, offene Fäden und Fragen für nächstes Mal.",
        "",
        "ZUM TRANSKRIPT:",
        "- Es ist automatisch erkannt und enthält Hörfehler. Namen und Begriffe sinnvoll korrigieren.",
        (("- Die Sprecher hat die App automatisch zugeordnet (wer am meisten erzählt, wer seine Figur "
          "ansagt, wessen Zug es war) – das kann falsch sein, im Zweifel zählt der Inhalt. "
          if meta.get("sprecherAuto") else "- Die Sprecher hat der Spielleiter zugeordnet. ")
         + "Wer noch S00, S01 … heißt, ordne über den Inhalt zu."
         if sprecher else
         "- Sprecher heißen dort S00, S01 … Ordne sie den Personen über den Inhalt zu. "
         "Wer am meisten erzählt und NSCs spricht, ist der Spielleiter."),
        "- Der Spielleiter spricht NSCs mit verstellter Stimme. Seine Zeilen (oder ein eigener Sprecher) "
        "können also NSC-Rede sein – im Protokoll dem NSC zuordnen, nicht als weitere Person.",
        "- Die Sprechererkennung irrt sich manchmal mitten im Satz – im Zweifel zählt der Inhalt.",
        "- Zeitstempel [hh:mm:ss] (falls vorhanden) zählen ab Beginn der Aufnahme.",
    ]
    if namen:
        teile += ["", "CHARAKTERE DER SPIELER:", *namen]
    begriffe = [b for b in (begriffe or []) if isinstance(b, str) and b.strip()]
    if begriffe:
        teile += ["", "NAMEN UND BEGRIFFE DER RUNDE (so geschrieben):", ", ".join(begriffe[:300])]
    if kaempfe:
        teile += ["", "KÄMPFE (laut Initiative-App, Zeit ab Aufnahmebeginn – hier nur kurz zusammenfassen):", *kaempfe]
    if marken:
        teile += ["", "VOM SPIELLEITER MARKIERTE MOMENTE (besonders erwähnen):", *marken]
    if extra and extra.strip():
        teile += ["", "HINWEISE DES SPIELLEITERS:", extra.strip()[:2000]]
    teile += ["", "TRANSKRIPT:", "<<<", sprecher_einsetzen(transkript.strip(), sprecher or {}), ">>>"]
    return "\n".join(teile) + "\n"
