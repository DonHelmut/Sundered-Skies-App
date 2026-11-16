"""Sprecher nach Sitzplatz: die vier Kapseln des Tischmikros hören mit.

Vorgeschichte (15.11.2026, Kalle: „Hauptsache Sprecher werden gut erkannt"):
Größere Stimm-Modelle brachten in der Messung nichts - bei fünf Männern am
Tisch klingen sich die Stimmen im 1,5-s-Fenster einfach zu ähnlich. Was am
Spieltisch aber jeder hat: einen festen Platz. Kalles Mikro (SSL Connex) hat
vier Kapseln rundum und gibt sie im „Immersive"-Modus einzeln heraus (USB-
Kanäle 3–6, 1–2 bleibt die Mischung). Daraus wird hier je Zehntelsekunde ein
„Fingerabdruck der Richtung":

- Pegel-Unterschied je Kapsel (wer näher an Kapsel 2 sitzt, ist dort lauter),
- Laufzeit-Unterschied je Kapselpaar (GCC-PHAT).

Bewusst OHNE die Bauform des Mikros zu kennen (Abstände, Richtcharakteristik
stehen in keinem Datenblatt): es wird kein Winkel ausgerechnet, nur verglichen,
ob zwei Stellen der Aufnahme „aus derselben Ecke" kommen. Gemessen am
nachgebauten Tisch: siehe ENTWICKLUNG.md.

Der Browser kann das nicht (MediaRecorder: höchstens Stereo). Darum hört der
Server während der Aufnahme selbst am Mikro mit (sounddevice/PortAudio) und
schreibt NUR diese Merkmale nach „<name>-richtung.bin" (4 h ≈ 10 MB) - kein
zweiter Ton. Die eigentliche Aufnahme bleibt, wie sie war. Fehlt das Mikro,
der Treiber oder sounddevice, passiert schlicht nichts: die Mitschrift
sortiert dann nur nach Stimme.
"""

from __future__ import annotations

import struct
import threading
import time
from pathlib import Path
from typing import Callable, Optional

HOP_S = 0.1                 # ein Merkmal-Rahmen je Zehntelsekunde
BAND_HZ = (300.0, 4000.0)   # Sprache; darunter Brummen/Tischklopfen, darüber Rauschen
MAX_LAUFZEIT_MS = 0.45      # ~15 cm Kapselabstand - mehr hat kein Tischmikro
PAARE = ((0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3))
N_WERTE = 17                # 4 Pegel, 6 Laufzeiten, 6 Güte, 1 Energie
_MAGIC = b"SSRICHT1"
_SATZ = struct.Struct("<d17f")
# Das Mikro: Name enthält …, einzelne Kapseln ab Kanal … (0-basiert).
GERAET_NAME = "connex"
KAPSEL_AB, KAPSELN = 2, 4


# --- Rechnen (nur numpy, ohne Gerät testbar) -----------------------------------------

class Rahmen:
    """Merkmale je Rahmen aus 4 Kanälen. Einmal anlegen (Fenster, Frequenzen),
    dann je Block ``rechnen``."""

    def __init__(self, fs: int) -> None:
        import numpy as np
        self.fs = int(fs)
        self.n = int(round(HOP_S * self.fs))
        self.nfft = 1 << (self.n * 2 - 1).bit_length()
        f = np.fft.rfftfreq(self.nfft, 1.0 / self.fs)
        self.band = (f >= BAND_HZ[0]) & (f <= BAND_HZ[1])
        self.ml = int(MAX_LAUFZEIT_MS / 1000 * self.fs) + 1
        self.win = np.hanning(self.n).astype(np.float32)

    def rechnen(self, block):
        """block: (4, n) -> 17 Werte: Pegel je Kapsel in dB (um ihr Mittel),
        Laufzeit je Paar in ms, Güte je Paar, Energie gesamt in dB."""
        import numpy as np
        X = np.fft.rfft(block * self.win, self.nfft, axis=1)
        e = (np.abs(X[:, self.band]) ** 2).sum(1) + 1e-12
        db = 10 * np.log10(e)
        werte = list(db - db.mean())
        lauf, guete = [], []
        for i, j in PAARE:
            c = X[i] * np.conj(X[j])
            # PHAT: nur die Phase zählt - sonst gewinnt die lauteste Frequenz
            # (Brummen) statt der Richtung.
            c = np.where(self.band, c / (np.abs(c) + 1e-12), 0)
            r = np.fft.irfft(c, self.nfft)
            r = np.concatenate([r[-self.ml:], r[:self.ml + 1]])
            k = int(np.argmax(r))
            off = 0.0
            if 0 < k < len(r) - 1:      # Parabel durch den Gipfel: feiner als ein Sample
                d = r[k - 1] - 2 * r[k] + r[k + 1]
                if d != 0:
                    off = 0.5 * (r[k - 1] - r[k + 1]) / d
            lauf.append((k + off - self.ml) / self.fs * 1000)
            guete.append(r[k] / (np.abs(r).mean() + 1e-9))
        return np.array(werte + lauf + guete + [10 * np.log10(e.sum())], dtype=np.float32)


