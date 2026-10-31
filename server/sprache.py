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
}


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
""".split()) - {"so", "in", "was", "hat", "man", "die", "will", "um", "also", "am", "an", "war", "here"}
_WORT = re.compile(r"[a-zäöüß']+")


def englisch(t: str) -> bool:
    w = _WORT.findall(t.lower())
    if not w or any(c in t for c in "äöüßÄÖÜ"):
        return False
    return sum(x in _ENGLISCH for x in w) / len(w) >= 0.6


def text_sauber(t: str) -> str:
    t = " ".join(t.split())
    if any(f in t.lower() for f in _FLOSKELN) or englisch(t):
        return ""
    return t


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
    korrektur = _namen_korrektur(namen)
    sprach_s = sum(e - s for s, e in stuecke) or 1
    erledigt = 0.0
    abschnitte: list[Abschnitt] = []
    for s, e in stuecke:
        if stopp.is_set():
            raise InterruptedError
        _, tokens, zeiten = _erkennen(asr, ton[int(s * SR):int(e * SR)])
        for a in stueck_zuordnen(s, e, tokens, zeiten, teile):
            a.text = text_sauber(korrektur.korrigieren(a.text))
            abschnitte.append(a)
        erledigt += e - s
        melden(0.2 + 0.8 * erledigt / sprach_s, "Text erkennen")
    return transkript_text(beitraege(abschnitte))


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
        self.stimmen = Stimmen(personen)
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
        return {"live": bool(e.get("live", True)), "personen": int(e.get("personen") or 0),
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
        return pakete_da() and not modelle_fehlen(self.modelle)

    def status(self) -> dict:
        job = self.job
        e = self.einstellungen()
        return {
            "verfuegbar": pakete_da(),
            "bereit": self.bereit(),
            "groesseMb": sum(MODELLE[n][2] for n in modelle_fehlen(self.modelle)),
            "laden": None if not self.laden else {k: self.laden[k] for k in ("b", "gesamt", "fehler")},
            "live": None if not self.live else {"name": self.live["name"], "hinweis": self.live["hinweis"]},
            "job": None if not job else {k: job[k] for k in ("name", "anteil", "schritt", "start", "fehler")},
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
        threading.Thread(target=los, daemon=True, name="modelle-laden").start()
        return True

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
    def genau(self, name: str) -> bool:
        pfad = self.aufnahmen.audio_pfad(name)
        if not pfad or not self.bereit():
            return False
        if self.aufnahmen.aktiv and self.aufnahmen.aktiv["name"] == name:
            return False                      # erst nach dem Ende
        with self._sperre:
            if self.job and not self.job.get("fehler"):
                return False                  # einer nach dem anderen (CPU)
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
        threading.Thread(target=los, daemon=True, name="genau").start()
        return True

    def genau_abbrechen(self) -> None:
        job = self.job
        if job:
            job["stopp"].set()
            if job.get("fehler"):
                self.job = None
