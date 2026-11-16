"""Sprecher nach Sitzplatz (server/richtung.py): Rechnen, Datei, Mithören -
alles ohne echtes Mikro."""
import pytest

from server import richtung as R

np = pytest.importorskip("numpy")
FS = 16000


def _kapseln(dauer_s, verzoegerung, pegel, seed=0):
    """Rauschen (wie Sprache breitbandig) auf 4 Kapseln: je Kapsel um
    ``verzoegerung`` Samples später und um ``pegel`` (Faktor) leiser."""
    rng = np.random.default_rng(seed)
    x = rng.normal(size=int(dauer_s * FS) + 16).astype(np.float32)
    return np.stack([np.roll(x, d)[8:-8] * p for d, p in zip(verzoegerung, pegel)])


def test_rahmen_messen_laufzeit_und_pegel():
    y = _kapseln(1.0, [0, 2, 0, -1], [1.0, 0.5, 1.0, 1.0])
    m = R.rahmen_merkmale(y, FS)
    assert m.shape == (10, R.N_WERTE)
    mitte = np.median(m, axis=0)
    # Kapsel 2 halb so laut: 6 dB unter den anderen.
    assert mitte[1] - mitte[0] == pytest.approx(-6.0, abs=0.5)
    # Paar (0,1): Kapsel 2 hört es 2 Samples später = 0,125 ms; Paar (0,3) früher.
    assert abs(mitte[4]) == pytest.approx(2 / FS * 1000, abs=0.02)
    assert abs(mitte[6]) == pytest.approx(1 / FS * 1000, abs=0.02)
    assert np.sign(mitte[4]) == -np.sign(mitte[6])
    assert abs(mitte[5]) < 0.02                      # Paar (0,2): gleichzeitig


def test_zwei_plaetze_ergeben_zwei_ecken_ohne_die_bauform_zu_kennen():
    a = R.rahmen_merkmale(_kapseln(6.0, [0, 2, 3, 1], [1.0, 0.7, 0.5, 0.8], 1), FS)
    b = R.rahmen_merkmale(_kapseln(6.0, [3, 1, 0, 2], [0.5, 0.8, 1.0, 0.7], 2), FS)
    m = np.vstack([a, b])
    fenster = [(float(i), i + 1.5) for i in range(0, 10)]
    f, da = R.fenster_merkmale(np.arange(len(m)) * R.HOP_S, m, fenster)
    assert da.all()
    n = R.normieren(f, da)
    links, rechts = n[:4], n[6:]                     # Fenster ganz in a bzw. ganz in b
    innen = np.abs(links - links.mean(0)).max()
    assert np.abs(links.mean(0) - rechts.mean(0)).max() > 5 * max(innen, 0.05)


def _schreiben(pfad, start_ms, m, versatz_ms=0):
    with open(pfad, "wb") as fh:
        fh.write(R._MAGIC)
        for i, w in enumerate(m):
            fh.write(R._SATZ.pack(start_ms + versatz_ms + i * 100, *w.tolist()))


def test_datei_lesen_uebersteht_abgeschnittenes_ende(tmp_path):
    m = R.rahmen_merkmale(_kapseln(2.0, [0, 1, 2, 3], [1, 1, 1, 1]), FS)
    p = tmp_path / "x-richtung.bin"
    _schreiben(p, 1000, m)
    with open(p, "ab") as fh:
        fh.write(b"\x00" * 11)                       # Laptop aus mitten im Satz
    t, w = R.lesen(p)
    assert len(t) == len(m) and t[0] == 1000 and np.allclose(w, m)
    assert R.lesen(tmp_path / "gibtsnicht.bin") is None
    (tmp_path / "falsch.bin").write_bytes(b"irgendwas")
    assert R.lesen(tmp_path / "falsch.bin") is None


def _abend(seed=5):
    """30 s: abwechselnd Platz A, Stille, Platz B - Ton (Mischung) + Kapseln."""
    rng = np.random.default_rng(seed)
    teile, plan = [], []
    for i in range(10):
        ecke = i % 2
        y = _kapseln(2.0, [0, 2, 3, 1] if ecke == 0 else [3, 1, 0, 2],
                     [1.0, 0.7, 0.5, 0.8] if ecke == 0 else [0.5, 0.8, 1.0, 0.7], seed + i)
        huelle = 0.4 + 0.3 * np.sin(np.linspace(0, 9, y.shape[1]) + i) ** 2    # Sprache schwankt
        teile.append(y * huelle * 0.3)
        teile.append(0.001 * rng.normal(size=(4, FS)).astype(np.float32))
        plan.append((i * 3.0, i * 3.0 + 2.0, ecke))
    y4 = np.concatenate(teile, axis=1).astype(np.float32)
    return y4, y4.mean(0), plan


