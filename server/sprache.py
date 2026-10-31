"""Spracherkennung für die Spielabend-Aufnahme: live mitschreiben und danach
genau transkribieren - beides in der App, lokal und ohne Konto.

Vorgeschichte: Erst lief das über noScribe (fremdes Programm, 3 GB), dann über
einen eigenen „Transkribierer" als Extra-Download (1.5.25). Kalle wollte ihn
„mit drin haben, auch wenn ich aktualisiere" - darum steckt er jetzt hier, und
die Modelle liegen in ``data/modelle``: das Aktualisieren tauscht nur die
Programmdateien, ``data`` bleibt (aktualisieren.py, BEHALTEN).

Alles über sherpa-onnx (ONNX auf der CPU, kein PyTorch, keine Grafikkarte):
- Silero-VAD: wo überhaupt gesprochen wird (live und danach).
- pyannote-Segmentierung + TitaNet-Stimmabdruck: wer spricht wann. pyannote
  selbst verlangt ein Hugging-Face-Konto mit Lizenz-Klick - die ONNX-Fassungen
  liegen frei auf GitHub (k2-fsa/sherpa-onnx).
- Parakeet TDT 0.6B v3 (NVIDIA, 25 Sprachen inkl. Deutsch): der Text. Whisper
  „turbo" war vorher drin, rechnet aber jedes Stück auf 30 s aufgefüllt: live
  so langsam wie der Ton selbst, danach Faktor ~0,8 (ThinkPad 3–5 h für einen
  Abend). Parakeet brauchte im Test ein Siebtel und verhörte sich nicht öfter;
  dazu Wort-Zeitstempel, mit denen live ein Aufruf je Stück reicht.

Ton kommt aus der laufenden App-Aufnahme (webm/Opus, PyAV dekodiert): kein
zweiter Zugriff aufs Mikro, und live und danach hören exakt dasselbe.

Feinschliff 31.10.2026 (Kalle: „will dass es echt richtig gut ist"), gemessen
an einem nachgebauten Tisch (4 Piper-Stimmen, verschieden weit weg, Hall,
50-Hz-Brummen, Rauschen; Wortfehler vorher 39 %):
- Hochpass 100 Hz (Brummen, Tischklopfen, Trittschall) - half (−5 Punkte).
  Rauschunterdrückung (ffmpeg afftdn) machte es doppelt so schlecht,
  Lautstärke angleichen (speechnorm/dynaudnorm) ebenfalls schlechter - beides
  bewusst NICHT drin.
- Danach nicht mehr nur das, was die Sprechertrennung findet: die verlor am
  Tisch ein Fünftel der Sprache (leise Leute am Tischende). Jetzt findet die
  VAD die Sprache (100 %), die Sprechertrennung sagt nur noch, wer es war.
- Eigennamen aus der App (server/namen.py), englischer Unsinn aus Rauschen
  fliegt raus, Personenzahl aus der App.

Runde 2 (Kalle: „soll wirklich top sein", darf bis 4 GB): Danach hören zwei
Erkenner zu. Canary 180M (fest auf Deutsch, kann nicht ins Englische
rutschen) liefert den Text, Parakeet die Wort-Zeiten (für die Sprecher) und
die Wörter, die Canary nach einem Sprecherwechsel verschluckt. Tisch-Test
21,5 % -> 15,3 %, sauber 14,1 % -> 10,2 %. Kostet etwa doppelte Rechenzeit.
Whisper large-v3 (wie in noScribe) lief 9x langsamer als Echtzeit - raus.

Die schweren Pakete (sherpa_onnx, numpy, av) werden erst bei Gebrauch geladen:
der Server startet auch ohne sie, und die Spieler-Handys merken nichts davon.
"""

from __future__ import annotations

import json
import os
import re
import tarfile
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

SR = 16000                      # alle Modelle wollen 16 kHz mono
HOCHPASS_HZ = 100               # 60 Hz ließ das Brummen drin, 120 Hz brachte nichts mehr
MAX_STUECK_S = 28.0             # danach: so lang höchstens am Stück erkennen
LUECKE_ZUSAMMEN_S = 1.0         # gleicher Sprecher, Pause darunter -> ein Beitrag
# Stille um jedes Stück: ohne sie verschluckte die Erkennung im Test das letzte
# Wort jedes Beitrags („… der im Nebel" statt „… der im Nebel schwebt").
STILLE_VORNE_S, STILLE_HINTEN_S = 0.2, 1.0
# Live:
LIVE_STUECK_MAX_S = 12.0        # länger -> Text kommt zu spät
RUECKSTAU_MAX_S = 60.0          # so viel Sprache darf warten, sonst überspringen
# Gleiche Stimme, wenn Kosinus-Ähnlichkeit darüber. Im Test (3 Stimmen, 2
# männlich) lag dieselbe Person bei 0,57–0,91, verschiedene bei höchstens 0,29.
STIMME_GLEICH = 0.5
MAX_LEUTE_UNBEKANNT = 8
MIN_NEUE_STIMME_S = 1.0         # aus Fetzen keinen neuen Sprecher anlegen

_GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
# Name -> (Download-URL, Datei/Ordner im Modellordner, ungefähre MB). Alles
# öffentlich auf GitHub, kein Konto. Archive werden entpackt.
MODELLE = {
    "vad": (f"{_GH}/asr-models/silero_vad.onnx", "silero_vad.onnx", 2),
    "segmentierung": (f"{_GH}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
                      "sherpa-onnx-pyannote-segmentation-3-0", 6),
    # TitaNet trennte im Test als einziges alle drei Stimmen; WeSpeaker und
    # 3D-Speaker legten die beiden Männer zusammen.
    "stimme": (f"{_GH}/speaker-recongition-models/nemo_en_titanet_small.onnx",
               "nemo_en_titanet_small.onnx", 40),
    "text": (f"{_GH}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
             "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", 490),
    # Canary für den Durchgang danach: fest auf Deutsch eingestellt. Parakeet
    # wählt die Sprache selbst und rutschte am (nachgebauten) Tisch bei leisen
    # Leuten ins Englische; Canary hatte dort 18,6 % statt 27,7 % Wortfehler,
    # bei gleichem Tempo. Kein Wort-Zeitstempel - darum live weiter Parakeet.
    # Whisper large-v3 (1,8 GB) war 9x langsamer als Echtzeit: 36 h pro Abend.
    "genau": (f"{_GH}/asr-models/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8.tar.bz2",
              "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8", 200),
}
# Ohne diese läuft nichts. „genau" kam mit 1.5.28 dazu - wer schon
# eingerichtet hat, soll live nicht verlieren, bis er nachlädt.
PFLICHT = ("vad", "segmentierung", "stimme", "text")


def uhrzeit(s: float) -> str:
    s = max(0, int(s))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def _namen_korrektur(namen):
    from .namen import Namenskorrektur
    return Namenskorrektur(namen or [])


_PAKETE: Optional[bool] = None


def pakete_da() -> bool:
    """Steckt die Spracherkennung im Paket? (Entwickler-.venv ohne: nein.)
    Einmal prüfen und merken - der erste Import dauert eine halbe Sekunde."""
    global _PAKETE
    if _PAKETE is None:
        try:
            import av  # noqa: F401
            import numpy  # noqa: F401
            import sherpa_onnx  # noqa: F401
            _PAKETE = True
        except Exception:
            _PAKETE = False
    return _PAKETE


