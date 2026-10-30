"""Transkribierer – macht aus der Spielabend-Aufnahme ein Transkript mit Sprechern.

Eigenständiges Werkzeug neben der Initiative-App („Stufe 2"): Kalle wollte die
Transkription als Extra-Download, unabhängig von der App, später verschmelzbar.
Ersetzt noScribe – die Ausgabe hat dasselbe Format („[00:01:23] S00: …") und
passt direkt in „📝 Transkript → Prompt" der App.

Alles läuft lokal und ohne Konto:
- Sprechertrennung: sherpa-onnx (pyannote-Segmentierung + Stimmabdruck als ONNX).
  pyannote selbst verlangt ein Hugging-Face-Konto samt Lizenz-Klick – die
  ONNX-Fassungen liegen frei auf GitHub.
- Spracherkennung: Whisper „turbo" (int8) über sherpa-onnx. Kein PyTorch, keine
  Grafikkarte nötig, läuft auf einem normalen Laptop (dann eben über Nacht).
- Ton lesen: PyAV (bringt ffmpeg mit) – die App speichert .webm/Opus.

Modelle (ca. 1 GB) lädt das Programm beim ersten Start von GitHub in den
Ordner „modelle" neben sich.

Aufruf: Doppelklick (Datei wählen) oder Tondatei auf die .exe ziehen.
Entwickler: python transkribieren.py DATEI [--personen 5]
"""

from __future__ import annotations

import argparse
import os
import sys
import tarfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

SR = 16000                      # Whisper und Sprechertrennung wollen 16 kHz mono
MAX_STUECK_S = 28.0             # Whisper verarbeitet höchstens 30 s am Stück
LUECKE_ZUSAMMEN_S = 1.0         # gleicher Sprecher, Pause darunter -> ein Beitrag
# Stille um jedes Stück: ohne sie verschluckte Whisper im Test das letzte Wort
# jedes Beitrags („… der im Nebel" statt „… der im Nebel schwebt") und
# wiederholte bei kurzen Sätzen den Anfang.
STILLE_VORNE_S, STILLE_HINTEN_S = 0.2, 1.0

_GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
# Name -> (Download-URL, Datei/Ordner im Modellordner). Alles öffentlich auf
# GitHub, kein Konto. Archive werden entpackt.
MODELLE = {
    "segmentierung": (f"{_GH}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
                      "sherpa-onnx-pyannote-segmentation-3-0"),
    # Stimmabdruck: NeMo TitaNet. Im Test (3 deutsche Stimmen, 2 davon
    # männlich) trennte es als einziges alle drei sauber; WeSpeaker und
    # 3D-Speaker legten die beiden Männer zusammen.
    "stimme": (f"{_GH}/speaker-recongition-models/nemo_en_titanet_small.onnx",
               "nemo_en_titanet_small.onnx"),
    # Whisper turbo: großes Modell (gut bei Deutsch und Namen) mit nur 4
    # Decoder-Schichten. „small" war im Test kaum schneller, aber deutlich
    # schlechter - darum gibt es keine Schnell-Variante.
    "turbo": (f"{_GH}/asr-models/sherpa-onnx-whisper-turbo.tar.bz2", "sherpa-onnx-whisper-turbo"),
}


