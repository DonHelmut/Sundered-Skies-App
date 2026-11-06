"""Kampf aus Text: der SL lässt einen Kampf unterwegs von einer KI (Gemini,
ChatGPT …) schreiben und fügt den Text am Spielabend ein (oder lädt ihn als
.txt). Daraus wird ein ganz normaler vorbereiteter Kampf.

Das Format ist fest (``ANLEITUNG`` unten, die bekommt die KI), das Lesen aber
gnädig: KIs halten sich nie ganz daran. Sie setzen **Fett**, Aufzählungs-
zeichen, Überschriften, schreiben „Robustheit 6 (1)" ohne Doppelpunkt oder
alles in eine Zeile mit Semikolons, plaudern vorher („Hier ist dein Kampf:").
Darum: Schlüssel ohne Rücksicht auf Groß/klein, Umlaute und Zierrat erkennen,
alles Unbekannte bei einem Gegner in seine Spielwerte schreiben - lieber
etwas zu viel auf dem Spickzettel als still verloren.

Nur Lesen, keine Seiteneffekte: ``game.py`` legt daraus Kämpfe (und auf
Wunsch Bibliotheks-Vorlagen) an, ``app.py`` zeigt vorher die Vorschau.
"""
from __future__ import annotations

import re
from typing import Optional

TEXT_MAX = 60_000          # ein Kampf ist ein paar KB - mehr ist ein Versehen
GRUPPEN_MAX = 30
ANZAHL_MAX = 20            # mehr Figuren einer Sorte passen nicht auf den Tisch
ZONE_STANDARD = 1          # Nahbereich: KI-Kämpfe sollen gleich losgehen können

# Schlüssel (ohne Umlaute, Leer- und Bindestriche, klein) -> Feld.
_SCHLUESSEL = {
    "kampf": "kampf", "begegnung": "kampf", "titel": "kampf", "kampfname": "kampf",
    "notiz": "notiz", "notizen": "notiz", "hinweis": "notiz", "slnotiz": "notiz",
    "gegner": "gegner", "feind": "gegner", "npc": "gegner", "monster": "gegner",
    "verbuendeter": "verbuendeter", "verbuendete": "verbuendeter", "verbuendet": "verbuendeter",
    "ally": "verbuendeter", "freund": "verbuendeter",
    "anzahl": "anzahl", "menge": "anzahl", "stueck": "anzahl", "stueckzahl": "anzahl",
    "wildcard": "wildcard", "wc": "wildcard", "typ": "wildcard",
    "parade": "parade", "pa": "parade",
    "robustheit": "robustheit", "rob": "robustheit", "zaehigkeit": "robustheit",
    "panzer": "panzer", "ruestung": "panzer", "panzerung": "panzer",
    "zone": "zone", "startzone": "zone", "entfernung": "zone", "position": "zone", "start": "zone",
    "verdeckt": "verdeckt", "anonym": "verdeckt", "geheim": "verdeckt", "unbekannt": "verdeckt",
    "talente": "talente", "talent": "talente", "initiativetalente": "talente",
    "werte": "werte", "spielwerte": "werte", "spickzettel": "werte", "werteblock": "werte",
    "ende": "ende",
}
# Diese kommen nicht als eigenes Feld, sondern beschriftet in die Spielwerte
# (KIs schreiben sie gern als eigene Zeilen).
_WERTE_ZEILEN = {
    "attribute", "fertigkeiten", "ausruestung", "angriffe", "angriff", "waffen",
    "sonderfaehigkeiten", "besonderheiten", "faehigkeiten", "kraefte", "maechte",
    "handicaps", "taktik", "bewegung", "tempo", "beschreibung", "edges", "skills",
}

_ZONEN = [  # (Wortanfang, Zone) - die erste passende gewinnt
    ("nahkampf", 0), ("melee", 0), ("handgemenge", 0),
    ("nah", 1), ("kurz", 1),
    ("fern", 2), ("mittel", 2),
    ("weit", 3), ("lang", 3),
    ("ausser", 4), ("aus", 4), ("out", 4),
]


def _flach(s: str) -> str:
    s = s.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", s)


def _talent_tabelle(talente: dict) -> dict:
    tab = {}
    for key, meta in talente.items():
        tab[_flach(key)] = key
        tab[_flach(meta.get("label", ""))] = key
    return tab


def _zierrat_weg(zeile: str) -> str:
    """Markdown & Co. der KI entfernen, Inhalt behalten."""
    z = zeile.replace("**", "").replace("__", "").replace("`", "")
    z = re.sub(r"^\s*(?:#+|>+|[-*•–·]|\d+[.)])\s+", "", z)
    return z.strip()


_SCHLUESSEL_RE = re.compile(r"^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß \-]{0,30}?)\s*[:=]\s*(.*)$")
# Ohne Doppelpunkt: Zahlen-Felder („Robustheit 6 (1)", „Anzahl 4") und die
# Felder, die man der KI aus dem Auto diktiert („Gegner Wolkenpirat",
# „Zone nah") - so schreiben KIs es auch gern ab.
_OHNE_DP_RE = re.compile(
    r"^(parade|robustheit|panzer|anzahl)\s+(\d.*)$"
    r"|^(kampf|gegner|verb[üu]e?ndeter|zone)\s+(\S.*)$", re.I)


