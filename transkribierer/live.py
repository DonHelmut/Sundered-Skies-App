"""Live-Mitschrift: schreibt während des Spielabends mit, was am Tisch gesagt wird.

Kalle wollte den Text „mehr oder weniger live" sehen. Der Transkribierer hört
dazu selbst am Mikro mit (parallel zur Aufnahme im Browser - Windows gibt
ein Mikro an mehrere Programme) und schickt jede erkannte Zeile an die App.
Die zeigt sie dezent im Aufnahme-Panel und hängt sie an die laufende
Aufnahme (…-live.txt). Daraus wird nach dem Abend sofort ein Prompt - ohne
stundenlangen Durchgang. Der genaue Durchgang (transkribieren.py) bleibt
der bessere Weg fürs Protokoll: er sieht den ganzen Abend auf einmal und
trennt Sprecher sauberer.

Ablauf je Sprechpause:
1. Silero-VAD schneidet Sprache heraus, höchstens 12 s am Stück (SL
   erzählt minutenlang - sonst käme der Text erst nach dem Monolog).
2. pyannote-Segmentierung trennt Sprecherwechsel INNERHALB des Stücks: am
   Tisch fällt man sich ins Wort, die Pausen reichen der VAD nicht.
3. Stimmabdruck (TitaNet) -> „S00", „S01" … über den ganzen Abend gleich.
   Live geht nur „wer klingt wie wer bisher" - darum gröber als der
   Durchgang danach, der alle Stimmen gemeinsam sortiert.
4. Parakeet (NVIDIA, 25 Sprachen inkl. Deutsch) erkennt den Text - EIN
   Aufruf je Stück, die Wörter haben Zeitstempel und gehen an den Sprecher,
   der in dem Moment redet. Whisper war live zu langsam: es rechnet jedes
   Stück auf 30 s aufgefüllt, je Sprecherwechsel ein Aufruf, im Test etwa
   so lange wie der Ton selbst. Parakeet brauchte ein Siebtel und verhörte
   sich nicht öfter.

Kommt der Rechner nicht hinterher, wird übersprungen statt immer weiter
zurückzufallen: live heißt live, vollständig ist die Aufnahme.
"""

from __future__ import annotations

import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import transkribieren as T

SR = T.SR
STUECK_MAX_S = 12.0         # länger -> Text kommt zu spät
RUECKSTAU_MAX_S = 60.0      # so viel Sprache darf warten, sonst überspringen
# Gleiche Stimme, wenn Kosinus-Ähnlichkeit darüber. Im Test (3 Stimmen,
# 2 männlich) lag dieselbe Person bei 0,57–0,91, verschiedene bei höchstens
# 0,29 (ein Stück mit zwei Sprechern: 0,59).
STIMME_GLEICH = 0.5
MIN_NEUE_STIMME_S = 1.0     # aus Fetzen keinen neuen Sprecher anlegen
# Ports, auf denen die App laufen kann (server/paths.py PORT_CANDIDATES).
APP_PORTS = (8000, 8001, 8010, 8080, 8088, 8123, 8765, 8899)


# --- Sprecher über den Abend wiedererkennen --------------------------------------

class Stimmen:
    """Online-Zuordnung Stimmabdruck -> Sprechernummer. Je Sprecher ein
    Mittelwert der bisherigen Abdrücke (nach Dauer gewichtet)."""

    def __init__(self, max_personen: int = 0, gleich: float = STIMME_GLEICH) -> None:
        self.max_personen = max_personen
        self.gleich = gleich
        self.summen: list = []       # je Sprecher: Summe der gewichteten Abdrücke
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


# --- App finden und beliefern ------------------------------------------------------

def app_finden(ports=APP_PORTS, timeout: float = 0.5) -> str | None:
    """Die App läuft auf demselben Laptop; über localhost ist man dort SL und
    darf liefern. Port 8000 kann belegt sein -> der Reihe nach probieren."""
    for p in ports:
        url = f"http://127.0.0.1:{p}"
        try:
            with urllib.request.urlopen(f"{url}/api/aufnahme", timeout=timeout) as r:
                if "liste" in json.loads(r.read().decode("utf-8")):
                    return url
        except (OSError, ValueError):
            continue
    return None


