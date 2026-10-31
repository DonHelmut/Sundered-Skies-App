"""Eigennamen in der Mitschrift richtigstellen.

Der Spracherkenner kennt „Korgo", „Krauzern" oder „Vexmoor" nicht und schreibt,
was er hört: „Kogo", „Krautsheim", „Wechsmoor". Die App weiß aber, wie Figuren,
Gegner, Verbündete und Spieler heißen – dazu kommt eine eigene Liste des SL
(Orte, Schiffe, NSCs). Jedes Wort (auch zwei, drei hintereinander: „Sturm
Vogel") wird mit diesen Namen verglichen; klingt es fast gleich, wird es
ersetzt.

Bewusst vorsichtig: lieber einen Hörfehler stehen lassen als ein richtiges
Wort in einen Namen verwandeln. Darum nur großgeschriebene Wörter (Namen
schreibt der Erkenner groß), gleicher erster Laut, wenige Buchstaben anders
UND ähnlicher Klang (Kölner Phonetik, das deutsche Gegenstück zu Soundex).
Den Rest bügelt Claude beim Protokoll aus – die Namen stehen auch im Prompt.
"""

from __future__ import annotations

import gzip
import re
from pathlib import Path
from typing import Iterable, Optional

# Häufige Wörter, die am Satzanfang großgeschrieben werden und nie ein Name
# sind - sonst wird aus „Kommt" vielleicht „Komet", wenn ein Schiff so heißt.
_NIE = set("""
ich du er sie es wir ihr man der die das den dem des ein eine einen einem einer und oder aber
dann doch noch auch nicht nein ja jaja okay ok gut also so wie was wer wo wann warum wieso hier
dort da jetzt mal schon kann kannst muss musst will willst soll sollst hat habe hast haben ist
bin bist sind war waren wird werden würde wäre gibt geht kommt macht sag sagt sagen mach machen
alle alles kein keine keiner mein meine dein deine sein seine euer eure unser unsere dieser diese
dieses jeder jede jedes bitte danke genau klar stimmt vielleicht eigentlich wirklich warte moment
nach vor mit ohne für gegen über unter zwischen durch beim zum zur vom bis seit wegen trotz
erst zuerst nochmal wieder immer nie heute morgen gestern dann denn weil wenn falls ob dass
runde karte karten joker benny bennies probe würfel wunde wunden initiative angeschlagen
""".split())
# Titel vor Namen gelten nicht als eigener Name („Kapitän Branok" -> „Branok").
_TITEL = {"kapitän", "käpt'n", "käptn", "lord", "lady", "herr", "frau", "meister", "meisterin",
          "bruder", "schwester", "vater", "mutter", "sir", "der", "die", "das", "von", "zu", "van", "de"}
_WORT = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", re.UNICODE)
_NUMMER_HINTEN = re.compile(r"\s+\d+$")      # „Ork 3" -> „Ork" (die App nummeriert)
_ANZAHL_VORN = re.compile(r"^\d+\s*[×x]\s*")  # „3× Ork" (aus den Kampfmarken)
MAX_WOERTER = 3
_ENDUNGEN = ("n", "en", "e", "s", "es", "er", "ern", "em", "st", "t", "te", "ten", "los", "chen")

# Wörterbuch: Ein echtes deutsches Wort wird nie zum Namen. Ohne diesen Schutz
# machte die Korrektur im Test aus „Mir" „Mira", aus „Daraus" „Darius", aus
# „Kreuzer" „Krauzern" und aus „Wolken" „Wolkenhai" (26 von 29 000 häufigen
# Wörtern). Mit ihm keins. Preis: hört der Erkenner statt eines Namens ein
# echtes Wort („Kongo" statt „Korgo"), bleibt es stehen - das richtet Claude.
_WOERTERBUCH = Path(__file__).with_name("woerter-de.txt.gz")
_woerter: Optional[frozenset] = None


def deutsche_woerter() -> frozenset:
    global _woerter
    if _woerter is None:
        try:
            with gzip.open(_WOERTERBUCH, "rt", encoding="utf-8") as f:
                _woerter = frozenset(z.strip() for z in f if z.strip() and not z.startswith("#"))
        except OSError:
            _woerter = frozenset()
    return _woerter


