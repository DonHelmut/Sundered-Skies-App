"""Hausregeln fürs flüssige Bild, direkt im CSS geprüft (schnell, ohne Browser).

Am Handy ruckelt, was der Browser in jedem Frame neu MALEN muss: animierte
box-shadows, Filter, Größen und Positionen. Flüssig bleibt nur, was die
Grafikkarte verschiebt: transform und opacity. Leuchten wird darum fest auf
eine eigene Ebene (::before/::after) gemalt und nur in der Deckkraft gepulst
(Keyframe `glimmen`, siehe CLAUDE.md).
"""
import re
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "web" / "static" / "style.css"

ERLAUBT = {"transform", "opacity", "offset", "visibility", "animation-timing-function"}
# Bewusste Ausnahmen - mit Grund. Neue nur mit gutem Grund dazuschreiben.
AUSNAHMEN = {
    "irisOut": "clip-path, einmal 0,85 s beim Aufdecken (Stil Iris)",
    "wipeOff": "clip-path, einmal 0,85 s beim Aufdecken (Stil Wischen)",
    "jokerRow": "nur TV (Laptop), dort schneidet overflow: hidden eine ::after-Ebene ab",
    "panelAbgelegt": "nur SL-Laptop, einmal 1,2 s nach dem Verschieben eines Panels",
}


def _keyframes(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    for m in re.finditer(r"@keyframes\s+([\w-]+)\s*\{", text):
        i, tiefe = m.end(), 1
        j = i
        while tiefe:
            tiefe += {"{": 1, "}": -1}.get(text[j], 0)
            j += 1
        props = set(re.findall(r"([a-z-]+)\s*:", text[i:j - 1]))
        yield m.group(1), props


def test_animationen_nur_mit_transform_und_opacity():
    schlecht = {name: sorted(props - ERLAUBT) for name, props in _keyframes(CSS.read_text("utf-8"))
                if props - ERLAUBT and name not in AUSNAHMEN}
    assert not schlecht, (
        f"Diese Animationen malen am Handy jeden Frame neu (ruckelt): {schlecht}. "
        f"Schein fest auf ::before/::after legen und nur opacity animieren (glimmen).")


def test_ausnahmen_gibt_es_noch():
    namen = {n for n, _ in _keyframes(CSS.read_text("utf-8"))}
    veraltet = set(AUSNAHMEN) - namen
    assert not veraltet, f"Ausnahme ohne Animation - aus der Liste streichen: {veraltet}"


def test_kein_animierter_filter():
    text = re.sub(r"/\*.*?\*/", "", CSS.read_text("utf-8"), flags=re.S)
    treffer = [z.strip() for z in text.splitlines()
               if re.search(r"transition\s*:[^;]*\bfilter\b", z) and "mimi-flip" not in z]
    assert not treffer, f"transition auf filter ruckelt beim Drehen: {treffer}"