def app_senden(url: str, zeile: dict, timeout: float = 2.0) -> int:
    """HTTP-Status (200 = angekommen, 409 = in der App läuft keine Aufnahme),
    0 = App nicht erreichbar."""
    req = urllib.request.Request(f"{url}/api/aufnahme/live", data=json.dumps(zeile).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError:
        return 0


# --- Tonquellen ---------------------------------------------------------------------

def mikros() -> list[tuple[int, str]]:
    import sounddevice as sd
    erg, gesehen = [], set()
    standard_api = sd.default.hostapi
    for i, d in enumerate(sd.query_devices()):
        # Jedes Mikro taucht unter Windows je Treiber-Schnittstelle (MME,
        # DirectSound, WASAPI …) einmal auf - nur eine zeigen.
        if d["max_input_channels"] < 1 or d["hostapi"] != standard_api or d["name"] in gesehen:
            continue
        gesehen.add(d["name"])
        erg.append((i, d["name"]))
    return erg


def mikro_quelle(geraet: int | None, stopp: threading.Event):
    """Blöcke (16 kHz mono float32) vom Mikro. Aufgenommen wird mit der Rate
    des Geräts und hier umgerechnet - nicht jede Schnittstelle kann 16 kHz."""
    import av
    import numpy as np
    import sounddevice as sd
    rate = int(sd.query_devices(geraet, "input")["default_samplerate"])
    q: queue.Queue = queue.Queue()
    res = av.AudioResampler(format="flt", layout="mono", rate=SR)

    def rein(daten, frames, zeit, status):
        q.put(daten[:, 0].copy())
    with sd.InputStream(device=geraet, channels=1, samplerate=rate, dtype="float32",
                        blocksize=rate // 10, callback=rein):
        while not stopp.is_set():
            try:
                block = q.get(timeout=0.5)
            except queue.Empty:
                continue
            frame = av.AudioFrame.from_ndarray(block.reshape(1, -1), format="flt", layout="mono")
            frame.sample_rate = rate
            for f in res.resample(frame):
                yield f.to_ndarray().reshape(-1).astype(np.float32)


def datei_quelle(pfad: Path, stopp: threading.Event, tempo: float = 1.0):
    """Zum Testen: eine Aufnahme so abspielen, als käme sie gerade vom Mikro."""
    ton = T.ton_laden(pfad)
    block = SR // 10
    t0 = time.time()
    for i in range(0, len(ton), block):
        if stopp.is_set():
            return
        warten = t0 + i / SR / tempo - time.time()
        if warten > 0:
            time.sleep(warten)
        yield ton[i:i + block]


# --- Erkennen -------------------------------------------------------------------------

class Mitschrift:
    def __init__(self, personen: int = 0, threads: int = 0) -> None:
        import sherpa_onnx as so
        self.threads = threads or max(1, (os.cpu_count() or 4) - 1)
        mod = T.programm_ordner() / "modelle"
        vad_pfad = T.modell("vad", mod)
        seg = T.modell("segmentierung", mod)
        stimme = T.modell("stimme", mod)
        par = T.modell("parakeet", mod)
        self.vad = so.VoiceActivityDetector(so.VadModelConfig(
            silero_vad=so.SileroVadModelConfig(model=str(vad_pfad), threshold=0.5,
                                               min_silence_duration=0.5, min_speech_duration=0.3,
                                               max_speech_duration=STUECK_MAX_S),
            sample_rate=SR), buffer_size_in_seconds=120)
        self.dia = so.OfflineSpeakerDiarization(so.OfflineSpeakerDiarizationConfig(
            segmentation=so.OfflineSpeakerSegmentationModelConfig(
                pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(seg / "model.int8.onnx")),
                num_threads=1),
            embedding=so.SpeakerEmbeddingExtractorConfig(model=str(stimme), num_threads=1),
            clustering=so.FastClusteringConfig(num_clusters=-1, threshold=0.7),
            min_duration_on=0.3, min_duration_off=0.5))
        self.abdruck = so.SpeakerEmbeddingExtractor(
            so.SpeakerEmbeddingExtractorConfig(model=str(stimme), num_threads=1))
        self.asr = so.OfflineRecognizer.from_transducer(
            encoder=str(par / "encoder.int8.onnx"), decoder=str(par / "decoder.int8.onnx"),
            joiner=str(par / "joiner.int8.onnx"), tokens=str(par / "tokens.txt"),
            model_type="nemo_transducer", num_threads=self.threads)
        self.stimmen = Stimmen(personen)

    def _stimme(self, ton) -> list:
        import numpy as np
        st = self.abdruck.create_stream()
        st.accept_waveform(SR, ton)
        st.input_finished()
        return np.array(self.abdruck.compute(st))

    def _erkennen(self, ton) -> tuple[list[str], list[float]]:
        import numpy as np
        vorne = np.zeros(int(T.STILLE_VORNE_S * SR), dtype=np.float32)
        hinten = np.zeros(int(T.STILLE_HINTEN_S * SR), dtype=np.float32)
        st = self.asr.create_stream()
        st.accept_waveform(SR, np.concatenate([vorne, ton, hinten]))
        self.asr.decode_stream(st)
        return list(st.result.tokens), [x - T.STILLE_VORNE_S for x in st.result.timestamps]

    def stueck(self, start_s: float, ton) -> list[tuple[float, int, str]]:
        """Ein VAD-Stück -> [(start_s, sprecher, text)]."""
        import numpy as np
        try:
            roh = self.dia.process(ton).sort_by_start_time()
            lokal = [(x.start, x.end, x.speaker) for x in roh]
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
        tokens, zeiten = self._erkennen(ton)
        teile = [(s, e, global_von[x]) for s, e, x in lokal]
        erg = []
        for s, sp, text in woerter_verteilen(tokens, zeiten, teile):
            text = T.text_sauber(text)
            if text:
                erg.append((start_s + max(0.0, s), sp, text))
        return erg


def live(quelle, personen: int = 0, threads: int = 0, app: str | None = "auto",
         ausgabe: Path | None = None, stopp: threading.Event | None = None) -> Path:
    stopp = stopp or threading.Event()
    m = Mitschrift(personen, threads)
    if app == "auto":
        app = app_finden()
    beginn = time.time()                      # Wanduhr bei Sample 0
    ausgabe = ausgabe or (T.programm_ordner() / "live" /
                          time.strftime("%Y-%m-%d_%H-%M-live.txt", time.localtime(beginn)))
    ausgabe.parent.mkdir(parents=True, exist_ok=True)
    print(f"App: {app or 'nicht gefunden – Text nur hier und in der Datei'}")
    print(f"Datei: {ausgabe}\n")
    print("Hört zu … (Strg+C beendet)\n")

    warte: list = []
    sperre = threading.Condition()
    fertig = threading.Event()
    zustand = {"app_meldung": None, "uebersprungen": 0}

    def ausliefern(start_s: float, sprecher: int, text: str) -> None:
        zeit = beginn + start_s
        zeile = f"[{time.strftime('%H:%M:%S', time.localtime(zeit))}] S{sprecher:02d}: {text}"
        print(zeile, flush=True)
        with open(ausgabe, "a", encoding="utf-8") as f:
            f.write(zeile + "\n")
        if not app:
            return
        code = app_senden(app, {"zeit": int(zeit * 1000), "sprecher": f"S{sprecher:02d}", "text": text})
        meldung = None if code == 200 else (
            "   (App: keine Aufnahme gestartet – Text landet nur in der Datei)" if code == 409
            else "   (App nicht erreichbar – Text landet nur in der Datei)")
        if meldung and meldung != zustand["app_meldung"]:
            print(meldung, flush=True)
        zustand["app_meldung"] = meldung

    def arbeiter() -> None:
        while True:
            with sperre:
                while not warte and not fertig.is_set():
                    sperre.wait(0.5)
                if not warte:
                    return
                weg = rueckstau_kuerzen(warte)
                start_s, ton = warte.pop(0)
            if weg:
                zustand["uebersprungen"] += weg
                print(f"   […] Rechner kommt nicht hinterher, {weg} Stück(e) übersprungen "
                      "(die Aufnahme ist trotzdem vollständig)", flush=True)
            for s, sp, text in m.stueck(start_s, ton):
                ausliefern(s, sp, text)

    t = threading.Thread(target=arbeiter, daemon=True)
    t.start()

    def abholen() -> None:
        while not m.vad.empty():
            seg = m.vad.front
            import numpy as np
            with sperre:
                warte.append((seg.start / SR, np.array(seg.samples, dtype=np.float32)))
                sperre.notify()
            m.vad.pop()

    puffer = None
    import numpy as np
    try:
        for block in quelle:
            # Silero will 512er-Fenster; Reste fürs nächste Mal aufheben.
            puffer = block if puffer is None else np.concatenate([puffer, block])
            n = len(puffer) // 512 * 512
            if n:
                m.vad.accept_waveform(puffer[:n])
                puffer = puffer[n:]
                abholen()
            if stopp.is_set():
                break
    except KeyboardInterrupt:
        pass
    m.vad.flush()
    abholen()
    fertig.set()
    with sperre:
        sperre.notify()
    try:
        t.join()
    except KeyboardInterrupt:
        pass
    print(f"\nBeendet. Mitschrift: {ausgabe}")
    return ausgabe


def mikro_waehlen() -> int | None:
    liste = mikros()
    if not liste:
        raise SystemExit("Kein Mikrofon gefunden.")
    if len(liste) == 1:
        return liste[0][0]
    print("Mikrofone:")
    for n, (_, name) in enumerate(liste, 1):
        print(f"  {n}) {name}")
    try:
        wahl = input("Welches? (Enter = Standard): ").strip()
        return liste[int(wahl) - 1][0] if wahl else None
    except (ValueError, IndexError, EOFError):
        return None