def koelner(wort: str) -> str:
    """Kölner Phonetik: gleich klingende deutsche Wörter -> gleicher Code
    („Meier"/„Mayr" -> 67). Doppelte Ziffern und Vokale (0) fallen weg,
    außer am Anfang."""
    w = (wort.lower().replace("ä", "a").replace("ö", "o").replace("ü", "u")
         .replace("ß", "s").replace("ph", "f"))
    w = "".join(c for c in w if "a" <= c <= "z")
    codes = []
    for i, c in enumerate(w):
        vor = w[i - 1] if i else ""
        nach = w[i + 1] if i + 1 < len(w) else ""
        if c in "aeijouy":
            z = "0"
        elif c == "h":
            z = ""
        elif c == "b" or (c == "p" and nach != "h"):
            z = "1"
        elif c in "dt":
            z = "8" if nach in ("c", "s", "z") else "2"
        elif c in "fvw" or c == "p":
            z = "3"
        elif c in "gkq":
            z = "4"
        elif c == "c":
            if i == 0:
                z = "4" if nach in "ahkloqrux" else "8"
            else:
                z = "8" if vor in ("s", "z") or nach not in "ahkoqux" else "4"
        elif c == "x":
            z = "8" if vor in ("c", "k", "q") else "48"
        elif c == "l":
            z = "5"
        elif c in "mn":
            z = "6"
        elif c == "r":
            z = "7"
        elif c in "sz":
            z = "8"
        else:
            z = ""
        codes.append(z)
    roh = "".join(codes)
    ohne_doppelt = "".join(c for i, c in enumerate(roh) if i == 0 or c != roh[i - 1])
    if not ohne_doppelt:
        return ""
    return ohne_doppelt[0] + ohne_doppelt[1:].replace("0", "")


def abstand(a: str, b: str) -> int:
    """Levenshtein: so viele Buchstaben einfügen/löschen/tauschen."""
    if len(a) < len(b):
        a, b = b, a
    vorher = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        jetzt = [i]
        for j, cb in enumerate(b, 1):
            jetzt.append(min(vorher[j] + 1, jetzt[j - 1] + 1, vorher[j - 1] + (ca != cb)))
        vorher = jetzt
    return vorher[-1]


def _kern(s: str) -> str:
    return "".join(c for c in s.lower() if c.isalpha())