def _schluessel(zeile: str) -> tuple[Optional[str], str, str]:
    """-> (Feld oder None, Wert, Original-Schlüssel)."""
    m = _SCHLUESSEL_RE.match(zeile)
    if m:
        roh, wert = m.group(1).strip(), m.group(2)
    else:
        m = _OHNE_DP_RE.match(zeile)
        if not m:
            return None, zeile, ""
        roh, wert = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
    flach = _flach(roh)
    if flach in _SCHLUESSEL:
        return _SCHLUESSEL[flach], wert.strip(), roh
    if flach in _WERTE_ZEILEN:
        return "werte_zeile", wert.strip(), roh
    return None, zeile, roh


def _zahl(wert: str) -> Optional[int]:
    m = re.search(r"\d+", wert)
    return max(0, min(30, int(m.group()))) if m else None


def _ja(wert: str) -> bool:
    return _flach(wert)[:2] in ("ja", "tr", "wa", "ye", "x") or _flach(wert) in ("1", "wildcard", "wc")


def _zone(wert: str) -> Optional[int]:
    m = re.match(r"\s*([0-4])\b", wert)
    if m:
        return int(m.group(1))
    f = _flach(wert)
    for anfang, zone in _ZONEN:
        if f.startswith(anfang):
            return zone
    return None


def _name_und_anzahl(wert: str) -> tuple[str, Optional[int]]:
    """„Wolkenpirat ×4", „4x Wolkenpirat", „Wolkenpirat (4)"."""
    w = wert.strip()
    for muster, gruppe_name, gruppe_zahl in (
        (r"^(\d+)\s*[x×*]\s+(.+)$", 2, 1),
        (r"^(.+?)\s*[x×*]\s*(\d+)$", 1, 2),
        (r"^(.+?)\s*\((\d+)\)$", 1, 2),
        (r"^(.+?)\s+(?:anzahl|menge)\s*:?\s*(\d+)$", 1, 2),   # diktiert, ohne Komma
    ):
        m = re.match(muster, w, re.I)
        if m:
            return m.group(gruppe_name).strip(), int(m.group(gruppe_zahl))
    return w, None


def _neue_gruppe(name: str, ally: bool) -> dict:
    name, anzahl = _name_und_anzahl(name)
    return {"name": name[:40] or ("Verbündeter" if ally else "Gegner"),
            "anzahl": anzahl or 1, "isWildCard": False, "parade": None,
            "robustheit": None, "panzer": None, "zone": ZONE_STANDARD,
            "anon": False, "ally": ally, "talents": [], "spielwerte": []}


