"""Geldbörse je Charakter + Gruppenkasse (Kalle, 18.11.2026).

Die Währung im Himmel nach der Barriere:

- **Fater** – Seelenstein, unheimlich viel wert („eine Milliarde"). Sammelbar,
  wird nie umgerechnet.
- **Lose** – Scheine mit festem Wert: 1/2, 1/5 … 1/100.000 eines Werts – eines
  Faters oder (seit 28.11.2026) einer Stufe, z. B. 1/10 Dreher. Man bezahlt
  damit wie mit einem Geldschein. KEIN Glücksspiel, kein Einlösen (das hatte
  der erste Entwurf falsch verstanden). Auch Lose werden nie umgerechnet.
- **Geld** in Stufen je 100 (Kalle 28.11.2026): 100 Funken = 1 Splitter,
  100 Splitter = 1 Dreher, 100 Dreher = 1 Schicksal (100 Schicksal = 1 Fater,
  aber der Stein bleibt ein Sammelstück). Gespeichert als EIN Betrag in
  Funken unter dem alten Schlüssel „muenzen" (bis dahin hieß das Kleingeld
  „Münzen" - Kalle: „die alten Münzen sind Funken"), also ohne Umbau der
  Spielstände. Wer 5 Dreher bezahlt, bezahlt 50.000 Funken; Wechselgeld gibt
  es so von selbst.

Die App zählt, was jemand hat, und schreibt jede Buchung in einen Verlauf.

Hier nur reine Funktionen (prüfen, buchen, Verlauf). Wem was gehört und wer
was darf, entscheidet ``Game`` (game.py).
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Any, Optional

ARTEN = ("fater", "los", "muenzen")
LOS_NENNER_MAX = 10_000_000       # 1/10.000.000 – weit unter dem kleinsten Los (1/100.000)
MAX_BESTAND = 1_000_000_000       # je Sorte bzw. je Los-Wert; schützt vor Tippfehlern ohne Ende
MAX_FUNKEN = 10 ** 13             # 1.000 Schicksal; bleibt in JS eine genaue Zahl
# Worauf ein Los lauten kann (ohne Angabe: Fater, wie alle Lose vor 28.11.2026).
LOS_STUFEN = ("schicksal", "dreher", "splitter")
_LOS_SCHLUESSEL = re.compile(r"^(\d+)(?:@(" + "|".join(LOS_STUFEN) + r"))?$")
MAX_VERLAUF = 200                 # Buchungen je Börse bzw. Kasse (älteste fallen raus)
MAX_WOFUER = 80
MUENZ_NAME_STANDARD = "Münzen"


def _ganz(x: Any, mn: int = 0, mx: int = MAX_BESTAND) -> Optional[int]:
    """Ganze Zahl in [mn, mx] oder None. bool zählt nicht (True wäre sonst 1)."""
    if isinstance(x, bool):
        return None
    try:
        n = int(x)
    except (TypeError, ValueError):
        return None
    if isinstance(x, float) and x != n:
        return None
    return n if mn <= n <= mx else None


def _max(art: str) -> int:
    return MAX_FUNKEN if art == "muenzen" else MAX_BESTAND


def los_schluessel(nenner: int, stufe: Optional[str] = None) -> str:
    """„1000" = 1/1.000 Fater, „10@dreher" = 1/10 Dreher."""
    return f"{nenner}@{stufe}" if stufe in LOS_STUFEN else str(nenner)


def leerer_stand() -> dict:
    return {"fater": 0, "lose": {}, "muenzen": 0}


def stand(roh: Any) -> dict:
    """Gespeicherten Stand bereinigen (Handbearbeitung, alte Sicherung …).
    Lose als {"<Nenner>": Anzahl}; Werte mit 0 Stück fallen weg."""
    s = leerer_stand()
    if not isinstance(roh, dict):
        return s
    s["fater"] = _ganz(roh.get("fater")) or 0
    s["muenzen"] = _ganz(roh.get("muenzen"), 0, MAX_FUNKEN) or 0
    lose = roh.get("lose")
    if isinstance(lose, dict):
        for k, v in lose.items():
            m = _LOS_SCHLUESSEL.match(str(k))
            nenner, n = (_ganz(m.group(1), 2, LOS_NENNER_MAX) if m else None), _ganz(v)
            if nenner and n:
                s["lose"][los_schluessel(nenner, m.group(2))] = n
    return s


def verlauf(roh: Any) -> list:
    if not isinstance(roh, list):
        return []
    aus = []
    for e in roh:
        if not isinstance(e, dict) or e.get("art") not in ARTEN or _ganz(e.get("n"), -MAX_FUNKEN, MAX_FUNKEN) in (None, 0):
            continue
        aus.append(e)
    return aus[-MAX_VERLAUF:]


def kasse(roh: Any) -> dict:
    """Gruppenkasse aus der Datei: {"stand": …, "verlauf": […]}."""
    roh = roh if isinstance(roh, dict) else {}
    return {"stand": stand(roh.get("stand")), "verlauf": verlauf(roh.get("verlauf"))}


def bestand(s: dict, art: str, los: Optional[str] = None) -> int:
    if art == "los":
        return int(s["lose"].get(str(los), 0))
    return int(s[art])


def posten(a: dict) -> Optional[tuple[str, Optional[str], int]]:
    """(art, los, anzahl) aus einer Aktion – oder None, wenn unbrauchbar.
    los = Schlüssel des Loses („1000", „10@dreher"), sonst None. Anzahl
    immer > 0 (bei Geld in Funken); die Richtung sagt die Aktion selbst."""
    art = a.get("art")
    if art not in ARTEN:
        return None
    anzahl = _ganz(a.get("anzahl"), 1, _max(art))
    if not anzahl:
        return None
    los = None
    if art == "los":
        nenner = _ganz(a.get("nenner"), 2, LOS_NENNER_MAX)
        stufe = a.get("stufe")
        if not nenner or (stufe not in (None, "", "fater") and stufe not in LOS_STUFEN):
            return None
        los = los_schluessel(nenner, stufe)
    return art, los, anzahl


def wofuer(a: dict) -> str:
    return " ".join(str(a.get("wofuer") or "").split())[:MAX_WOFUER]


def geht(s: dict, art: str, los: Optional[str], n: int) -> bool:
    """Bleibt der Bestand nach ±n zwischen 0 und MAX_BESTAND? Ins Minus geht
    nichts: wer 2 Lose hat, kann nicht 3 bezahlen (sonst stimmt der Stand
    nicht mehr mit dem überein, was am Tisch liegt)."""
    return 0 <= bestand(s, art, los) + n <= _max(art)


def buchen(s: dict, liste: list, art: str, los: Optional[str], n: int,
           von: str, text: str, vonId: str = "") -> None:
    """±n verbuchen und in den Verlauf schreiben. Vorher ``geht`` prüfen."""
    if art == "los":
        k = str(los)
        neu = s["lose"].get(k, 0) + n
        if neu:
            s["lose"][k] = neu
        else:
            s["lose"].pop(k, None)
    else:
        s[art] += n
    e = {"id": uuid.uuid4().hex[:10], "ts": int(time.time() * 1000), "art": art, "n": n,
         "von": (von or "")[:60], "vonId": vonId or "", "wofuer": text}
    if los:
        nenner, _, stufe = str(los).partition("@")
        e["nenner"] = int(nenner)
        if stufe:
            e["stufe"] = stufe
    liste.append(e)
    del liste[:-MAX_VERLAUF]


def muenz_name(roh: Any) -> str:
    name = " ".join(str(roh or "").split())[:24]
    return name or MUENZ_NAME_STANDARD