def programm_ordner() -> Path:
    # Als .exe (PyInstaller) liegt alles neben der .exe, sonst neben dem Skript.
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def uhrzeit(s: float) -> str:
    s = max(0, int(s))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def dauer_text(s: float) -> str:
    m = int(s // 60)
    return f"{m // 60} h {m % 60:02d} min" if m >= 60 else f"{m} min {int(s) % 60:02d} s"


# --- Modelle -------------------------------------------------------------------

def _laden(url: str, ziel: Path) -> None:
    tmp = ziel.with_name(ziel.name + ".teil")
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
        gesamt = int(r.headers.get("Content-Length") or 0)
        geladen, letzte = 0, 0.0
        while True:
            block = r.read(1 << 20)
            if not block:
                break
            f.write(block)
            geladen += len(block)
            if time.time() - letzte > 0.5:
                letzte = time.time()
                anteil = f" ({geladen * 100 // gesamt} %)" if gesamt else ""
                print(f"\r   {geladen / 1048576:.0f} MB{anteil}   ", end="", flush=True)
    print()
    tmp.replace(ziel)


def modell(name: str, ordner: Path) -> Path:
    """Pfad zum Modell; lädt es beim ersten Mal herunter."""
    url, ziel_name = MODELLE[name]
    ziel = ordner / ziel_name
    if ziel.exists():
        return ziel
    ordner.mkdir(parents=True, exist_ok=True)
    print(f"Lade Modell „{name}“ (einmalig) …")
    if url.endswith(".tar.bz2"):
        archiv = ordner / (ziel_name + ".tar.bz2")
        _laden(url, archiv)
        print("   entpacke …")
        with tarfile.open(archiv, "r:bz2") as t:
            t.extractall(ordner, filter="data")
        archiv.unlink()
    else:
        _laden(url, ziel)
    return ziel


def whisper_dateien(ordner: Path) -> tuple[Path, Path, Path]:
    """encoder/decoder (int8) und tokens im Modellordner finden."""
    enc = next(ordner.glob("*-encoder.int8.onnx"))
    dec = next(ordner.glob("*-decoder.int8.onnx"))
    tok = next(ordner.glob("*-tokens.txt"))
    return enc, dec, tok


# --- Ton -----------------------------------------------------------------------

def ton_laden(pfad: Path):
    """Beliebige Tondatei -> 16 kHz mono float32. Die App nimmt webm/Opus auf;
    PyAV bringt ffmpeg mit, ein eigenes ffmpeg muss niemand installieren."""
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
    return np.concatenate(teile).astype(np.float32)


# --- Sprecher-Abschnitte zusammenlegen -------------------------------------------

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
    """Lange Beiträge (SL erzählt minutenlang) in Whisper-taugliche Stücke."""
    stuecke, t = [], a.start
    while t < a.ende:
        e = min(a.ende, t + max_s)
        # Kein Reststück unter 2 s: Whisper erfindet bei Fetzen gern Text.
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


# Whisper „hört" in Stille und Rauschen gern Abspann-Floskeln aus seinen
# Trainingsdaten. Die kommen am Spieltisch nie vor.
_FLOSKELN = ("untertitel", "vielen dank fürs zuschauen", "copyright", "amara.org", "swr ", "zdf")


def text_sauber(t: str) -> str:
    t = " ".join(t.split())
    if any(f in t.lower() for f in _FLOSKELN):
        return ""
    return t


def transkript_text(abschnitte: list[Abschnitt]) -> str:
    nummer = sprecher_nummern(abschnitte)
    zeilen = [f"[{uhrzeit(a.start)}] S{nummer[a.sprecher]:02d}: {a.text}"
              for a in abschnitte if a.text]
    return "\n".join(zeilen) + "\n"


# --- Ablauf --------------------------------------------------------------------

def transkribieren(pfad: Path, personen: int = 0, threads: int = 0) -> Path:
    import numpy as np
    import sherpa_onnx as so

    threads = threads or max(1, (os.cpu_count() or 4))
    mod = programm_ordner() / "modelle"
    seg = modell("segmentierung", mod)
    stimme = modell("stimme", mod)
    enc, dec, tok = whisper_dateien(modell("turbo", mod))

    t0 = time.time()
    print(f"\nLese {pfad.name} …")
    ton = ton_laden(pfad)
    laenge = len(ton) / SR
    if laenge < 1:
        raise SystemExit("Die Datei enthält keinen Ton.")
    print(f"   {dauer_text(laenge)} Ton")

    # 1) Wer spricht wann
    print("\n[1/2] Sprecher trennen …")
    cfg = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(seg / "model.int8.onnx")),
            num_threads=threads),
        embedding=so.SpeakerEmbeddingExtractorConfig(model=str(stimme), num_threads=threads),
        # Personenzahl bekannt -> genau so viele Stimmen. Sonst Schwelle: höher
        # = weniger Sprecher; 0,7 traf im Test die richtige Zahl.
        clustering=so.FastClusteringConfig(num_clusters=personen if personen > 0 else -1, threshold=0.7),
        min_duration_on=0.3, min_duration_off=0.5)
    if not cfg.validate():
        raise SystemExit("Modelle unvollständig – Ordner „modelle“ löschen und neu starten.")
    dia = so.OfflineSpeakerDiarization(cfg)

    def fortschritt(fertig, gesamt):
        print(f"\r   {fertig * 100 // max(1, gesamt)} %   ", end="", flush=True)
        return 0
    roh = dia.process(ton, callback=fortschritt).sort_by_start_time()
    print()
    abschnitte = zusammenlegen([Abschnitt(s.start, s.end, s.speaker) for s in roh])
    print(f"   {len({a.sprecher for a in abschnitte})} Stimmen, {len(abschnitte)} Beiträge "
          f"({dauer_text(time.time() - t0)})")

    # 2) Was wird gesagt
    print("\n[2/2] Text erkennen – das dauert …")
    asr = so.OfflineRecognizer.from_whisper(
        encoder=str(enc), decoder=str(dec), tokens=str(tok),
        language="de", task="transcribe", num_threads=threads)
    sprach_s = sum(a.ende - a.start for a in abschnitte)
    erledigt, t1 = 0.0, time.time()
    vorne = np.zeros(int(STILLE_VORNE_S * SR), dtype=np.float32)
    hinten = np.zeros(int(STILLE_HINTEN_S * SR), dtype=np.float32)
    for a in abschnitte:
        texte = []
        for s, e in zerteilen(a):
            stream = asr.create_stream()
            stream.accept_waveform(SR, np.concatenate([vorne, ton[int(s * SR):int(e * SR)], hinten]))
            asr.decode_stream(stream)
            texte.append(stream.result.text.strip())
            erledigt += e - s
            lief = time.time() - t1
            rest = lief / erledigt * (sprach_s - erledigt) if erledigt else 0
            print(f"\r   {erledigt * 100 / sprach_s:.0f} %  ·  noch ca. {dauer_text(rest)}      ",
                  end="", flush=True)
        a.text = text_sauber(" ".join(texte))
    print()

    ziel = pfad.with_name(pfad.stem + "-transkript.txt")
    ziel.write_text(transkript_text(abschnitte), encoding="utf-8")
    gesamt = time.time() - t0
    print(f"\nFertig in {dauer_text(gesamt)} (Ton: {dauer_text(laenge)}, "
          f"Faktor {gesamt / laenge:.2f}).")
    print(f"Transkript: {ziel}")
    return ziel