def kampf_aus_text(text: str, talente: dict) -> dict:
    """Liest einen oder mehrere Kämpfe. Rückgabe:
    ``{"kaempfe": [{"name", "note", "gruppen": [...]}], "warnungen": [...]}``.
    Gruppen tragen ``anzahl``; ``spielwerte`` ist schon ein Text."""
    talent_tab = _talent_tabelle(talente)
    kaempfe: list[dict] = []
    warnungen: list[str] = []
    kampf: Optional[dict] = None
    gruppe: Optional[dict] = None

    def kampf_holen() -> dict:
        nonlocal kampf
        if kampf is None:
            kampf = {"name": "", "note": "", "gruppen": []}
            kaempfe.append(kampf)
        return kampf

    zeilen = str(text or "")[:TEXT_MAX].replace("\r\n", "\n").split("\n")
    for nr, roh in enumerate(zeilen, 1):
        if roh.strip().startswith("```"):
            continue
        zeile = _zierrat_weg(roh)
        if not zeile or set(zeile) <= set("-=_*~"):
            continue
        # „Parade: 5; Robustheit: 6 (1)" oder „Gegner Wolkenpirat, Anzahl 4" -
        # mehrere Felder in einer Zeile. Nur trennen, wenn mindestens zwei
        # Stücke Felder sind - „WERTE: Ge W6, Ve W4" bleibt zusammen.
        teile = [zeile]
        if re.search(r"[;|,]", zeile):
            stuecke = [t.strip() for t in re.split(r"[;|,]", zeile) if t.strip()]
            if sum(1 for t in stuecke if _schluessel(t)[0]) >= 2:
                teile = stuecke
        for teil in teile:
            feld, wert, roh_key = _schluessel(teil)
            if feld == "ende":
                gruppe = None
                continue
            if feld == "kampf":
                # Ein zweites KAMPF: beginnt den nächsten Kampf.
                if kampf is not None and (kampf["gruppen"] or kampf["name"]):
                    kampf = None
                kampf_holen()["name"] = wert[:60]
                gruppe = None
                continue
            if feld == "notiz" and gruppe is None:
                k = kampf_holen()
                k["note"] = (k["note"] + " " + wert).strip()[:300]
                continue
            if feld in ("gegner", "verbuendeter"):
                k = kampf_holen()
                if len(k["gruppen"]) >= GRUPPEN_MAX:
                    warnungen.append(f"Zeile {nr}: mehr als {GRUPPEN_MAX} Gegner – Rest weggelassen.")
                    gruppe = None
                    continue
                gruppe = _neue_gruppe(wert, feld == "verbuendeter")
                k["gruppen"].append(gruppe)
                continue
            if gruppe is None:
                # Vor dem ersten Gegner: KI-Geplauder („Hier ist dein Kampf").
                continue
            if feld == "anzahl":
                n = _zahl(wert)
                if n is None or n < 1:
                    warnungen.append(f"Zeile {nr}: Anzahl „{wert}\" nicht verstanden – 1 genommen.")
                gruppe["anzahl"] = max(1, min(ANZAHL_MAX, n or 1))
                if n and n > ANZAHL_MAX:
                    warnungen.append(f"{gruppe['name']}: höchstens {ANZAHL_MAX} Stück.")
            elif feld == "wildcard":
                gruppe["isWildCard"] = _ja(wert)
            elif feld == "parade":
                gruppe["parade"] = _zahl(wert)
            elif feld == "robustheit":
                gruppe["robustheit"] = _zahl(wert)
                klammer = re.search(r"\((\d+)\)", wert)
                if klammer:
                    gruppe["panzer"] = _zahl(klammer.group(1))
            elif feld == "panzer":
                gruppe["panzer"] = _zahl(wert)
            elif feld == "zone":
                z = _zone(wert)
                if z is None:
                    warnungen.append(f"Zeile {nr}: Zone „{wert}\" unbekannt – Nahbereich genommen.")
                gruppe["zone"] = ZONE_STANDARD if z is None else z
            elif feld == "verdeckt":
                gruppe["anon"] = _ja(wert) and not gruppe["ally"]
            elif feld == "talente":
                for t in re.split(r"[,;/]| und ", wert):
                    key = talent_tab.get(_flach(t))
                    if key and key not in gruppe["talents"]:
                        gruppe["talents"].append(key)
                    elif _flach(t) and _flach(t) not in ("keine", "keins", "nein", "") and not key:
                        # Kein Initiative-Talent der App (z. B. „Erstschlag"):
                        # gehört trotzdem auf den Spickzettel.
                        gruppe["spielwerte"].append(f"Talent: {t.strip()}")
            elif feld == "werte":
                if wert:
                    gruppe["spielwerte"].append(wert)
            elif feld == "werte_zeile":
                gruppe["spielwerte"].append(f"{roh_key}: {wert}")
            elif feld == "notiz":
                gruppe["spielwerte"].append(f"Notiz: {wert}")
            else:
                # Unbekannt: bei einem Gegner auf den Spickzettel statt weg.
                gruppe["spielwerte"].append(teil)

    for k in kaempfe:
        for g in k["gruppen"]:
            g["spielwerte"] = "\n".join(g["spielwerte"]).strip()[:3000]
        if not k["name"]:
            k["name"] = (k["gruppen"][0]["name"] if k["gruppen"] else "Kampf")[:60]
    leer = [k for k in kaempfe if not k["gruppen"]]
    if leer:
        warnungen.append("Kein Gegner gefunden – jeder Gegner beginnt mit „GEGNER: Name\".")
    return {"kaempfe": [k for k in kaempfe if k["gruppen"]], "warnungen": warnungen[:20]}


def anleitung(talente: dict) -> str:
    """Text für die KI: einmal kopieren, in Gemini einfügen (oder als „Gem"
    speichern), dann nur noch den Kampf beschreiben."""
    namen = ", ".join(m.get("label", k) for k, m in talente.items())
    return f"""Du hilfst mir, Kämpfe für Savage Worlds (Sundered Skies) vorzubereiten. Ich sage dir kurz, was passiert (z. B. „Kampf: Überfall der Wolkenpiraten, Gegner Wolkenpirat, Anzahl 4"). Du antwortest NUR mit diesem Textblock – ohne Einleitung, ohne Erklärung danach:

KAMPF: <Name des Kampfes>
GEGNER: <Name>
ANZAHL: <Zahl>
ZONE: <Nahkampf, Nahbereich, Fernbereich oder Weitbereich – nur wenn ich es sage>

Regeln:
- Für jede Gegnersorte ein eigener GEGNER-Block. Verbündete mit VERBÜNDETER: statt GEGNER:.
- Erfinde nichts dazu. Nur wenn ich es ausdrücklich nenne, kommen diese Zeilen in den Block:
  NOTIZ: <Hinweis für den Spielleiter> (gehört unter KAMPF)
  WILDCARD: ja/nein · PARADE: <Zahl> · ROBUSTHEIT: <Zahl inkl. Panzer> (<Panzer>) · VERDECKT: ja/nein
  TALENTE: <nur aus: {namen}>
  WERTE: <Attribute, Fertigkeiten, Angriffe – Savage Worlds auf Deutsch>
- Fehlt die Anzahl, schreib ANZAHL: 1.
- Mehrere Kämpfe: jeden mit einer eigenen KAMPF-Zeile beginnen.

Steht unter dieser Anleitung schon ein Kampf, leg gleich los. Sonst antworte nur „Bereit." und warte."""