def rahmen_merkmale(y4, fs: int):
    """Ganzer Ton (4, n) -> (rahmen, 17). Für Tests und Messungen."""
    import numpy as np
    r = Rahmen(fs)
    return np.array([r.rechnen(y4[:, a:a + r.n]) for a in range(0, y4.shape[1] - r.n + 1, r.n)],
                    dtype=np.float32).reshape(-1, N_WERTE)


def fenster_merkmale(zeiten_s, m, fenster: list[tuple[float, float]]):
    """Rahmen (Zeit in s im Ton, Werte) -> je Fenster 10 Werte (4 Pegel,
    6 Laufzeiten) + ob es dort überhaupt Rahmen gab. Median über die lautere
    Hälfte der Rahmen: in den leisen (Atempause, Nachhall) zeigt die Richtung
    irgendwohin."""
    import numpy as np
    z = np.asarray(zeiten_s, dtype=np.float64)
    erg = np.zeros((len(fenster), 10), dtype=np.float32)
    da = np.zeros(len(fenster), dtype=bool)
    for i, (a, b) in enumerate(fenster):
        i0, i1 = np.searchsorted(z, a - HOP_S / 2), np.searchsorted(z, b - HOP_S / 2)
        x = m[i0:i1]
        if len(x) < 3:
            continue
        e = x[:, 16]
        x = x[e >= np.median(e)]
        erg[i] = np.median(x[:, :10], axis=0)
        da[i] = True
    return erg, da


# Mindest-Streuung je Merkmal: darunter ist es Messrauschen. Ohne den Boden
# bläht das Normieren ein Merkmal auf, das gar nichts unterscheidet (nah
# beieinander sitzende Kapseln: Laufzeiten alle ~0).
_BODEN = [1.0] * 4 + [0.01] * 6      # dB, ms


def normieren(f, da):
    """Jedes Merkmal auf vergleichbare Größe (robuste Streuung über die
    Aufnahme), damit Pegel (dB) und Laufzeit (ms) zusammen zählen können."""
    import numpy as np
    x = f[da] if da.any() else f
    mitte = np.median(x, axis=0)
    streu = np.maximum(1.4826 * np.median(np.abs(x - mitte), axis=0), np.array(_BODEN, dtype=np.float32))
    return ((f - mitte) / streu).astype(np.float32)


def versatz_finden(zeiten_s, energie_db, ton, sr: int, max_s: float = 3.0) -> float:
    """Um wie viele Sekunden liegen die Rahmen gegen den Ton daneben? Browser
    und Server fangen nicht im selben Augenblick an (Mikro-Freigabe,
    Puffer) - die Lautstärke-Kurven beider werden übereinandergeschoben.
    Rückgabe: zu den Rahmen-Zeiten addieren."""
    import numpy as np
    z = np.asarray(zeiten_s, dtype=np.float64)
    if len(z) < 50 or len(ton) < sr * 5:
        return 0.0
    n = int(len(ton) / sr / HOP_S)
    h = int(sr * HOP_S)
    a = 10 * np.log10((ton[:n * h].reshape(n, h) ** 2).sum(1) + 1e-9)
    b = np.full(n, np.nan)
    idx = np.round(z / HOP_S).astype(int)
    ok = (idx >= 0) & (idx < n)
    b[idx[ok]] = np.asarray(energie_db)[ok]
    best, best_k = -2.0, 0
    kmax = int(max_s / HOP_S)
    for k in range(-kmax, kmax + 1):
        bb = np.roll(b, k)
        if k > 0:
            bb[:k] = np.nan
        elif k < 0:
            bb[k:] = np.nan
        m = ~np.isnan(bb)
        if m.sum() < 50:
            continue
        x, y = a[m] - a[m].mean(), bb[m] - bb[m].mean()
        c = float((x * y).sum() / (np.sqrt((x * x).sum() * (y * y).sum()) + 1e-9))
        if c > best:
            best, best_k = c, k
    return best_k * HOP_S if best > 0.3 else 0.0


# --- Datei ---------------------------------------------------------------------------

def pfad_fuer(ordner: Path, name: str) -> Path:
    return ordner / f"{name}-richtung.bin"