def datei_waehlen() -> Path | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    start = Path.home() / "Downloads"
    p = filedialog.askopenfilename(
        title="Spielabend-Aufnahme wählen",
        initialdir=str(start if start.exists() else Path.home()),
        filetypes=[("Tonaufnahmen", "*.webm *.ogg *.m4a *.mp3 *.wav *.flac *.mp4"), ("Alle Dateien", "*.*")])
    root.destroy()
    return Path(p) if p else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Spielabend-Aufnahme -> Transkript mit Sprechern")
    ap.add_argument("datei", nargs="?", help="Tondatei (webm, ogg, mp3, wav …)")
    ap.add_argument("--personen", type=int, default=None, help="Leute am Tisch inkl. SL (0 = automatisch)")
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args(argv)
    doppelklick = args.datei is None

    print("Sundered Skies – Transkribierer (läuft komplett offline)\n")
    pfad = Path(args.datei) if args.datei else datei_waehlen()
    if not pfad or not pfad.exists():
        print("Keine Datei gewählt.")
        return 1
    personen = args.personen
    if personen is None:
        # Doppelklick/Ziehen: einmal kurz fragen. Mit Zahl trennt es deutlich besser.
        try:
            eingabe = input("Wie viele Leute am Tisch, SL mitgezählt? (Enter = automatisch): ").strip()
            personen = int(eingabe) if eingabe else 0
        except (ValueError, EOFError):
            personen = 0
    try:
        transkribieren(pfad, personen=personen, threads=args.threads)
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        return 1
    if doppelklick or len(sys.argv) <= 2:
        print("\nIn der App: 🎙 Aufnahme & Protokoll → „📝 Transkript → Prompt“ → diese Datei wählen.")
        try:
            input("\nEnter zum Schließen …")
        except EOFError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