def test_fuer_ton_gleicht_versatz_aus_und_laesst_pausen_weg(tmp_path):
    y4, ton, plan = _abend()
    m = R.rahmen_merkmale(y4, FS)
    start = 1_700_000_000_000
    p = tmp_path / "a-richtung.bin"
    # Der Server fing 0,6 s früher an zu stempeln als der Browser aufnahm.
    _schreiben(p, start, m, versatz_ms=-600)
    fenster = [(s + 0.2, s + 1.7) for s, e, _ in plan]
    f, da = R.fuer_ton(p, {"start": start, "pausen": []}, ton, FS, fenster)
    assert da.all()
    a = f[[i for i, x in enumerate(plan) if x[2] == 0]]
    b = f[[i for i, x in enumerate(plan) if x[2] == 1]]
    assert np.abs(a.mean(0) - b.mean(0)).max() > 1.0 > np.abs(a - a.mean(0)).max()
    # Ohne Datei / zu wenig abgedeckt -> None (dann nur nach Stimme).
    assert R.fuer_ton(tmp_path / "nix.bin", {"start": start}, ton, FS, fenster) is None
    _schreiben(p, start, m[:60])
    assert R.fuer_ton(p, {"start": start, "pausen": []}, ton, FS, fenster) is None


def test_stumme_kapseln_zaehlen_nicht(tmp_path):
    # Immersive aus: Kanäle 3–6 liefern nichts Unterscheidbares.
    y4, ton, plan = _abend()
    gleich = np.stack([ton] * 4)
    p = tmp_path / "a-richtung.bin"
    _schreiben(p, 0, R.rahmen_merkmale(gleich, FS))
    fenster = [(s + 0.2, s + 1.7) for s, e, _ in plan]
    assert R.fuer_ton(p, {"start": 0, "pausen": []}, ton, FS, fenster) is None


class _FalscherStrom:
    def __init__(self, **kw):
        self.kw, self.lief = kw, False

    def start(self):
        self.lief = True

    def stop(self):
        self.lief = False

    def close(self):
        pass


def test_mithoerer_schreibt_rahmen_aus_den_kapsel_kanaelen(tmp_path):
    y4, _, _ = _abend()
    strom = {}

    def oeffnen(**kw):
        strom["s"] = _FalscherStrom(**kw)
        return strom["s"]
    mh = R.Mithoerer()
    p = tmp_path / "a-richtung.bin"
    uhr = {"t": 1000.0}
    assert mh.starten(p, {"index": 3, "name": "SSL CONNEX", "fs": FS, "kanaele": 6}, oeffnen, lambda: uhr["t"])
    assert mh.laeuft and strom["s"].kw["channels"] == 6 and strom["s"].kw["device"] == 3
    # Wie PortAudio: Blöcke (frames, 6) - Kanal 1–2 Mischung, 3–6 die Kapseln.
    sechs = np.concatenate([np.zeros((2, y4.shape[1]), dtype=np.float32), y4]).T
    for i, a in enumerate(range(0, FS * 3, 1000)):   # krumme Blockgröße
        # Blöcke kommen zappelig an (mal früh, mal spät) - die Zeitstempel
        # der Rahmen bleiben trotzdem im 0,1-s-Takt.
        uhr["t"] = 1000.0 + (a + 1000) / FS + (0.03 if i % 3 == 0 else 0.0)
        strom["s"].kw["callback"](sechs[a:a + 1000], 1000, None, None)
    mh.stoppen()
    assert not mh.laeuft
    t, w = R.lesen(p)
    assert len(w) == 30 and np.allclose(np.diff(t), 100, atol=0.01)
    assert t[0] == pytest.approx(1000.0 * 1000 + 30, abs=1)
    assert np.allclose(w[:20], R.rahmen_merkmale(y4, FS)[:20], atol=1e-3)


def test_mithoerer_ohne_geraet_oder_mit_fehler_stoert_nicht(tmp_path, monkeypatch):
    mh = R.Mithoerer()
    monkeypatch.setattr(R, "geraet_finden", lambda: None)
    assert not mh.starten(tmp_path / "a-richtung.bin") and not mh.laeuft

    def kaputt(**kw):
        raise OSError("Gerät belegt")
    assert not mh.starten(tmp_path / "a-richtung.bin", {"index": 0, "name": "x", "fs": FS, "kanaele": 6}, kaputt)
    assert not mh.laeuft and mh.fehler == "OSError"


def test_geraet_finden_nimmt_nur_das_mikro_mit_einzelnen_kapseln(monkeypatch):
    class SD:
        @staticmethod
        def query_devices():
            return [{"name": "Mikrofon (Realtek)", "max_input_channels": 2, "hostapi": 0, "default_samplerate": 48000},
                    {"name": "Mikrofon (SSL CONNEX)", "max_input_channels": 2, "hostapi": 0, "default_samplerate": 48000},
                    {"name": "SSL CONNEX ASIO", "max_input_channels": 6, "hostapi": 1, "default_samplerate": 48000}]

        @staticmethod
        def query_hostapis():
            return [{"name": "Windows WASAPI"}, {"name": "ASIO"}]
    monkeypatch.setattr(R, "_sd", lambda: SD)
    g = R.geraet_finden()
    assert g["index"] == 2 and g["fs"] == 48000 and g["api"] == "ASIO"

    def fehlt():
        raise OSError("PortAudio library not found")
    monkeypatch.setattr(R, "_sd", fehlt)
    assert R.geraet_finden() is None