# --- Modelle ----------------------------------------------------------------------

def modelle_fehlen(ordner: Path) -> list[str]:
    return [n for n, (_, ziel, _) in MODELLE.items() if not (ordner / ziel).exists()]


def canary_da(ordner: Path) -> bool:
    return (ordner / MODELLE["genau"][1]).exists()


def _laden(url: str, ziel: Path, fortschritt: Callable[[int], None], stopp: threading.Event) -> None:
    tmp = ziel.with_name(ziel.name + ".teil")
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
        while True:
            if stopp.is_set():
                raise InterruptedError
            block = r.read(1 << 20)
            if not block:
                break
            f.write(block)
            fortschritt(len(block))
    tmp.replace(ziel)


def modelle_laden(ordner: Path, fortschritt: Callable[[int, int], None],
                  stopp: Optional[threading.Event] = None) -> None:
    """Fehlende Modelle holen. fortschritt(geladen_bytes, gesamt_bytes) - gesamt
    nur geschätzt (MB-Angaben oben), reicht für einen Balken."""
    stopp = stopp or threading.Event()
    ordner.mkdir(parents=True, exist_ok=True)
    fehlen = modelle_fehlen(ordner)
    gesamt = sum(MODELLE[n][2] for n in fehlen) * 1024 * 1024
    stand = {"b": 0}

    def weiter(n: int) -> None:
        stand["b"] += n
        fortschritt(min(stand["b"], gesamt), gesamt)
    for name in fehlen:
        url, ziel_name, _ = MODELLE[name]
        ziel = ordner / ziel_name
        if url.endswith(".tar.bz2"):
            archiv = ordner / (ziel_name + ".tar.bz2")
            _laden(url, archiv, weiter, stopp)
            # Erst in einen Nebenordner entpacken, dann umbenennen: bricht es
            # mittendrin ab, gilt das Modell nicht als vorhanden.
            tmp = ordner / (ziel_name + ".auspacken")
            with tarfile.open(archiv, "r:bz2") as t:
                t.extractall(tmp, filter="data")
            (tmp / ziel_name).replace(ziel)
            tmp.rmdir()
            archiv.unlink()
        else:
            _laden(url, ziel, weiter, stopp)


# --- Ton ----------------------------------------------------------------------------

class Hochpass:
    """ffmpeg-Hochpass (über PyAV, kein scipy nötig) für Blöcke 16 kHz mono.
    Läuft am Stück weiter: live kommt Block für Block, der Filter merkt sich
    den Zustand dazwischen. In Python Sample für Sample wäre es für 4 h Ton
    viel zu langsam."""

    def __init__(self, hz: int = HOCHPASS_HZ) -> None:
        import av
        from fractions import Fraction
        self._av = av
        self._tb = Fraction(1, SR)
        g = av.filter.Graph()
        knoten = [g.add_abuffer(format="flt", sample_rate=SR, layout="mono", time_base=self._tb),
                  g.add("highpass", f"f={hz}"),
                  g.add("aformat", "sample_fmts=flt:channel_layouts=mono"),
                  g.add("abuffersink")]
        for a, b in zip(knoten, knoten[1:]):
            a.link_to(b)
        g.configure()
        self.g = g
        self.pts = 0

    def _abholen(self) -> list:
        aus = []
        while True:
            try:
                aus.append(self.g.pull().to_ndarray().reshape(-1))
            except (self._av.BlockingIOError, self._av.EOFError):
                return aus

    def durch(self, block):
        import numpy as np
        if not len(block):
            return np.zeros(0, dtype=np.float32)
        f = self._av.AudioFrame.from_ndarray(np.ascontiguousarray(block, dtype=np.float32).reshape(1, -1),
                                             format="flt", layout="mono")
        f.sample_rate, f.pts, f.time_base = SR, self.pts, self._tb
        self.pts += len(block)
        self.g.push(f)
        aus = self._abholen()
        return np.concatenate(aus).astype(np.float32) if aus else np.zeros(0, dtype=np.float32)

    def ende(self):
        import numpy as np
        try:
            self.g.push(None)
        except Exception:
            pass
        aus = self._abholen()
        return np.concatenate(aus).astype(np.float32) if aus else np.zeros(0, dtype=np.float32)


def hochpass(ton):
    """Ganze Aufnahme durch den Hochpass (sekundenweise, wie live)."""
    import numpy as np
    hp = Hochpass()
    teile = [hp.durch(ton[i:i + SR]) for i in range(0, len(ton), SR)] + [hp.ende()]
    return np.concatenate(teile).astype(np.float32) if teile else ton


def ton_laden(pfad: Path, aufbereiten: bool = True):
    """Tondatei -> 16 kHz mono float32 (PyAV bringt ffmpeg mit)."""
    import av
    import numpy as np
    teile = []
    with av.open(str(pfad)) as c:
        res = av.AudioResampler(format="flt", layout="mono", rate=SR)
        for frame in c.decode(audio=0):
            for f in res.resample(frame):
                teile.append(f.to_ndarray().reshape(-1))
        for f in res.resample(None):
            teile.append(f.to_ndarray().reshape(-1))
    if not teile:
        return np.zeros(0, dtype=np.float32)
    ton = np.concatenate(teile).astype(np.float32)
    return hochpass(ton) if aufbereiten else ton


class Mitlesen:
    """Liest die Tondatei, während der Browser noch Stücke anhängt (wie
    „tail -f"): am Dateiende wird gewartet statt aufgehört, bis die Aufnahme
    vorbei ist. Für PyAV ein ganz normales Datei-Objekt."""

    def __init__(self, pfad: Path, laeuft: Callable[[], bool], stopp: threading.Event) -> None:
        self.f = open(pfad, "rb")
        self.laeuft = laeuft
        self.stopp = stopp

    def read(self, n: int = -1) -> bytes:
        while True:
            b = self.f.read(n if n and n > 0 else 1 << 16)
            if b:
                return b
            if self.stopp.is_set() or not self.laeuft():
                return self.f.read(n if n and n > 0 else 1 << 16)
            time.sleep(0.3)

    def close(self) -> None:
        self.f.close()


def ton_mitlesen(pfad: Path, laeuft: Callable[[], bool], stopp: threading.Event, format: str = "webm"):
    """Blöcke (16 kHz mono float32) aus der wachsenden Aufnahme."""
    import av
    import numpy as np
    quelle = Mitlesen(pfad, laeuft, stopp)
    hp = Hochpass()
    try:
        with av.open(quelle, format=format, mode="r") as c:
            res = av.AudioResampler(format="flt", layout="mono", rate=SR)
            for frame in c.decode(audio=0):
                for f in res.resample(frame):
                    block = hp.durch(f.to_ndarray().reshape(-1).astype(np.float32))
                    if len(block):
                        yield block
                if stopp.is_set():
                    return
        rest = hp.ende()
        if len(rest):
            yield rest
    finally:
        quelle.close()


# --- Sprecher-Abschnitte (danach) --------------------------------------------------

@dataclass
class Abschnitt:
    start: float
    ende: float
    sprecher: int
    text: str = ""