def lesen(pfad: Path):
    """-> (wand_ms, werte (n, 17)) oder None. Ein abgeschnittener letzter Satz
    (Laptop aus) wird übergangen."""
    import numpy as np
    try:
        roh = pfad.read_bytes()
    except OSError:
        return None
    if not roh.startswith(_MAGIC):
        return None
    roh = roh[len(_MAGIC):]
    n = len(roh) // _SATZ.size
    if n == 0:
        return None
    a = np.frombuffer(roh[:n * _SATZ.size], dtype=np.dtype([("t", "<f8"), ("w", "<f4", (N_WERTE,))]))
    return a["t"].copy(), a["w"].copy()


def fuer_ton(pfad: Path, meta: dict, ton, sr: int, fenster: list[tuple[float, float]]):
    """Alles zusammen für die Mitschrift: normierte Richtungs-Merkmale je
    Fenster + welche Fenster welche haben. None, wenn es keine (brauchbaren)
    gibt - dann sortiert die Mitschrift nur nach Stimme."""
    import numpy as np
    from .aufnahme import ton_ms
    daten = lesen(pfad)
    if daten is None or not fenster:
        return None
    wand, werte = daten
    # Rahmen aus Pausen fallen weg (im Ton gibt es die Pause nicht).
    in_pause = np.zeros(len(wand), dtype=bool)
    for von, bis in meta.get("pausen") or []:
        if bis is not None:
            in_pause |= (wand >= von) & (wand < bis)
    wand, werte = wand[~in_pause], werte[~in_pause]
    if len(wand) < 50:
        return None
    z = np.array([ton_ms(meta, int(t)) for t in wand], dtype=np.float64) / 1000.0
    z += versatz_finden(z, werte[:, 16], ton, sr)
    f, da = fenster_merkmale(z, werte, fenster)
    # Lohnt nur, wenn fast die ganze Aufnahme abgedeckt ist (Mikro mittendrin
    # umgesteckt -> lieber ganz ohne als halb).
    if da.mean() < 0.8:
        return None
    # Kapsel-Kanäle stumm oder alle gleich (Immersive aus, Treiber gibt die
    # Mischung viermal): dann unterscheidet hier nichts - ohne Richtung weiter,
    # statt Rauschen mitzählen zu lassen.
    streu = 1.4826 * np.median(np.abs(f[da] - np.median(f[da], axis=0)), axis=0)
    if np.median(werte[:, 16]) < -90 or (streu[:4].max() < 0.3 and streu[4:].max() < 0.003):
        return None
    return normieren(f, da), da


# --- Mithören (sounddevice) ----------------------------------------------------------

def _sd():
    # ASIO muss vor dem Laden eingeschaltet werden; die Kapseln einzeln gibt
    # es beim Connex laut Handbuch nur über den SSL-Treiber (ASIO).
    import os
    os.environ.setdefault("SD_ENABLE_ASIO", "1")
    import sounddevice as sd
    return sd


def geraet_finden() -> Optional[dict]:
    """Das Tischmikro mit einzelnen Kapseln -> {"index", "name", "fs", "kanaele"}.
    None: nicht da, kein Immersive-Modus/Treiber, oder kein sounddevice."""
    try:
        sd = _sd()
        geraete = list(sd.query_devices())
        apis = sd.query_hostapis()
    except Exception:   # noqa: BLE001 - ohne Ton-Bibliothek gibt es eben keine Richtung
        return None
    treffer = []
    for i, g in enumerate(geraete):
        if GERAET_NAME in str(g.get("name", "")).lower() and g.get("max_input_channels", 0) >= KAPSEL_AB + KAPSELN:
            api = str(apis[g["hostapi"]]["name"]) if g.get("hostapi") is not None else ""
            # WASAPI teilt sich das Mikro sicher mit dem Browser; ASIO meist auch,
            # aber nicht bei jedem Treiber - darum WASAPI zuerst versuchen.
            rang = 0 if "WASAPI" in api else 1 if "ASIO" in api else 2
            treffer.append((rang, {"index": i, "name": str(g["name"]), "api": api,
                                   "fs": int(g.get("default_samplerate") or 48000),
                                   "kanaele": int(g["max_input_channels"])}))
    return min(treffer, key=lambda t: t[0])[1] if treffer else None


def uebersicht(neu: bool = False) -> dict:
    """Für die Einrichtung (server/connex.py): Ist das Mikro überhaupt da, und
    sind seine Kapseln einzeln zu sehen? neu=True liest die Geräteliste frisch
    ein - PortAudio merkt sich sonst den Stand vom ersten Blick (Mikro später
    eingesteckt, Immersive später eingeschaltet). Nicht aufrufen, solange ein
    Mithörer läuft: das Neu-Einlesen würde ihm den Strom wegziehen."""
    try:
        sd = _sd()
        if neu:
            sd._terminate()      # noqa: SLF001 - sounddevice bietet dafür nichts Öffentliches
            sd._initialize()     # noqa: SLF001
        namen = [str(g.get("name", "")).lower() for g in sd.query_devices() if g.get("max_input_channels", 0) > 0]
    except Exception:   # noqa: BLE001
        return {"connex": False, "kapseln": False}
    return {"connex": any(GERAET_NAME in n for n in namen), "kapseln": geraet_finden() is not None}


