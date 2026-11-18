"""Geldbörse je Charakter + Gruppenkasse (Kalle, 18.11.2026).

Die Währung im Himmel nach der Barriere ist Bargeld in drei Sorten:

- **Fater** – Seelenstein, unheimlich viel wert („eine Milliarde").
- **Lose** – Scheine mit festem Wert: 1/2, 1/5 … 1/100.000 Fater. Man bezahlt
  damit wie mit einem Geldschein. KEIN Glücksspiel, kein Einlösen (das hatte
  der erste Entwurf falsch verstanden).
- **Münzen** – Kleingeld, winzig. Echter Name steht noch aus, darum stellt
  der SL ihn ein (``muenzName``).

Die App rechnet bewusst NICHT um: Kalle kennt den Kurs Münzen↔Los selbst noch
nicht („kaum berechenbar"). Sie zählt nur, was jemand hat, und schreibt jede
Buchung in einen Verlauf. Wechselgeld sind darum zwei Buchungen (Los raus,
Münzen rein).

Hier nur reine Funktionen (prüfen, buchen, Verlauf). Wem was gehört und wer
was darf, entscheidet ``Game`` (game.py).
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Optional

ARTEN = ("fater", "los", "muenzen")
LOS_NENNER_MAX = 10_000_000       # 1/10.000.000 – weit unter dem kleinsten Los (1/100.000)
MAX_BESTAND = 1_000_000_000       # je Sorte bzw. je Los-Wert; schützt vor Tippfehlern ohne Ende
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


def leerer_stand() -> dict:
    return {"fater": 0, "lose": {}, "muenzen": 0}


def stand(roh: Any) -> dict:
    """Gespeicherten Stand bereinigen (Handbearbeitung, alte Sicherung …).
    Lose als {"<Nenner>": Anzahl}; Werte mit 0 Stück fallen weg."""
    s = leerer_stand()
    if not isinstance(roh, dict):
        return s
    s["fater"] = _ganz(roh.get("fater")) or 0
    s["muenzen"] = _ganz(roh.get("muenzen")) or 0
    lose = roh.get("lose")
    if isinstance(lose, dict):
        for k, v in lose.items():
            nenner, n = _ganz(k, 2, LOS_NENNER_MAX), _ganz(v)
            if nenner and n:
                s["lose"][str(nenner)] = n
    return s


def verlauf(roh: Any) -> list:
    if not isinstance(roh, list):
        return []
    aus = []
    for e in roh:
        if not isinstance(e, dict) or e.get("art") not in ARTEN or _ganz(e.get("n"), -MAX_BESTAND, MAX_BESTAND) in (None, 0):
            continue
        aus.append(e)
    return aus[-MAX_VERLAUF:]


def kasse(roh: Any) -> dict:
    """Gruppenkasse aus der Datei: {"stand": …, "verlauf": […]}."""
    roh = roh if isinstance(roh, dict) else {}
    return {"stand": stand(roh.get("stand")), "verlauf": verlauf(roh.get("verlauf"))}


def bestand(s: dict, art: str, nenner: Optional[int] = None) -> int:
    if art == "los":
        return int(s["lose"].get(str(nenner), 0))
    return int(s[art])


def posten(a: dict) -> Optional[tuple[str, Optional[int], int]]:
    """(art, nenner, anzahl) aus einer Aktion – oder None, wenn unbrauchbar.
    Anzahl immer > 0; die Richtung sagt die Aktion selbst."""
    art = a.get("art")
    if art not in ARTEN:
        return None
    anzahl = _ganz(a.get("anzahl"), 1)
    if not anzahl:
        return None
    nenner = None
    if art == "los":
        nenner = _ganz(a.get("nenner"), 2, LOS_NENNER_MAX)
        if not nenner:
            return None
    return art, nenner, anzahl


def wofuer(a: dict) -> str:
    return " ".join(str(a.get("wofuer") or "").split())[:MAX_WOFUER]


def geht(s: dict, art: str, nenner: Optional[int], n: int) -> bool:
    """Bleibt der Bestand nach ±n zwischen 0 und MAX_BESTAND? Ins Minus geht
    nichts: wer 2 Lose hat, kann nicht 3 bezahlen (sonst stimmt der Stand
    nicht mehr mit dem überein, was am Tisch liegt)."""
    return 0 <= bestand(s, art, nenner) + n <= MAX_BESTAND


def buchen(s: dict, liste: list, art: str, nenner: Optional[int], n: int,
           von: str, text: str, vonId: str = "") -> None:
    """±n verbuchen und in den Verlauf schreiben. Vorher ``geht`` prüfen."""
    if art == "los":
        k = str(nenner)
        neu = s["lose"].get(k, 0) + n
        if neu:
            s["lose"][k] = neu
        else:
            s["lose"].pop(k, None)
    else:
        s[art] += n
    e = {"id": uuid.uuid4().hex[:10], "ts": int(time.time() * 1000), "art": art, "n": n,
         "von": (von or "")[:60], "vonId": vonId or "", "wofuer": text}
    if nenner:
        e["nenner"] = nenner
    liste.append(e)
    del liste[:-MAX_VERLAUF]


def muenz_name(roh: Any) -> str:
    name = " ".join(str(roh or "").split())[:24]
    return name or MUENZ_NAME_STANDARD