def zusammenlegen(segmente: list[Abschnitt], luecke: float = LUECKE_ZUSAMMEN_S) -> list[Abschnitt]:
    """Aufeinanderfolgende Stücke desselben Sprechers mit kurzer Pause zu einem
    Beitrag verbinden - die Sprechertrennung liefert oft Halbsätze."""
    erg: list[Abschnitt] = []
    for s in sorted(segmente, key=lambda x: x.start):
        if erg and erg[-1].sprecher == s.sprecher and s.start - erg[-1].ende <= luecke:
            erg[-1].ende = max(erg[-1].ende, s.ende)
        else:
            erg.append(Abschnitt(s.start, s.ende, s.sprecher))
    return erg


def zerteilen(a: Abschnitt, max_s: float = MAX_STUECK_S) -> list[tuple[float, float]]:
    """Lange Beiträge (SL erzählt minutenlang) in handliche Stücke."""
    stuecke, t = [], a.start
    while t < a.ende:
        e = min(a.ende, t + max_s)
        # Kein Reststück unter 2 s: aus Fetzen wird gern Unsinn.
        if a.ende - e < 2.0:
            e = a.ende
        stuecke.append((t, e))
        t = e
    return stuecke


def sprecher_nummern(abschnitte: list[Abschnitt]) -> dict[int, int]:
    """S00 = wer am meisten redet (meist der SL), dann absteigend."""
    anteil: dict[int, float] = {}
    for a in abschnitte:
        anteil[a.sprecher] = anteil.get(a.sprecher, 0) + (a.ende - a.start)
    return {sp: i for i, sp in enumerate(sorted(anteil, key=lambda k: -anteil[k]))}


# Spracherkenner „hören" in Stille und Rauschen gern Abspann-Floskeln aus ihren
# Trainingsdaten. Die kommen am Spieltisch nie vor.
_FLOSKELN = ("untertitel", "vielen dank fürs zuschauen", "copyright", "amara.org", "swr ", "zdf")
# Parakeet erkennt die Sprache selbst und rutscht bei Rauschen, Lachen oder
# Stuhlrücken ins Englische („How do you", „I love it") - im Tisch-Test kam
# so ein Drittel der Zeilen. Am Tisch wird Deutsch geredet: Zeilen, die fast
# nur aus englischen Wörtern bestehen, fliegen raus. Wörter, die es auch im
# Deutschen gibt (so, in, was, hat, okay, Joker …), zählen nicht.
_ENGLISCH = set("""
the a an and or but you your i i'm i've it it's is are am be been was were to of that this these what
yeah yes no not oh so do does did don't have has had get got go going gonna gotta love like
just know think thing things find how why who where when can could would should will with my me
we they them their there here he she his her our us out up all one about really right well very
that that's what's there's i'll you're we're they're can't won't didn't isn't it'll let's now bye hey for from by if as at on
""".split()) - {"so", "in", "was", "hat", "man", "die", "will", "um", "also", "am", "an", "war", "here"}
_WORT = re.compile(r"[a-zäöüß']+")
_ENGLISCH_NORM = {"".join(c for c in w if c.isalnum()) for w in _ENGLISCH}


def englisch(t: str) -> bool:
    w = _WORT.findall(t.lower())
    if not w or any(c in t for c in "äöüßÄÖÜ"):
        return False
    return sum(x in _ENGLISCH for x in w) / len(w) >= 0.6


# Erkenner-Müll aus dem ersten echten Test (31.10., 1.5.28): Canary schrieb
# bei Klicken/Rascheln „T S F", bei Rauschen „1000000…" - seitenweise.
_BUCHSTABEN = re.compile(r"(?<!\w)(?:[A-Za-zÄÖÜäöü][.,]?\s+){1,}[A-Za-zÄÖÜäöü](?!\w)[.,]?")
_ZIFFERN = re.compile(r"\d{6,}")
_WIEDERHOLT = re.compile(r"\b(\w+)(?:[\s,.]+\1\b){3,}", re.IGNORECASE)
_WORT_MIT_ZEICHEN = re.compile(r"\S+")


def _englisch_wort(w: str) -> bool:
    return _norm(w) in _ENGLISCH_NORM


def ohne_englisch(t: str) -> str:
    """Am Tisch wird nur Deutsch geredet (Kalle). Zwei oder mehr englische
    Wörter am Stück fliegen raus („Yeah, that's all I just"), ein einzelnes
    nur, wenn es allein steht („Yeah.") - „okay", „cool", „Joker" bleiben."""
    teile = _WORT_MIT_ZEICHEN.findall(t)
    eng = [_englisch_wort(w) for w in teile]
    raus = [False] * len(teile)
    i = 0
    while i < len(teile):
        if eng[i]:
            j = i
            while j < len(teile) and eng[j]:
                j += 1
            if j - i >= 2 or len(teile) == 1:
                raus[i:j] = [True] * (j - i)
            i = j
        else:
            i += 1
    return " ".join(w for w, r in zip(teile, raus) if not r)


def text_sauber(t: str) -> str:
    t = " ".join(t.split())
    if any(f in t.lower() for f in _FLOSKELN) or englisch(t):
        return ""
    t = _BUCHSTABEN.sub(" ", t)
    t = _ZIFFERN.sub(" ", t)
    t = _WIEDERHOLT.sub(r"\1", t)
    vorher = len(t.split())
    t = ohne_englisch(t)
    t = re.sub(r"([,.])\1+", r"\1", " ".join(t.split()))
    # Englisch rausgeschnitten und kaum etwas übrig: war wohl alles Unsinn.
    if len(t.split()) < vorher and len(t.split()) < 3:
        return ""
    # Was übrig bleibt, muss nach Sprache aussehen: mindestens ein Wort mit
    # zwei Buchstaben, nicht nur Satzzeichen.
    if not re.search(r"[^\W\d_]{2,}", t) or englisch(t) or kurz_und_fremd(t):
        return ""
    # „Wechselt man sie??" - Canary und Satzzeichen-Modell setzen beide eins.
    return re.sub(r"([?!.,])\1+", r"\1", t)


# Kleine deutsche Wörter, an denen man eine kurze Zeile als Deutsch erkennt.
# Das große Wörterbuch taugt dafür nicht - es kennt auch „fun", „wrong",
# „clean" (Lehnwörter) und keine Zweibuchstaber wie „ja".
_DEUTSCH_KLEIN = set("""
ja ah äh eh oh na nee nein doch genau gut ich du er sie es wir ihr mir dir uns
der die das den dem des ein eine einen und oder aber nicht noch schon mal auch
ist bin bist sind war hat hab habe haben kann muss soll will wo was wer wie
hier da dann jetzt nur so ok okay mhm hm danke bitte gleich weiter los zu mit
""".split())


def kurz_und_fremd(t: str) -> bool:
    """Kurze Zeile mit Englisch und ohne ein deutsches Wort („It's fun.",
    „The wrong closed") - kam im Headset-Test aus Lachen und Babygeschrei.
    englisch() lässt sie durch, weil nur jedes zweite Wort englisch ist."""
    if any(c in t for c in "äöüßÄÖÜ"):
        return False
    w = [x for x in (_norm(y) for y in t.split()) if x]
    if not w or len(w) > 4:
        return False
    return any(x in _ENGLISCH_NORM for x in w) and not any(x in _DEUTSCH_KLEIN for x in w)