def geraete_text() -> str:
    """Alle Eingänge mit Kanalzahl in einer Zeile - fürs Diagnose-Protokoll,
    wenn das Mikro nicht gefunden wird (welcher Treiber zeigt was?)."""
    try:
        sd = _sd()
        apis = sd.query_hostapis()
        return "; ".join(f"{g['name']} [{apis[g['hostapi']]['name']}, {g['max_input_channels']} Kan.]"
                         for g in sd.query_devices() if g.get("max_input_channels", 0) > 0) or "keine Eingänge"
    except Exception as e:   # noqa: BLE001
        return f"Ton-Bibliothek fehlt ({e.__class__.__name__})"


class Mithoerer:
    """Läuft neben einer Aufnahme: Kapseln lesen, Merkmale in die Datei."""

    def __init__(self) -> None:
        self._stream = None
        self._datei = None
        self._sperre = threading.Lock()
        self.geraet: Optional[dict] = None
        self.fehler: Optional[str] = None
        self.rahmen = 0

    @property
    def laeuft(self) -> bool:
        return self._stream is not None

    def starten(self, pfad: Path, geraet: Optional[dict] = None,
                oeffnen: Optional[Callable] = None, uhr: Callable[[], float] = time.time) -> bool:
        """oeffnen, uhr: nur für Tests (statt sounddevice.InputStream / Wanduhr)."""
        self.stoppen()
        self.fehler, self.rahmen = None, 0
        geraet = geraet or geraet_finden()
        if not geraet:
            return False
        try:
            import numpy as np
            rechner = Rahmen(geraet["fs"])
            datei = open(pfad, "ab")
            if datei.tell() == 0:
                datei.write(_MAGIC)
            rest = np.zeros((KAPSELN, 0), dtype=np.float32)
            # Zeit je Rahmen: mitgezählte Samples ab dem ersten Block. Die
            # Wanduhr je Block zappelt (Blöcke kommen gebündelt an); gezählt
            # wird sie nur neu gesetzt, wenn beide über 0,5 s auseinanderlaufen
            # (Aussetzer: USB kurz weg, Rechner hing).
            takt = {"anker": None, "gezaehlt": 0}

            def block(daten, frames, zeit, status) -> None:   # noqa: ARG001 - Signatur von PortAudio
                nonlocal rest
                jetzt = uhr() * 1000 - frames / rechner.fs * 1000      # Blockanfang
                if takt["anker"] is None or abs(
                        takt["anker"] + takt["gezaehlt"] / rechner.fs * 1000 - jetzt) > 500:
                    takt["anker"], takt["gezaehlt"] = jetzt, 0
                    rest = rest[:, :0]
                # Den festen Rest-Versatz (Puffer) gleicht versatz_finden() aus.
                t0 = takt["anker"] + (takt["gezaehlt"] - rest.shape[1]) / rechner.fs * 1000
                takt["gezaehlt"] += frames
                x = np.concatenate([rest, daten[:, KAPSEL_AB:KAPSEL_AB + KAPSELN].T], axis=1)
                saetze = []
                a = 0
                while a + rechner.n <= x.shape[1]:
                    w = rechner.rechnen(x[:, a:a + rechner.n])
                    saetze.append(_SATZ.pack(t0 + a / rechner.fs * 1000, *w.tolist()))
                    a += rechner.n
                rest = x[:, a:].copy()
                if saetze:
                    with self._sperre:
                        if self._datei is not None:
                            self._datei.write(b"".join(saetze))
                            self._datei.flush()
                            self.rahmen += len(saetze)
            self._datei = datei
            mach = oeffnen or _sd().InputStream
            self._stream = mach(device=geraet["index"], channels=KAPSEL_AB + KAPSELN,
                                samplerate=geraet["fs"], dtype="float32",
                                blocksize=rechner.n, callback=block)
            self._stream.start()
            self.geraet = geraet
            return True
        except Exception as e:   # noqa: BLE001 - Mikro belegt, Treiber zickt: Aufnahme läuft trotzdem
            self.fehler = e.__class__.__name__
            self.stoppen()
            return False

    def stoppen(self) -> None:
        s, self._stream = self._stream, None
        if s is not None:
            try:
                s.stop()
                s.close()
            except Exception:   # noqa: BLE001
                pass
        with self._sperre:
            d, self._datei = self._datei, None
        if d is not None:
            try:
                d.close()
            except OSError:
                pass