def _aehnlich(gehoert: str, name: str) -> float:
    """0..1, ab ~0,75 „klingt gleich". 0 heißt: auf keinen Fall."""
    if gehoert == name:
        return 1.0
    # Kurze Namen (4 Buchstaben) nur bei einem einzigen anderen Buchstaben -
    # bei „Mira" wäre sonst schnell alles Mögliche gemeint.
    if len(name) < 4:
        return 0.0
    kg, kn = koelner(gehoert), koelner(name)
    if not kg or not kn or kg[0] != kn[0]:
        return 0.0          # anderer erster Laut: „Sache" ist nicht „Wache"
    # Länge fast gleich - bei gleichem Klang darf es mehr sein („Wechsmoor").
    diff = abs(len(gehoert) - len(name))
    if diff > max(1, len(name) // (3 if kg == kn else 4)):
        return 0.0
    buchst = 1 - abstand(gehoert, name) / max(len(gehoert), len(name))
    klang = 1 - abstand(kg, kn) / max(len(kg), len(kn))
    if len(name) <= 4:
        return buchst if abstand(gehoert, name) <= 1 and klang >= 0.5 else 0.0
    if buchst >= 0.75 and klang >= 0.6:
        return (buchst + klang) / 2
    # Zwei Buchstaben anders, Klang fast gleich („Branno" ~ „Branok").
    if len(name) >= 6 and buchst >= 0.66 and klang >= 0.75:
        return (buchst + klang) / 2
    # Gleicher Klang, anders geschrieben („Wechsmoor" ~ „Vexmoor") - erst ab
    # 6 Buchstaben: „Tasse" klingt nach Kölner Phonetik genau wie „Tessa".
    if klang == 1.0 and buchst >= 0.55 and len(name) >= 6:
        return (buchst + klang) / 2
    return 0.0


def namen_bereinigen(roh: Iterable[str]) -> list[str]:
    """Namen aus App und Liste: Nummern weg, Doppelte weg, Mehrwort-Namen
    zusätzlich in ihre Teile („Kapitän Branok" -> auch „Branok")."""
    erg: dict[str, str] = {}
    for n in roh:
        if not isinstance(n, str):
            continue
        n = _ANZAHL_VORN.sub("", _NUMMER_HINTEN.sub("", " ".join(n.split())))[:60]
        if len(_kern(n)) < 3:
            continue
        teile = [t for t in _WORT.findall(n)]
        if not teile or len(teile) > MAX_WOERTER:
            continue
        erg.setdefault(_kern(n), " ".join(teile))
        if len(teile) > 1:
            for t in teile:
                if t.lower() not in _TITEL and t.lower() not in _NIE and len(t) >= 4:
                    erg.setdefault(_kern(t), t)
    return sorted(erg.values(), key=lambda x: (-len(x), x))


class Namenskorrektur:
    def __init__(self, namen: Iterable[str]) -> None:
        self.namen = namen_bereinigen(namen)
        self._kerne = [(_kern(n), n, n.count(" ") + 1) for n in self.namen]
        self._woerter = deutsche_woerter() if self._kerne else frozenset()

    def __bool__(self) -> bool:
        return bool(self.namen)

    def ist_wort(self, w: str) -> bool:
        """Deutsches Wort, auch gebeugt („Kreuzern" von „Kreuzer")?"""
        if w in self._woerter:
            return True
        return any(w.endswith(e) and len(w) - len(e) >= 3 and w[:-len(e)] in self._woerter
                   for e in _ENDUNGEN)

    def _bester(self, woerter: list[str]) -> Optional[tuple[float, str, str]]:
        """(Ähnlichkeit, Name, Endung) für diese Wortfolge oder None."""
        klein = [w.lower() for w in woerter]
        if len(woerter) == 1:
            if klein[0] in _NIE or self.ist_wort(klein[0]):
                return None
        elif any(w in _NIE for w in klein):
            return None
        gehoert = _kern("".join(woerter))
        best = None
        for kern, name, n in self._kerne:
            if n > len(woerter) + 1:
                continue
            for g, endung in ((gehoert, ""), (gehoert[:-1], "s") if gehoert.endswith("s") else (None, None)):
                if not g or (endung and kern.endswith("s")):
                    continue
                s = _aehnlich(g, kern)
                # Mehrere echte Wörter („Sturm Vogel") nur bei fast gleich.
                if s and len(woerter) > 1 and s < 0.85 and all(w in self._woerter for w in klein):
                    continue
                if s and (best is None or s > best[0]):
                    best = (s, name, endung)
        return best

    def korrigieren(self, text: str) -> str:
        if not self._kerne or not text:
            return text
        treffer = list(_WORT.finditer(text))
        aus, pos, i = [], 0, 0
        while i < len(treffer):
            m = treffer[i]
            if not m.group()[0].isupper():
                i += 1
                continue
            wahl = None
            for n in range(min(MAX_WOERTER, len(treffer) - i), 0, -1):
                folge = treffer[i:i + n]
                # Mehrere Wörter nur, wenn nichts dazwischen steht außer Leerzeichen.
                if any(text[a.end():b.start()].strip() for a, b in zip(folge, folge[1:])):
                    continue
                b = self._bester([x.group() for x in folge])
                # Bei Gleichstand gewinnt die längere Folge („Sturm Vogel"
                # -> „Sturmvogel"), sonst das bessere Ergebnis.
                if b and (wahl is None or b[0] > wahl[0][0]):
                    wahl = (b, n)
            if wahl:
                (s, name, endung), n = wahl
                ersatz = name + endung
                alt = text[m.start():treffer[i + n - 1].end()]
                if alt != ersatz:
                    aus.append(text[pos:m.start()])
                    aus.append(ersatz)
                    pos = treffer[i + n - 1].end()
                i += n
            else:
                i += 1
        aus.append(text[pos:])
        return "".join(aus)


def namen_aus_spiel(game) -> list[str]:
    """Alle Namen, die die App gerade kennt: Kampf, Spieler, Vorlagen."""
    namen: list[str] = []
    for liste in ("combatants", "roster", "bestiary", "allies"):
        for c in getattr(game, liste, None) or []:
            if isinstance(c, dict):
                namen += [c.get("name"), c.get("playerName")]
    for p in getattr(game, "players", None) or []:
        if isinstance(p, dict):
            namen.append(p.get("name"))
    return [n for n in namen if isinstance(n, str) and n.strip()]