def transkript_text(abschnitte: list[Abschnitt]) -> str:
    nummer = sprecher_nummern(abschnitte)
    zeilen = [f"[{uhrzeit(a.start)}] S{nummer[a.sprecher]:02d}: {a.text}"
              for a in abschnitte if a.text]
    return "\n".join(zeilen) + "\n"


# --- Sprecher live wiedererkennen -----------------------------------------------------

class Stimmen:
    """Online-Zuordnung Stimmabdruck -> Sprechernummer. Je Sprecher ein
    Mittelwert der bisherigen Abdrücke (nach Dauer gewichtet)."""

    def __init__(self, max_personen: int = 0, gleich: float = STIMME_GLEICH) -> None:
        self.max_personen = max_personen
        self.gleich = gleich
        self.summen: list = []
        self.zuletzt = 0

    def zuordnen(self, abdruck, dauer: float) -> int:
        import numpy as np
        v = np.asarray(abdruck, dtype=np.float32)
        n = float(np.linalg.norm(v))
        if n == 0:
            return self.zuletzt
        v = v / n
        if self.summen:
            mitten = [s / (np.linalg.norm(s) or 1) for s in self.summen]
            aehnlich = [float(m @ v) for m in mitten]
            best = int(np.argmax(aehnlich))
            voll = self.max_personen and len(self.summen) >= self.max_personen
            if aehnlich[best] >= self.gleich or voll or dauer < MIN_NEUE_STIMME_S:
                # Kurze Fetzen bewegen den Mittelwert nicht (unsicherer Abdruck).
                if dauer >= MIN_NEUE_STIMME_S:
                    self.summen[best] = self.summen[best] + v * min(dauer, 10.0)
                self.zuletzt = best
                return best
        elif dauer < MIN_NEUE_STIMME_S:
            return 0
        self.summen.append(v * min(dauer, 10.0))
        self.zuletzt = len(self.summen) - 1
        return self.zuletzt


def sprecher_um(t: float, teile: list[tuple[float, float, int]]) -> int:
    """Wer redet zur Zeit t? Liegt t in keinem Teil (Atempause), der nächste."""
    for s, e, sp in teile:
        if s <= t <= e:
            return sp
    return min(teile, key=lambda x: min(abs(t - x[0]), abs(t - x[1])))[2]


def woerter_verteilen(tokens: list[str], zeiten: list[float],
                      teile: list[tuple[float, float, int]]) -> list[tuple[float, int, str]]:
    """Erkannte Silben (mit Startzeit) -> Zeilen je Sprecher. Ein Wort beginnt
    mit Leerzeichen und geht als Ganzes an den, der bei seinem Anfang redet -
    sonst zerschnitte ein Sprecherwechsel mitten ins Wort."""
    zeilen: list[list] = []          # [start, sprecher, text]
    for tok, t in zip(tokens, zeiten):
        if zeilen and not tok.startswith(" "):
            zeilen[-1][2] += tok      # Wortrest oder Satzzeichen
            continue
        sp = sprecher_um(t, teile)
        if zeilen and zeilen[-1][1] == sp:
            zeilen[-1][2] += tok
        else:
            zeilen.append([t, sp, tok])
    return [(s, sp, " ".join(text.split())) for s, sp, text in zeilen if text.strip()]


def rueckstau_kuerzen(warteschlange: list, max_s: float = RUECKSTAU_MAX_S) -> int:
    """Älteste wartende Stücke verwerfen, bis höchstens max_s Sprache wartet.
    Einträge: (start_s, ton). Gibt die Zahl verworfener Stücke zurück."""
    weg = 0
    while len(warteschlange) > 1 and sum(len(t) for _, t in warteschlange) / SR > max_s:
        warteschlange.pop(0)
        weg += 1
    return weg


# --- Modelle laden ---------------------------------------------------------------------

def _threads() -> int:
    # Einen Kern frei lassen: der Server muss nebenbei die Handys bedienen.
    return max(1, (os.cpu_count() or 4) - 1)


def _erkenner(ordner: Path, threads: int):
    import sherpa_onnx as so
    d = ordner / MODELLE["text"][1]
    return so.OfflineRecognizer.from_transducer(
        encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.int8.onnx"),
        joiner=str(d / "joiner.int8.onnx"), tokens=str(d / "tokens.txt"),
        model_type="nemo_transducer", num_threads=threads)


def _canary(ordner: Path, threads: int):
    import sherpa_onnx as so
    d = ordner / MODELLE["genau"][1]
    return so.OfflineRecognizer.from_nemo_canary(
        encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.int8.onnx"),
        tokens=str(d / "tokens.txt"), src_lang="de", tgt_lang="de", num_threads=threads)


_LEER_VOR_ZEICHEN = re.compile(r"\s+([.,;:!?])")


def satzzeichen(t: str) -> str:
    """Canary schreibt „Felsen , der" - Leerzeichen vor Satzzeichen weg."""
    return _LEER_VOR_ZEICHEN.sub(r"\1", t)


def _sprechertrennung(ordner: Path, threads: int, personen: int = 0):
    import sherpa_onnx as so
    cfg = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(ordner / MODELLE["segmentierung"][1] / "model.int8.onnx")),
            num_threads=threads),
        embedding=so.SpeakerEmbeddingExtractorConfig(
            model=str(ordner / MODELLE["stimme"][1]), num_threads=threads),
        # Personenzahl bekannt -> genau so viele Stimmen. Sonst Schwelle: höher
        # = weniger Sprecher; 0,7 traf im Test die richtige Zahl.
        clustering=so.FastClusteringConfig(num_clusters=personen if personen > 0 else -1, threshold=0.7),
        min_duration_on=0.3, min_duration_off=0.5)
    return so.OfflineSpeakerDiarization(cfg)


def _erkennen(asr, ton) -> tuple[str, list[str], list[float]]:
    import numpy as np
    vorne = np.zeros(int(STILLE_VORNE_S * SR), dtype=np.float32)
    hinten = np.zeros(int(STILLE_HINTEN_S * SR), dtype=np.float32)
    st = asr.create_stream()
    st.accept_waveform(SR, np.concatenate([vorne, ton, hinten]))
    asr.decode_stream(st)
    r = st.result
    return r.text.strip(), list(r.tokens), [x - STILLE_VORNE_S for x in r.timestamps]


# --- Danach: ganze Aufnahme ---------------------------------------------------------

def _vad(modelle: Path, max_s: float):
    import sherpa_onnx as so
    return so.VoiceActivityDetector(so.VadModelConfig(
        silero_vad=so.SileroVadModelConfig(model=str(modelle / MODELLE["vad"][1]), threshold=0.5,
                                           min_silence_duration=0.5, min_speech_duration=0.25,
                                           max_speech_duration=max_s),
        sample_rate=SR), buffer_size_in_seconds=120)


