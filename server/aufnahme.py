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


def ton_ms(meta: dict, wand_ms: int) -> int:
    """Wanduhr -> Stelle im Ton (ms ab Aufnahmebeginn). Pausen fehlen im Ton
    (der Browser hält nur an), darum zählt die Zeit in Pausen nicht mit. Ohne
    Pausen einfach wand_ms - start, wie vor 2.0.3."""
    start = meta.get("start") or 0
    weg = 0
    for von, bis in meta.get("pausen") or []:
        bis = wand_ms if bis is None else min(bis, wand_ms)
        if bis > von:
            weg += bis - von
    return max(0, int(wand_ms) - start - weg)


def _pausen_zeilen(meta: dict) -> list[str]:
    """„- bei 01:12:30 (25 min)": wo im Ton eine Pause war - Claude soll
    wissen, dass Gespräch dort abreißt und Zeit vergangen ist."""
    zeilen = []
    for von, bis in meta.get("pausen") or []:
        if bis is None or bis <= von:
            continue
        minuten = max(1, round((bis - von) / 60000))
        zeilen.append(f"- bei {uhrzeit(ton_ms(meta, von))} ({minuten} min)")
    return zeilen


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
        # Protokoll des Abends davor (Game.protokoll_vorher) - von app.py gesetzt.
        self.vorgeschichte_quelle = lambda start_ms: None
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
            # [[von, bis], ...] Wanduhr-ms; bis = None, solange die Pause läuft.
            "pausen": [],
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
        self.aktiv["dauerMs"] = ton_ms(self.aktiv, self._letztes_stueck)
        return True

    def pause(self, an: bool) -> bool:
        """⏸/▶ (Kalle 07.11.2026: Pizza, Raucherpause). Der Browser hält den
        MediaRecorder nur an - die Tondatei bleibt EINE, ohne Lücke, und daraus
        wird EINE Mitschrift; „genau" wartet weiter aufs ■ Beenden. Weil die
        Pause im Ton fehlt, zählen Marken und Kampfzeiten ab hier ohne sie
        (siehe ton_ms), sonst lägen sie nach der Pause zu spät im Transkript."""
        a = self.aktiv
        if not a:
            return False
        pausen = a.setdefault("pausen", [])
        offen = bool(pausen) and pausen[-1][1] is None
        jetzt = now_ms()
        if an and not offen:
            pausen.append([jetzt, None])
        elif not an and offen:
            pausen[-1][1] = jetzt
        else:
            return True
        self._meta_schreiben(a)
        return True

    @property
    def pausiert(self) -> bool:
        p = (self.aktiv or {}).get("pausen") or []
        return bool(p) and p[-1][1] is None

    def stoppen(self, game=None) -> Optional[dict]:
        meta = self.aktiv
        if not meta:
            return None
        if game is not None:
            self.beobachten(game)
        # Ende = letztes angekommenes Stück, nicht „jetzt": nach einem Absturz
        # käme sonst die ganze Zeit bis zum Neustart als Tonlänge dazu.
        ende_ms = max(self._letztes_stueck, meta["start"])
        # In der Pause beendet: die Pause endet mit dem letzten Ton.
        for p in meta.get("pausen") or []:
            if p[1] is None:
                p[1] = max(p[0], ende_ms)
        if self._war_im_kampf:
            self._ereignis({"art": "kampf_ende", "runden": self._runden}, ende_ms)
        meta["ende"] = ende_ms
        meta["dauerMs"] = ton_ms(meta, ende_ms)
        self._meta_schreiben(meta)
        self.aktiv = None
        self._war_im_kampf = False
        return meta

    def marke(self, text: str = "") -> bool:
        """SL tippt 📌: „das hier war wichtig" - kommt betont ins Protokoll."""
        if not self.aktiv or self.pausiert:
            return False
        self._ereignis({"art": "marke", "text": str(text or "")[:200]})
        self._meta_schreiben(self.aktiv)
        return True

    def marke_text(self, text: str) -> bool:
        """Stichwort zur zuletzt gemerkten Stelle nachtragen (der SL tippt es
        nach dem 📌 ein - die Zeit bleibt die vom Tipp, nicht vom Schreiben)."""
        if not self.aktiv:
            return False
        marken = [e for e in self.aktiv["ereignisse"] if e.get("art") == "marke"]
        if not marken:
            return False
        marken[-1]["text"] = " ".join(str(text or "").split())[:200]
        self._meta_schreiben(self.aktiv)
        return True

    def stimme(self, figur: str) -> bool:
        """Stimm-Anmeldung: der SL tippt eine Figur (oder „Spielleiter"), und
        die Person sagt ein, zwei Sätze. Nach dem genauen Durchgang bekommt
        der Sprecher, der in diesem Fenster redet, sicher diesen Namen -
        statt ihn über Umwege zu raten (sprecher_raten)."""
        figur = " ".join(str(figur or "").split())[:60]
        if not self.aktiv or not figur:
            return False
        self._ereignis({"art": "stimme", "figur": figur})
        self._meta_schreiben(self.aktiv)
        return True

    def _ereignis(self, e: dict, zeit_ms: Optional[int] = None) -> None:
        t = ton_ms(self.aktiv, zeit_ms if zeit_ms is not None else now_ms())
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
                "pausiert": self.pausiert,
                "marken": sum(1 for e in a["ereignisse"] if e.get("art") == "marke"),
                "stimmen": [e.get("figur") for e in a["ereignisse"] if e.get("art") == "stimme"],
            },
            "stimmenBekannt": sorted(self.stimmprofile()),
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
                dauer = max(dauer, ton_ms(meta, int(audio.stat().st_mtime * 1000)))
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
                  self.ordner / f"{name}-live.txt", self.ordner / f"{name}-stimmen.json"]:
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
        vorschlaege = [SPIELLEITER] + [figur_label(figur, sp)
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
            # Vom SL bestätigt = sicher: diese Stimmen beim nächsten Abend erkennen.
            self.stimmen_lernen(name, sauber, meta)
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
        try:
            vorher = self.vorgeschichte_quelle(meta.get("start"))
        except Exception:
            vorher = None
        p = baue_prompt(meta, text, extra, begriffe=begriffe, sprecher=sprecher, vorgeschichte=vorher)
        try:
            if speichern:
                (self.ordner / f"{name}-transkript.txt").write_text(text, encoding="utf-8")
            (self.ordner / f"{name}-prompt.txt").write_text(p, encoding="utf-8")
        except OSError:
            pass
        return p


    # --- Stimmprofile (über Abende) -------------------------------------------------

    @property
    def _profile_pfad(self) -> Path:
        # Neben den Aufnahmen, nicht darin: löscht der SL alle Aufnahmen,
        # bleiben die Stimmen trotzdem bekannt.
        return self.ordner.parent / "stimmprofile.json"

    def stimmprofile(self) -> dict:
        try:
            d = json.loads(self._profile_pfad.read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _profile_schreiben(self, profile: dict) -> None:
        try:
            self._profile_pfad.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._profile_pfad.with_suffix(".tmp")
            tmp.write_text(json.dumps(profile), encoding="utf-8")
            tmp.replace(self._profile_pfad)
        except OSError:
            pass

    def abdruecke_speichern(self, name: str, abdruecke: dict) -> None:
        if not name_gueltig(name) or not abdruecke:
            return
        try:
            (self.ordner / f"{name}-stimmen.json").write_text(json.dumps(abdruecke), encoding="utf-8")
        except OSError:
            pass

    def abdruecke(self, name: str) -> dict:
        try:
            d = json.loads((self.ordner / f"{name}-stimmen.json").read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def stimmen_lernen(self, name: str, namen: dict, meta: dict) -> None:
        """Bestätigte Zuordnung ins Profil. Je Aufnahme und Sprecher nur einmal
        (meta „stimmenGelernt", schreibt der Aufrufer) - sonst zählte derselbe
        Abend doppelt, wenn der SL die automatische Zuordnung nur bestätigt."""
        abdr = self.abdruecke(name)
        schon = meta.setdefault("stimmenGelernt", {})
        neu = {sp: wer for sp, wer in (namen or {}).items() if schon.get(sp) != wer}
        if not abdr or not neu:
            return
        profile = self.stimmprofile()
        if profile_lernen(profile, abdr, neu):
            self._profile_schreiben(profile)
            schon.update(neu)

    def sprecher_automatisch(self, name: str) -> bool:
        """Nach dem genauen Durchgang: Sprecher selbst zuordnen (Kalle: „will
        nicht alles selber auswählen"). Nur wenn noch niemand zugeordnet hat;
        „Wer ist wer?" zeigt das Ergebnis vorausgewählt zum Korrigieren."""
        meta = self._meta(name)
        text = self._text(name, "genau")
        if not meta or text is None or (meta.get("sprecher") or {}).get("genau"):
            return False
        # Gemerkte Stimmen: nur Personen, die heute dabei sein können (SL und
        # die Figuren aus der App) - sonst bekäme ein Gast den Namen von Tims
        # alter Figur aus einer anderen Kampagne.
        erlaubt = {SPIELLEITER} | {f for f in (meta.get("personen") or {}) if f}
        bekannt = profile_zuordnen(self.abdruecke(name), self.stimmprofile(), erlaubt)
        namen = sprecher_raten(text, meta, bekannt=bekannt)
        if not namen:
            return False
        # Sicher Erkanntes lernen: die Stimm-Anmeldung von heute.
        angemeldet = stimmen_zuordnen(_transkript_zeilen(text), meta)
        self.stimmen_lernen(name, {sp: namen[sp] for sp in angemeldet if sp in namen}, meta)
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


# --- Stimmen über Abende merken ---------------------------------------------------
# Kalle 02.11.2026: einmal anmelden, danach erkennt die App jeden von selbst.
# Je Person ein Stimmabdruck (TitaNet, sprache.stimm_abdruecke), gelernt aus der
# Stimm-Anmeldung und aus „Wer ist wer?". Beim nächsten Abend wird jeder Sprecher
# mit den Profilen verglichen. Schwelle: im Live-Test lag dieselbe Person bei
# 0,57–0,91, verschiedene bei höchstens 0,29 (STIMME_GLEICH in sprache.py).
STIMME_BEKANNT = 0.55
PROFIL_GEWICHT_MAX = 10   # neue Abende verschieben das Profil weiter etwas


def _einheit(v) -> list[float]:
    import math
    try:
        v = [float(x) for x in v]
    except (TypeError, ValueError):
        return []
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n else []


def figur_label(figur: str, spieler: str = "") -> str:
    """„Korgo (Tim)" - ohne Klammer, wenn kein Spielername da ist oder er
    gleich der Figur ist (wer am Handy nur die Figur antippt, heißt wie sie;
    im Test 02.11.2026 stand sonst „Mira (Mira)" im Prompt)."""
    return f"{figur} ({spieler})" if spieler and spieler.strip().lower() != figur.strip().lower() else figur


def profil_schluessel(label: str) -> str:
    """„Korgo (Tim)" -> „Korgo": Profile hängen an der Figur bzw. „Spielleiter"."""
    return re.sub(r"\s*\(.*\)\s*$", "", str(label or "")).strip()


def profile_zuordnen(abdruecke: dict, profile: dict, erlaubt) -> dict:
    """{Sprecher: Profilname} - jeweils das ähnlichste Paar zuerst, jede
    Person und jeder Sprecher höchstens einmal, nur über STIMME_BEKANNT."""
    paare = []
    for sp, v in (abdruecke or {}).items():
        a = _einheit(v)
        if not a or not _SPRECHER_MUSTER.match(str(sp)):
            continue
        for wer, p in (profile or {}).items():
            b = _einheit((p or {}).get("v") or [])
            if wer in erlaubt and len(b) == len(a):
                paare.append((sum(x * y for x, y in zip(a, b)), sp, wer))
    erg: dict[str, str] = {}
    for aehnlich, sp, wer in sorted(paare, reverse=True):
        if aehnlich < STIMME_BEKANNT:
            break
        if sp not in erg and wer not in erg.values():
            erg[sp] = wer
    return erg


def profile_lernen(profile: dict, abdruecke: dict, namen: dict) -> bool:
    """namen = {Sprecher: Name}. Profil = gleitender Mittelwert der Abende."""
    geaendert = False
    for sp, label in (namen or {}).items():
        wer = profil_schluessel(label)
        v = _einheit((abdruecke or {}).get(sp) or [])
        if not wer or not v or _SPRECHER_MUSTER.match(wer):
            continue
        alt = profile.get(wer) or {}
        alt_v, n = _einheit(alt.get("v") or []), int(alt.get("n") or 0)
        if len(alt_v) == len(v) and n:
            v = _einheit([a * n + b for a, b in zip(alt_v, v)])
        profile[wer] = {"v": [round(x, 5) for x in v], "n": min(n + 1, PROFIL_GEWICHT_MAX), "stand": now_ms()}
        geaendert = True
    return geaendert


def _transkript_zeilen(transkript: str) -> list[tuple]:
    zeilen = []
    for z in transkript.splitlines():
        m = _ZEILE.match(z.strip())
        if m:
            zeilen.append((_sekunden(m.group(1)), m.group(2), m.group(3)))
    return zeilen


def sprecher_raten(transkript: str, meta: dict, bekannt: Optional[dict] = None) -> dict:
    """S00, S01 … -> „Spielleiter", „Korgo (Tim)" aus dem Kontext:
    - Spielleiter = wer am meisten redet (erzählt, spricht alle NSCs).
    - Spieler sagen ihre Figur selbst an („Korgo zieht seine Axt") - nennt ein
      Sprecher (nicht der SL) eine Figur, zählt das für sie; am Satzanfang mehr.
      „Tessa, hilf mir!" (Name + Komma) ist Anreden, zählt nicht.
    - Spricht der SL eine Figur an („Korgo, was machst du?"), antwortet meist
      deren Spieler: der nächste andere Sprecher bekommt einen Punkt.
    - Im Kampf redet, wessen Zug es ist (Zug-Ereignisse der App).
    Jede Figur höchstens einmal, nur bei klarem Vorsprung; Rest bleibt S0x
    (der Prompt lässt Claude dann über den Inhalt zuordnen).
    bekannt: {Sprecher: Name} aus gemerkten Stimmen früherer Abende - zählt
    nach der Stimm-Anmeldung dieses Abends, aber vor allem Raten."""
    zeilen = _transkript_zeilen(transkript)
    if not zeilen:
        return {}
    zeichen: dict[str, int] = {}
    for _, sp, t in zeilen:
        zeichen[sp] = zeichen.get(sp, 0) + len(t)
    sl = max(zeichen, key=zeichen.get)
    erg = {sl: SPIELLEITER}
    figuren = {f: (sp or "") for f, sp in (meta.get("personen") or {}).items() if f}
    if not figuren and not bekannt and not any(e.get("art") == "stimme" for e in meta.get("ereignisse", [])):
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
                # Angesprochen („Korgo, pass auf!", „Mira, was machst du?"):
                # antworten tut meist die Figur - der nächste andere Sprecher.
                # Im Charakter (Kalle: „ich gehe da hin …") ist das oft der
                # einzige Hinweis, außer wessen Zug es ist.
                if angesprochen or (sp == sl and satz.rstrip().endswith("?")):
                    nach = next((z for z in zeilen[i + 1:i + 4] if z[1] not in (sl, sp)), None)
                    if nach and nach[0] - t0 <= 30:
                        plus(nach[1], f, 1.0)
                elif sp != sl:
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
    # Stimm-Anmeldung schlägt alles Raten: wer im Fenster nach dem Tipp am
    # meisten redet, IST diese Person. Fenster bis zum nächsten Tipp,
    # höchstens STIMM_FENSTER_S Sekunden.
    sicher = list(stimmen_zuordnen(zeilen, meta).items())
    # Gemerkte Stimmen (frühere Abende) danach - die Anmeldung von heute gewinnt.
    sicher += [(sp, f) for sp, f in (bekannt or {}).items() if sp not in dict(sicher)]
    for sp, f in sicher:
        if sp in vergeben or f in figur_weg:
            continue
        if f == SPIELLEITER:
            if erg.get(sp) != SPIELLEITER:
                # Der Vielredner war doch nicht der SL - umbenennen.
                for k in [k for k, v in erg.items() if v == SPIELLEITER]:
                    del erg[k]
                erg[sp] = SPIELLEITER
            sl = sp
        elif f in figuren:
            erg[sp] = figur_label(f, figuren[f])
        else:
            erg[sp] = f
        vergeben.add(sp)
        figur_weg.add(f)
    for (sp, f), p in sorted(punkte.items(), key=lambda x: -x[1]):
        if sp in vergeben or sp == sl or f in figur_weg or p < 2.0:
            continue
        # Klarer Vorsprung vor der zweitbesten Figur dieses Sprechers.
        andere = max((q for (s2, f2), q in punkte.items() if s2 == sp and f2 != f and f2 not in figur_weg),
                     default=0.0)
        if p < 1.5 * andere:
            continue
        erg[sp] = figur_label(f, figuren[f])
        vergeben.add(sp)
        figur_weg.add(f)
    return erg


STIMM_FENSTER_S = 20


def stimmen_zuordnen(zeilen: list[tuple], meta: dict) -> dict:
    """Stimm-Anmeldung auswerten: {Sprecher: Figur}. zeilen wie in
    sprecher_raten [(sekunde, sprecher, text)]. Ein Sprecher braucht im
    Fenster klar die meiste Rede (zwei Drittel), sonst bleibt es offen -
    redet jemand dazwischen, lieber nicht zuordnen als falsch."""
    marken = [(e["t"] / 1000, e.get("figur")) for e in meta.get("ereignisse", [])
              if e.get("art") == "stimme" and e.get("figur")]
    erg: dict[str, str] = {}
    for k, (ab, f) in enumerate(marken):
        bis = min(ab + STIMM_FENSTER_S, marken[k + 1][0] if k + 1 < len(marken) else ab + STIMM_FENSTER_S)
        rede: dict[str, int] = {}
        # Etwas Spielraum nach vorn: der Tipp kommt oft, wenn sie schon spricht.
        for t0, sp, text in zeilen:
            if ab - 2 <= t0 < bis:
                rede[sp] = rede.get(sp, 0) + len(text)
        if not rede:
            continue
        sp = max(rede, key=rede.get)
        if rede[sp] * 3 >= sum(rede.values()) * 2 and sp not in erg:
            erg[sp] = f
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


VORGESCHICHTE_MAX = 6000   # Zeichen vom letzten Protokoll (2 Seiten sind ~6000)


def baue_prompt(meta: dict, transkript: str, extra: str = "", begriffe: Optional[list] = None,
                sprecher: Optional[dict] = None, vorgeschichte: Optional[dict] = None) -> str:
    datum = time.strftime("%d.%m.%Y", time.localtime((meta.get("start") or now_ms()) / 1000))
    personen = meta.get("personen") or {}
    namen = [f"- {figur}" + (f" (gespielt von {sp})" if sp and sp.lower() != figur.lower() else "")
             for figur, sp in sorted(personen.items())]
    kaempfe = _kampf_zeilen(meta.get("ereignisse", []))
    marken = [f"- {uhrzeit(e['t'])}" + (f": {e['text']}" if e.get("text") else "")
              for e in meta.get("ereignisse", []) if e.get("art") == "marke"]
    teile = [
        f"Du bist Chronist einer Pen-&-Paper-Runde (Savage Worlds: Sundered Skies). "
        f"Unten steht das automatische Transkript des Spielabends vom {datum}. "
        "Erzähl daraus nach, welche Geschichte die Gruppe an diesem Abend erlebt hat – auf Deutsch, "
        "höchstens 2 DIN-A4-Seiten (etwa 1000 Wörter, alles zusammen).",
        "",
        "SO SOLL ES SEIN:",
        "- Eine zusammenhängende Nacherzählung des ganzen Abends, in der Vergangenheit, wie ein Kapitel "
        "einer Chronik: Anfang, Höhepunkte, wo die Gruppe am Ende steht.",
        "- Nur was in der Spielwelt passiert. Regelfragen, Würfelwerte, Pausen und Gespräche außerhalb des Spiels weglassen.",
        "- Kämpfe als Teil der Geschichte: spannende oder krasse Momente erzählen (knappe Rettung, "
        "Volltreffer, jemand geht zu Boden, ein Joker im richtigen Moment). Keinen Rundenablauf.",
        "- Ganz am Ende, kurz: wichtige NSCs, Beute/Belohnungen, offene Fäden für nächstes Mal.",
        "- Ganz oben als erste Zeile ein kurzer, stimmungsvoller Titel für den Abend: „# Titel“.",
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
        "- Gespielt wird meist im Charakter: „ich gehe zur Tür und …“ heißt, die Figur des Sprechers "
        "tut das. In der Nacherzählung mit dem Figurennamen in der dritten Person.",
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
        teile += ["", "KÄMPFE (laut Initiative-App, Zeit ab Aufnahmebeginn – zum Einordnen; die Höhepunkte stehen im Transkript):", *kaempfe]
    if marken:
        teile += ["", "VOM SPIELLEITER MARKIERTE MOMENTE (besonders erwähnen):", *marken]
    pausen = _pausen_zeilen(meta)
    if pausen:
        teile += ["", "PAUSEN (Aufnahme angehalten – dort ist Zeit vergangen, das Gespräch kann abreißen):", *pausen]
    if extra and extra.strip():
        teile += ["", "HINWEISE DES SPIELLEITERS:", extra.strip()[:2000]]
    # Das Protokoll vom letzten Mal: damit Namen, Orte und offene Fäden gleich
    # geschrieben werden und die Geschichte anschließt. Nicht nacherzählen.
    if vorgeschichte and str(vorgeschichte.get("text") or "").strip():
        wann = str(vorgeschichte.get("datum") or "")
        wann = f" vom {wann[8:10]}.{wann[5:7]}.{wann[:4]}" if len(wann) == 10 else ""
        teile += ["", f"WAS BISHER GESCHAH (Protokoll des letzten Abends{wann} – nur zum Anschließen, "
                      "nicht noch einmal nacherzählen; Namen und Schreibweisen von dort übernehmen):",
                  "<<<", str(vorgeschichte["text"]).strip()[:VORGESCHICHTE_MAX], ">>>"]
    teile += ["", "TRANSKRIPT:", "<<<", sprecher_einsetzen(transkript.strip(), sprecher or {}), ">>>"]
    return "\n".join(teile) + "\n"