def sprache_finden(ton, modelle: Path, max_s: float = 20.0,
                   stopp: Optional[threading.Event] = None) -> list[tuple[float, float]]:
    """Wo wird gesprochen? [(start_s, ende_s)], jedes Stück ≤ max_s."""
    vad = _vad(modelle, max_s)
    stuecke: list[tuple[float, float]] = []

    def abholen() -> None:
        while not vad.empty():
            s = vad.front.start / SR
            stuecke.append((s, s + len(vad.front.samples) / SR))
            vad.pop()
    # Genau 512 Samples je Aufruf: mit größeren Brocken verschluckte die VAD
    # im Test die ersten 2 s und hielt die Höchstlänge nicht ein (35-s-Stücke).
    for n, i in enumerate(range(0, len(ton) // 512 * 512, 512)):
        vad.accept_waveform(ton[i:i + 512])
        abholen()
        if n % 2000 == 0 and stopp is not None and stopp.is_set():
            raise InterruptedError
    vad.flush()
    abholen()
    return stuecke


def stueck_zuordnen(s: float, e: float, tokens: list[str], zeiten: list[float],
                    teile: list[tuple[float, float, int]]) -> list[Abschnitt]:
    """Erkannter Text eines VAD-Stücks [s, e] -> Abschnitte je Sprecher. teile:
    die Sprechertrennung über die ganze Aufnahme. Hat sie im Stück niemanden
    gefunden (leise Leute am Tischende), bekommt es der zeitlich nächste -
    lieber falscher Sprecher als verschluckter Text."""
    lokal = [(max(a, s) - s, min(b, e) - s, sp) for a, b, sp in teile if b > s and a < e]
    if not lokal:
        sp = sprecher_um((s + e) / 2, teile) if teile else 0
        lokal = [(0.0, e - s, sp)]
    gruppen = woerter_verteilen(tokens, zeiten, lokal)
    erg = []
    for i, (t, sp, text) in enumerate(gruppen):
        ende = s + gruppen[i + 1][0] if i + 1 < len(gruppen) else e
        erg.append(Abschnitt(s + max(0.0, t), max(s + max(0.0, t), ende), sp, text))
    return erg


def woerter_mit_zeit(tokens: list[str], zeiten: list[float]) -> list[tuple[float, str]]:
    """Parakeet-Silben -> [(startzeit, wort)]."""
    erg: list[list] = []
    for tok, t in zip(tokens, zeiten):
        if erg and not tok.startswith(" "):
            erg[-1][1] += tok
        else:
            erg.append([t, tok.strip()])
    return [(t, w) for t, w in erg if w]


def _norm(w: str) -> str:
    return "".join(c for c in w.lower() if c.isalnum())


MAX_NUR_CANARY = 2


def _sprachlich(t: str) -> bool:
    """Sieht nach echter (deutscher) Sprache aus: nach dem Aufräumen bleiben
    mindestens zwei richtige Wörter übrig."""
    rest = text_sauber(t)
    return len(re.findall(r"[^\W\d_]{2,}", rest)) >= 2


def verschmelzen(canary: str, para: list[tuple[float, str]], dauer: float,
                 korrektur=None) -> list[tuple[float, str]]:
    """Canary-Text (besser, aber ohne Zeiten, verschluckt gern das erste Wort
    nach einem Sprecherwechsel) mit Parakeet-Wörtern (mit Zeiten) zusammen:
    Wörter per Levenshtein aneinander ausrichten. Gleich/ersetzt -> Canarys
    Wort mit Parakeets Zeit; nur bei Parakeet -> Parakeets Wort rein (das
    verschluckte); nur bei Canary -> rein, Zeit vom Nachbarn. Mit korrektur
    (server/namen.py): Wird Parakeets Wort zu einem Namen, Canarys aber nicht,
    gewinnt Parakeet - es hörte Namen im Test öfter richtig („Korgo" statt
    „Korku")."""
    namen = {_norm(x) for x in korrektur.namen} if korrektur else set()

    def name(w: str) -> Optional[str]:
        k = korrektur.korrigieren(w)
        return k if _norm(k) in namen or _norm(k)[:-1] in namen else None

    cw = canary.split()
    if not para:
        # Parakeet hört nichts. Bei leiser Sprache von weiter weg hört Canary
        # trotzdem oft Richtiges (Kalles Headset-Test) - bei Rascheln aber
        # Müll („T S F"), den text_sauber erkennt.
        return [(0.0, w) for w in cw] if _sprachlich(canary) else []
    if not cw:
        return list(para)
    a, b = [_norm(w) for w in cw], [_norm(w) for _, w in para]
    n, m = len(a), len(b)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
    erg: list[tuple[Optional[float], str]] = []
    i, j = n, m
    while i or j:
        if i and j and d[i][j] == d[i - 1][j - 1] + (a[i - 1] != b[j - 1]):
            w = cw[i - 1]
            if a[i - 1] != b[j - 1] and namen and not name(w):
                pn = name(para[j - 1][1])
                if pn:
                    zeichen = w[len(w.rstrip(".,;:!?")):]     # Canarys Satzzeichen bleiben
                    w = pn.rstrip(".,;:!?") + zeichen
            erg.append((para[j - 1][0], w))
            i, j = i - 1, j - 1
        elif j and d[i][j] == d[i][j - 1] + 1:
            erg.append((para[j - 1][0], para[j - 1][1]))
            j -= 1
        else:
            erg.append((None, cw[i - 1]))
            i -= 1
    erg.reverse()
    # Wörter nur bei Canary: bleiben, wenn sie nach Sprache aussehen. Müll
    # („T S F", Ziffern) fliegt raus - nicht pauschal alles, sonst ging bei
    # leiser Sprache (Parakeet hört kaum etwas) das meiste verloren.
    lauf: list[int] = []
    weg: set[int] = set()
    for k, (t, _) in enumerate(erg + [(0.0, "")]):
        if t is None:
            lauf.append(k)
        else:
            if len(lauf) > MAX_NUR_CANARY and not _sprachlich(" ".join(erg[x][1] for x in lauf)):
                weg.update(lauf)
            lauf = []
    # Zeiten für Canary-Extrawörter: die des vorigen Worts (oder 0).
    aus, letzte = [], 0.0
    for k, (t, w) in enumerate(erg):
        if k in weg:
            continue
        letzte = t if t is not None else letzte
        aus.append((min(letzte, dauer), w))
    return aus


MIN_SPRECHER_S = 5.0        # wer insgesamt weniger redet, ist kein eigener Sprecher
MIN_SPRECHER_ANTEIL = 0.02


def kleine_sprecher_weg(abschnitte: list[Abschnitt]) -> list[Abschnitt]:
    """Sprecher mit kaum Redezeit dem zeitlich nächsten „echten" Sprecher
    geben. Im ersten echten Test (Gespräch, Leute unbekannt) kamen 34
    Sprecher heraus - meist Rascheln und Fetzen, je ein paar Sekunden."""
    dauer: dict[int, float] = {}
    for a in abschnitte:
        dauer[a.sprecher] = dauer.get(a.sprecher, 0.0) + (a.ende - a.start)
    gesamt = sum(dauer.values()) or 1.0
    gross = {sp for sp, d in dauer.items() if d >= max(MIN_SPRECHER_S, MIN_SPRECHER_ANTEIL * gesamt)}
    if not gross or len(gross) == len(dauer):
        return abschnitte
    echte = [a for a in abschnitte if a.sprecher in gross]
    for a in abschnitte:
        if a.sprecher not in gross:
            mitte = (a.start + a.ende) / 2
            a.sprecher = min(echte, key=lambda x: min(abs(mitte - x.start), abs(mitte - x.ende))).sprecher
    return abschnitte


def beitraege(abschnitte: list[Abschnitt], luecke: float = LUECKE_ZUSAMMEN_S) -> list[Abschnitt]:
    """Wie zusammenlegen(), aber mit Text: gleicher Sprecher, kurze Pause ->
    ein Beitrag."""
    erg: list[Abschnitt] = []
    for a in sorted(abschnitte, key=lambda x: x.start):
        if not a.text:
            continue
        if erg and erg[-1].sprecher == a.sprecher and a.start - erg[-1].ende <= luecke:
            erg[-1].ende = max(erg[-1].ende, a.ende)
            erg[-1].text = f"{erg[-1].text} {a.text}"
        else:
            erg.append(Abschnitt(a.start, a.ende, a.sprecher, a.text))
    return erg


def transkribieren(pfad: Path, modelle: Path, personen: int = 0,
                   fortschritt: Optional[Callable[[float, str], None]] = None,
                   stopp: Optional[threading.Event] = None, namen=()) -> str:
    """Ganze Aufnahme -> Transkript „[hh:mm:ss] S00: …". fortschritt(0..1, Schritt).
    namen: Eigennamen der Runde (server/namen.py)."""
    stopp = stopp or threading.Event()
    melden = fortschritt or (lambda a, s: None)
    threads = _threads()
    melden(0.0, "Ton lesen")
    ton = ton_laden(pfad)
    if len(ton) < SR:
        return ""
    melden(0.0, "Sprache finden")
    stuecke = sprache_finden(ton, modelle, stopp=stopp)
    # Sprecher trennen ist der kleinere Teil (im Test ~1/5 der Zeit).
    melden(0.02, "Sprecher trennen")
    dia = _sprechertrennung(modelle, threads, personen)

    def dia_weiter(fertig, gesamt):
        melden(0.02 + 0.18 * fertig / max(1, gesamt), "Sprecher trennen")
        return 1 if stopp.is_set() else 0
    roh = dia.process(ton, callback=dia_weiter).sort_by_start_time()
    if stopp.is_set():
        raise InterruptedError
    teile = [(x.start, x.end, x.speaker) for x in roh]
    asr = _erkenner(modelle, threads)
    zweit = _canary(modelle, threads) if canary_da(modelle) else None
    korrektur = _namen_korrektur(namen)
    sprach_s = sum(e - s for s, e in stuecke) or 1
    erledigt = 0.0
    abschnitte: list[Abschnitt] = []
    for s, e in stuecke:
        if stopp.is_set():
            raise InterruptedError
        stueck = ton[int(s * SR):int(e * SR)]
        _, tokens, zeiten = _erkennen(asr, stueck)
        canary_text = satzzeichen(_erkennen(zweit, stueck)[0]) if zweit is not None and tokens else ""
        # sherpa-onnx zwingt Canary zu einem Wort, auch wenn es „nichts gesagt"
        # erkannt hat („first generated token is <|endoftext|> … Using the best
        # non-eos token instead", Konsole bei Kalle) - daher „T S F" & Co. Ist
        # nach dem Aufräumen nichts Sprachliches übrig: nur Parakeet.
        if canary_text and text_sauber(canary_text):
            # Beide hören, Canarys Text an Parakeets Wort-Zeiten (Tisch-Test:
            # Parakeet allein 21,5 %, Canary allein 16,9 %, beide 15,3 %).
            woerter = verschmelzen(canary_text, woerter_mit_zeit(tokens, zeiten), e - s, korrektur)
            tokens, zeiten = [" " + w for _, w in woerter], [t for t, _ in woerter]
        neu = stueck_zuordnen(s, e, tokens, zeiten, teile)
        for a in neu:
            a.text = text_sauber(korrektur.korrigieren(a.text))
            abschnitte.append(a)
        erledigt += e - s
        melden(0.2 + 0.8 * erledigt / sprach_s, "Text erkennen")
    return transkript_text(beitraege(kleine_sprecher_weg(abschnitte)))


# --- Live ---------------------------------------------------------------------------------

class Mitschrift:
    """Live: Silero-VAD schneidet Sprache heraus (≤ 12 s), pyannote trennt
    Sprecherwechsel IM Stück (am Tisch fällt man sich ins Wort, die Pausen
    reichen der VAD nicht), TitaNet ordnet die Stimme über den Abend zu, ein
    Erkenner-Aufruf je Stück, Wörter per Zeitstempel an den Sprecher."""

    def __init__(self, modelle: Path, personen: int = 0,
                 namen: Callable[[], list[str]] = lambda: []) -> None:
        import sherpa_onnx as so
        threads = _threads()
        self.vad = _vad(modelle, LIVE_STUECK_MAX_S)
        self.dia = _sprechertrennung(modelle, 1)
        self.abdruck = so.SpeakerEmbeddingExtractor(
            so.SpeakerEmbeddingExtractorConfig(model=str(modelle / MODELLE["stimme"][1]), num_threads=1))
        self.asr = _erkenner(modelle, threads)
        # Leute unbekannt: höchstens 8 - sonst wird live aus jedem Rascheln
        # ein neuer Sprecher (erster echter Test: S00 bis S33).
        self.stimmen = Stimmen(personen or MAX_LEUTE_UNBEKANNT)
        # Namen ändern sich am Abend (neue Gegner im Kampf) - je Stück frisch
        # holen, neu gebaut wird die Korrektur nur, wenn sich etwas tut.
        self._namen = namen
        self._namen_stand: Optional[tuple] = None
        self._korrektur = _namen_korrektur([])

    def korrektur(self):
        try:
            jetzt = tuple(self._namen() or ())
        except Exception:
            jetzt = ()
        if jetzt != self._namen_stand:
            self._namen_stand = jetzt
            self._korrektur = _namen_korrektur(jetzt)
        return self._korrektur

    def _stimme(self, ton):
        import numpy as np
        st = self.abdruck.create_stream()
        st.accept_waveform(SR, ton)
        st.input_finished()
        return np.array(self.abdruck.compute(st))

    def stueck(self, start_s: float, ton) -> list[tuple[float, int, str]]:
        """Ein VAD-Stück -> [(start_s, sprecher, text)]."""
        import numpy as np
        try:
            lokal = [(x.start, x.end, x.speaker) for x in self.dia.process(ton).sort_by_start_time()]
        except Exception:
            lokal = []
        if not lokal:
            lokal = [(0.0, len(ton) / SR, 0)]
        # Lokale Sprecher (0, 1 … nur in diesem Stück) -> Sprecher des Abends,
        # je lokaler Stimme ein Abdruck über alles, was sie hier sagt.
        global_von: dict[int, int] = {}
        for sp in sorted({x[2] for x in lokal}):
            alles = np.concatenate([ton[int(s * SR):int(e * SR)] for s, e, x in lokal if x == sp])
            global_von[sp] = self.stimmen.zuordnen(self._stimme(alles), len(alles) / SR)
        _, tokens, zeiten = _erkennen(self.asr, ton)
        teile = [(s, e, global_von[x]) for s, e, x in lokal]
        korrektur = self.korrektur()
        erg = []
        for s, sp, text in woerter_verteilen(tokens, zeiten, teile):
            text = text_sauber(korrektur.korrigieren(text))
            if text:
                erg.append((start_s + max(0.0, s), sp, text))
        return erg


def live_laufen(quelle, modelle: Path, ausgeben: Callable[[float, str, str], None],
                stopp: threading.Event, ab_s: float = 0.0, personen: int = 0,
                hinweis: Callable[[str], None] = lambda t: None,
                namen: Callable[[], list[str]] = lambda: []) -> None:
    """Blöcke aus ``quelle`` mitschreiben. ausgeben(sekunden_ab_beginn, „S01", text).
    Ton vor ab_s wird übergangen (Live erst mitten in der Aufnahme
    eingeschaltet: der Anfang ist dann Sache des genauen Durchgangs)."""
    import numpy as np
    m = Mitschrift(modelle, personen, namen)
    warte: list = []
    sperre = threading.Condition()
    fertig = threading.Event()

    def arbeiter() -> None:
        while True:
            with sperre:
                while not warte and not fertig.is_set():
                    sperre.wait(0.5)
                if not warte:
                    return
                # Live heißt live: kommt der Rechner nicht hinterher, lieber
                # Lücken als immer weiter zurückfallen. Die Aufnahme ist ja
                # vollständig, der genaue Durchgang danach holt alles.
                weg = rueckstau_kuerzen(warte)
                start_s, ton = warte.pop(0)
            if weg:
                hinweis(f"Rechner kommt nicht hinterher – {weg} Stück(e) übersprungen")
            try:
                for s, sp, text in m.stueck(start_s, ton):
                    ausgeben(s, f"S{sp:02d}", text)
            except Exception as e:      # ein kaputtes Stück beendet nicht den Abend
                hinweis(f"Fehler bei einem Stück: {e}")

    t = threading.Thread(target=arbeiter, daemon=True, name="live-erkennen")
    t.start()

    def abholen() -> None:
        while not m.vad.empty():
            seg = m.vad.front
            if seg.start / SR + len(seg.samples) / SR > ab_s:
                with sperre:
                    warte.append((seg.start / SR, np.array(seg.samples, dtype=np.float32)))
                    sperre.notify()
            m.vad.pop()

    puffer = np.zeros(0, dtype=np.float32)
    for block in quelle:
        # Silero will 512er-Fenster; Reste fürs nächste Mal aufheben.
        # (je 512 einzeln, siehe sprache_finden)
        puffer = np.concatenate([puffer, block])
        n = len(puffer) // 512 * 512
        for i in range(0, n, 512):
            m.vad.accept_waveform(puffer[i:i + 512])
        if n:
            puffer = puffer[n:]
            abholen()
        if stopp.is_set():
            break
    m.vad.flush()
    abholen()
    fertig.set()
    with sperre:
        sperre.notify()
    t.join()


def begriffe_lesen(text: str) -> list[str]:
    """Eingabe des SL (eine Zeile oder Komma je Name) -> saubere Liste."""
    erg, gesehen = [], set()
    for teil in re.split(r"[\n,;]+", str(text or "")):
        t = " ".join(teil.split())[:60]
        if len(t) >= 2 and t.lower() not in gesehen:
            gesehen.add(t.lower())
            erg.append(t)
    return erg[:300]


# --- Verwaltung im Server -----------------------------------------------------------------

class Sprache:
    """Hält den Zustand für die SL-Ansicht: Modelle (fehlen/laden/bereit), die
    Live-Mitschrift der laufenden Aufnahme und einen „genau"-Durchgang. Alles
    läuft in Hintergrund-Threads; sherpa-onnx gibt beim Rechnen das GIL frei
    (gemessen: Hauptthread hing höchstens 0,04 s), der Server bleibt flüssig."""

    def __init__(self, modelle: Path, aufnahmen) -> None:
        self.modelle = modelle
        self.aufnahmen = aufnahmen
        self.einst_pfad = aufnahmen.ordner / "einstellungen.json"
        self.laden: Optional[dict] = None        # {"b", "gesamt", "fehler"}
        self.live: Optional[dict] = None         # {"name", "hinweis", "stopp"}
        self.job: Optional[dict] = None          # {"name", "anteil", "schritt", "start", "stopp", "fehler"}
        # Aufnahmen, die genau transkribiert werden sollen, aber warten müssen:
        # auf einen laufenden Durchgang (CPU) oder aufs Genauer-Modell.
        self.warten: list[str] = []
        self._sperre = threading.Lock()
        # Von app.py gesetzt: Namen, die das Spiel gerade kennt, und wie viele
        # Leute laut App am Tisch sitzen (Spieler + SL).
        self.namen_quelle: Callable[[], list[str]] = lambda: []
        self.personen_quelle: Callable[[], int] = lambda: 0

    # Einstellungen (Live an/aus, Personenzahl, Namen & Begriffe) - überleben
    # den Neustart.
    def einstellungen(self) -> dict:
        try:
            e = json.loads(self.einst_pfad.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            e = {}
        b = e.get("begriffe")
        # Live standardmäßig aus (seit 1.5.30): Kalle will nur das beste
        # Ergebnis, und das kommt vom genauen Durchgang danach - live ist
        # gröber und kostet beim Spielen Rechenzeit.
        return {"live": bool(e.get("live", False)), "personen": int(e.get("personen") or 0),
                "begriffe": [x for x in b if isinstance(x, str)] if isinstance(b, list) else []}

    def einstellen(self, live: Optional[bool] = None, personen: Optional[int] = None,
                   begriffe: Optional[str] = None) -> dict:
        e = self.einstellungen()
        if live is not None:
            e["live"] = bool(live)
        if personen is not None:
            e["personen"] = max(0, min(12, int(personen)))
        if begriffe is not None:
            e["begriffe"] = begriffe_lesen(begriffe)
        try:
            self.einst_pfad.parent.mkdir(parents=True, exist_ok=True)
            self.einst_pfad.write_text(json.dumps(e), encoding="utf-8")
        except OSError:
            pass
        if live is False and self.live:
            self.live["stopp"].set()
        elif live:
            self.aufnahme_laeuft()
        return e

    def begriffe(self) -> list[str]:
        return self.einstellungen()["begriffe"]

    def _app_namen(self) -> list[str]:
        try:
            return list(self.namen_quelle() or [])
        except Exception:
            return []

    def personen_fuer(self, name: Optional[str] = None) -> int:
        """Eingestellt > laut Aufnahme (wer mitgespielt hat) > laut App jetzt."""
        n = self.einstellungen()["personen"]
        if n:
            return n
        if name:
            n = self.aufnahmen.personen_zahl(name)
        if not n:
            try:
                n = int(self.personen_quelle() or 0)
            except Exception:
                n = 0
        return n if n >= 2 else 0

    def bereit(self) -> bool:
        return pakete_da() and not set(PFLICHT) & set(modelle_fehlen(self.modelle))

    def status(self) -> dict:
        job = self.job
        e = self.einstellungen()
        return {
            "verfuegbar": pakete_da(),
            "bereit": self.bereit(),
            "groesseMb": sum(MODELLE[n][2] for n in modelle_fehlen(self.modelle)),
            "genauerFehlt": pakete_da() and not canary_da(self.modelle),
            "laden": None if not self.laden else {k: self.laden[k] for k in ("b", "gesamt", "fehler")},
            "live": None if not self.live else {"name": self.live["name"], "hinweis": self.live["hinweis"]},
            "job": None if not job else {k: job[k] for k in ("name", "anteil", "schritt", "start", "fehler")},
            "warten": list(self.warten),
            "liveAn": e["live"], "personen": e["personen"],
            "personenApp": self.personen_fuer(self.aufnahmen.aktiv["name"] if self.aufnahmen.aktiv else None)
            if not e["personen"] else 0,
            "begriffe": e["begriffe"],
        }

    # --- Modelle holen ---
    def modelle_holen(self) -> bool:
        with self._sperre:
            if (self.laden and not self.laden["fehler"]) or not pakete_da():
                return False
            self.laden = {"b": 0, "gesamt": 1, "fehler": None}

        def los() -> None:
            try:
                modelle_laden(self.modelle, lambda b, g: self.laden.update(b=b, gesamt=g))
                self.laden = None
                self.aufnahme_laeuft()
            except Exception as e:
                self.laden["fehler"] = f"Download fehlgeschlagen ({e.__class__.__name__}). Internet da?"
            # Wartende Aufnahmen jetzt rechnen - ging der Download schief, eben
            # ohne Genauer-Modell: besser als gar kein Transkript.
            self._naechste()
        threading.Thread(target=los, daemon=True, name="modelle-laden").start()
        return True

    def genauer_nachholen(self) -> None:
        """Beim Serverstart: wer vor 1.5.28 eingerichtet hat, hat das
        Genauer-Modell (Canary) nicht. Ohne Klick nachladen - Kalle will immer
        das beste Ergebnis. Ohne Internet bleibt der Knopf „⬇ Genauer"."""
        if pakete_da() and self.bereit() and not canary_da(self.modelle):
            self.modelle_holen()

    def _laedt(self) -> bool:
        return bool(self.laden and not self.laden["fehler"])

    # --- Live ---
    def aufnahme_laeuft(self) -> None:
        """Nach Start einer Aufnahme (und wenn Live eingeschaltet wird):
        mitschreiben, falls gewünscht und möglich."""
        a = self.aufnahmen.aktiv
        if not a or not self.einstellungen()["live"] or not self.bereit():
            return
        if self.live and self.live["name"] == a["name"] and not self.live["stopp"].is_set():
            return
        if self.live:
            self.live["stopp"].set()
        name, start, endung = a["name"], a["start"], a["endung"]
        stopp = threading.Event()
        zustand = {"name": name, "hinweis": None, "stopp": stopp}
        self.live = zustand
        # Live mitten in der Aufnahme eingeschaltet -> erst ab jetzt.
        ab_s = max(0.0, (time.time() * 1000 - start) / 1000 - 3)
        pfad = self.aufnahmen.ordner / f"{name}{endung}"

        def laeuft() -> bool:
            return bool(self.aufnahmen.aktiv and self.aufnahmen.aktiv["name"] == name)

        def ausgeben(s: float, sprecher: str, text: str) -> None:
            if laeuft():
                self.aufnahmen.live(start + int(s * 1000), sprecher, text)

        def hinweis(t: str) -> None:
            zustand["hinweis"] = t

        def los() -> None:
            # Erstes Stück abwarten: vorher gibt es die Datei (und ihren Kopf) nicht.
            while not pfad.exists() or pfad.stat().st_size == 0:
                if stopp.is_set() or not laeuft():
                    return
                time.sleep(0.5)
            try:
                fmt = {".ogg": "ogg", ".m4a": "mp4"}.get(endung, "webm")
                quelle = ton_mitlesen(pfad, laeuft, stopp, fmt)
                # Personenzahl live nur als Obergrenze (Stimmen): wer später
                # dazukommt, landet sonst nie als eigener Sprecher.
                live_laufen(quelle, self.modelle, ausgeben, stopp, ab_s=ab_s,
                            personen=self.personen_fuer(name), hinweis=hinweis,
                            namen=lambda: self.begriffe() + self._app_namen() + self.aufnahmen.namen(name))
            except Exception as e:
                zustand["hinweis"] = f"Live-Mitschrift abgebrochen ({e.__class__.__name__})"
                return
            if self.live is zustand:
                self.live = None
        threading.Thread(target=los, daemon=True, name="live").start()

    # --- Danach ---
    def nach_aufnahme(self, name: str) -> None:
        """Aufnahme beendet: gleich genau transkribieren, ohne Knopf (seit
        1.5.30, Kalle: „immer das beste Ergebnis"). Fehlt das Genauer-Modell,
        erst das holen - genau() wartet darauf."""
        if not pakete_da() or not self.bereit():
            return
        if name not in self.warten:
            self.warten.append(name)
        if not canary_da(self.modelle) and not self._laedt():
            self.modelle_holen()          # rechnet die Wartenden danach
        else:
            self._naechste()

    def _naechste(self) -> None:
        """Die nächste wartende Aufnahme starten. Weg sind nur die, die gar
        nicht gehen (Ton gelöscht); wer weiter warten muss, bleibt vorn."""
        for name in list(self.warten):
            if self.genau(name):
                return                    # läuft - oder muss weiter warten
            if name in self.warten:
                self.warten.remove(name)

    def genau(self, name: str) -> bool:
        pfad = self.aufnahmen.audio_pfad(name)
        if not pfad or not self.bereit():
            return False
        if self.aufnahmen.aktiv and self.aufnahmen.aktiv["name"] == name:
            return False                      # erst nach dem Ende
        with self._sperre:
            busy = self.job and not self.job.get("fehler")
            if busy and self.job["name"] == name:
                return False
            if busy or self._laedt() or self.aufnahmen.aktiv:
                # Einer nach dem anderen (CPU); beim Download des
                # Genauer-Modells darauf warten statt ohne zu rechnen; und
                # nicht, während gespielt und aufgenommen wird (der Laptop
                # soll flüssig bleiben) - nach_aufnahme() holt es nach.
                if name not in self.warten:
                    self.warten.append(name)
                return True
            if name in self.warten:
                self.warten.remove(name)
            stopp = threading.Event()
            job = {"name": name, "anteil": 0.0, "schritt": "startet", "start": int(time.time() * 1000),
                   "stopp": stopp, "fehler": None}
            self.job = job

        def melden(anteil: float, schritt: str) -> None:
            job["anteil"], job["schritt"] = round(anteil, 4), schritt

        def los() -> None:
            try:
                namen = self.begriffe() + self.aufnahmen.namen(name) + self._app_namen()
                text = transkribieren(pfad, self.modelle, self.personen_fuer(name), melden, stopp, namen=namen)
                if text.strip():
                    (self.aufnahmen.ordner / f"{name}-transkript.txt").write_text(text, encoding="utf-8")
                self.job = None
            except InterruptedError:
                self.job = None
            except Exception as e:
                job["fehler"] = f"Abgebrochen ({e.__class__.__name__})"
            if not stopp.is_set():
                self._naechste()
        threading.Thread(target=los, daemon=True, name="genau").start()
        return True

    def genau_abbrechen(self) -> None:
        # Abbrechen heißt: Laptop soll Ruhe geben - auch die Wartenden nicht.
        self.warten.clear()
        job = self.job
        if job:
            job["stopp"].set()
            if job.get("fehler"):
                self.job = None
