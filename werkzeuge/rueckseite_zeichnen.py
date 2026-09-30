"""Zeichnet die Standard-Kartenrückseite web/static/rueckseite.svg.

Eigene Illustration (prozedural, keine Vorlage abgepaust): gespaltene
Tempelinsel im Gegenlicht über einer Spiegellandschaft. Fester Zufallssamen ->
jedes Mal exakt dasselbe Bild. Nachbessern: Werte hier ändern, dann

    python werkzeuge/rueckseite_zeichnen.py web/static/rueckseite.svg

und im Browser ansehen. Kanten entstehen per Mittelpunkt-Verschiebung
(fraktal) - glatte Kegel wirkten im ersten Entwurf wie Eistüten."""
import math
import random
import sys

W, H = 600, 840
WASSER_Y = 598          # Horizont / Wasserlinie
RISS_X, RISS_Y = 300, 372  # Lichtquelle im Spalt der Insel


def f(v):
    return f"{v:.1f}"


def pfad(pts, zu=True):
    d = "M" + " L".join(f"{f(x)},{f(y)}" for x, y in pts)
    return d + (" Z" if zu else "")


def fraktal(punkte, tiefe, rauh, r):
    """Mittelpunkt-Verschiebung entlang eines Linienzugs: natürliche, feine
    Zacken statt glatter Kanten."""
    pts = list(punkte)
    amp = rauh
    for _ in range(tiefe):
        neu = []
        for a, b in zip(pts, pts[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy) or 1
            nx, ny = -dy / L, dx / L
            d = r.uniform(-1, 1) * amp * L
            neu += [a, ((a[0] + b[0]) / 2 + nx * d, (a[1] + b[1]) / 2 + ny * d)]
        neu.append(pts[-1])
        pts = neu
        amp *= 0.62
    return pts


def grat(x0, x1, basis, hoehen, r, tiefe=5, rauh=0.22):
    """Bergkamm: Stützpunkte mit gegebenen Höhen, dann fraktal verfeinert."""
    n = len(hoehen)
    stuetz = [(x0 + (x1 - x0) * i / (n - 1), basis - h) for i, h in enumerate(hoehen)]
    return fraktal(stuetz, tiefe, rauh, r)


teile = []
add = teile.append

# --- Farbverläufe ------------------------------------------------------------
add(f"""<defs>
<linearGradient id="himmel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f7e9c3"/><stop offset=".22" stop-color="#f4dca6"/>
  <stop offset=".42" stop-color="#f0c79c"/><stop offset=".58" stop-color="#e7b7a4"/>
  <stop offset=".71" stop-color="#f2d6b8"/><stop offset=".712" stop-color="#e3c1b0"/>
  <stop offset=".85" stop-color="#9c7389"/><stop offset="1" stop-color="#3b2640"/>
</linearGradient>
<radialGradient id="sonne" cx="{RISS_X}" cy="{RISS_Y}" r="360" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#fffdf2"/><stop offset=".08" stop-color="#fff6d6" stop-opacity=".95"/>
  <stop offset=".3" stop-color="#fbe2a8" stop-opacity=".5"/><stop offset=".65" stop-color="#f2c894" stop-opacity=".12"/>
  <stop offset="1" stop-color="#f2c894" stop-opacity="0"/>
</radialGradient>
<radialGradient id="kern" cx="{RISS_X}" cy="{RISS_Y}" r="70" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#fff3c8" stop-opacity=".9"/>
  <stop offset="1" stop-color="#ffd98a" stop-opacity="0"/>
</radialGradient>
<radialGradient id="strahl" cx="{RISS_X}" cy="{RISS_Y}" r="520" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#fffbe6" stop-opacity=".55"/><stop offset=".5" stop-color="#fff1c8" stop-opacity=".12"/>
  <stop offset="1" stop-color="#fff1c8" stop-opacity="0"/>
</radialGradient>
<linearGradient id="fels" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3d2940"/><stop offset=".55" stop-color="#2a1a2d"/><stop offset="1" stop-color="#170e19"/>
</linearGradient>
<linearGradient id="bau" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#4e3450"/><stop offset="1" stop-color="#25172a"/>
</linearGradient>
<linearGradient id="fern1" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#d9b2b9" stop-opacity=".75"/><stop offset="1" stop-color="#ecd0c0" stop-opacity=".2"/>
</linearGradient>
<linearGradient id="fern2" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#a97c95"/><stop offset="1" stop-color="#d6b0ae" stop-opacity=".5"/>
</linearGradient>
<linearGradient id="tafel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#6d4a68"/><stop offset=".4" stop-color="#4a3050"/><stop offset="1" stop-color="#2d1d33"/>
</linearGradient>
<linearGradient id="vorn" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3a263d"/><stop offset="1" stop-color="#1a101c"/>
</linearGradient>
<linearGradient id="spiegelung" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#000" stop-opacity=".0"/><stop offset="1" stop-color="#1a0f1d" stop-opacity=".55"/>
</linearGradient>
<radialGradient id="dunst" cx=".5" cy=".5" r=".5">
  <stop offset="0" stop-color="#fff5e0" stop-opacity=".85"/><stop offset=".55" stop-color="#f7dcc4" stop-opacity=".4"/>
  <stop offset="1" stop-color="#f7dcc4" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vignette" cx=".5" cy=".44" r=".78">
  <stop offset=".5" stop-color="#5a2a55" stop-opacity="0"/><stop offset=".85" stop-color="#5a2a55" stop-opacity=".28"/>
  <stop offset="1" stop-color="#2c1230" stop-opacity=".6"/>
</radialGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#fff8e6" stop-opacity=".15"/><stop offset=".45" stop-color="#fff8e6" stop-opacity=".75"/>
  <stop offset="1" stop-color="#fff8e6" stop-opacity=".25"/>
</linearGradient>
</defs>""")

add(f'<rect width="{W}" height="{H}" fill="url(#himmel)"/>')
add(f'<rect width="{W}" height="{H}" fill="url(#sonne)"/>')

# --- Lichtstrahlen aus dem Spalt ---------------------------------------------
r = random.Random(3)
for i in range(22):
    w = -math.pi + i * (2 * math.pi / 22) + r.uniform(-0.08, 0.08)
    breite = r.uniform(0.012, 0.045)
    laenge = r.uniform(380, 620)
    p1 = (RISS_X + math.cos(w - breite) * laenge, RISS_Y + math.sin(w - breite) * laenge)
    p2 = (RISS_X + math.cos(w + breite) * laenge, RISS_Y + math.sin(w + breite) * laenge)
    add(f'<path d="{pfad([(RISS_X, RISS_Y), p1, p2])}" fill="url(#strahl)" opacity="{f(r.uniform(.35, .9))}"/>')

# --- Lichtkranz + Funkeln -------------------------------------------------------
add('<circle cx="300" cy="300" r="238" fill="none" stroke="url(#ring)" stroke-width="1.3"/>')
add('<circle cx="300" cy="300" r="242" fill="none" stroke="#fff4dc" stroke-opacity=".12" stroke-width="6"/>')
add('<circle cx="300" cy="300" r="226" fill="none" stroke="#fff4dc" stroke-opacity=".1" stroke-width=".8"/>')
r = random.Random(5)
for _ in range(38):
    w = r.uniform(0, 2 * math.pi)
    rr = 238 + r.uniform(-14, 14)
    x, y = 300 + math.cos(w) * rr, 300 + math.sin(w) * rr
    if y > WASSER_Y - 20:
        continue
    s = r.uniform(0.6, 2.2)
    add(f'<path d="M{f(x - s * 2.4)},{f(y)} L{f(x)},{f(y - s * .5)} L{f(x + s * 2.4)},{f(y)} L{f(x)},{f(y + s * .5)} Z M{f(x)},{f(y - s * 2.4)} L{f(x + s * .5)},{f(y)} L{f(x)},{f(y + s * 2.4)} L{f(x - s * .5)},{f(y)} Z" fill="#fffaf0" opacity="{f(r.uniform(.3, .85))}"/>')
# Linsenreflexe auf der Diagonale
for t, rad, op in ((.35, 16, .10), (.55, 7, .16), (.8, 26, .07), (1.05, 10, .12)):
    x, y = RISS_X + (90 - RISS_X) * t, RISS_Y + (700 - RISS_Y) * t
    add(f'<circle cx="{f(x)}" cy="{f(y)}" r="{rad}" fill="#fff3d8" opacity="{op}"/>')

# --- Ferne Gebirge ------------------------------------------------------------
r = random.Random(11)
fern_a = grat(-20, 620, WASSER_Y - 18, [30, 70, 48, 95, 60, 40, 82, 55, 110, 70, 45, 88, 52], r, 5, .2)
add(f'<path d="{pfad([(-20, WASSER_Y)] + fern_a + [(620, WASSER_Y)])}" fill="url(#fern1)"/>')
r = random.Random(13)
fern_b = grat(-20, 620, WASSER_Y - 6, [20, 44, 30, 60, 26, 18, 52, 34, 22, 58, 30], r, 6, .24)
add(f'<path d="{pfad([(-20, WASSER_Y)] + fern_b + [(620, WASSER_Y)])}" fill="url(#fern2)" opacity=".8"/>')

# --- Tafelberge links und rechts (Mittelgrund) ----------------------------------
def tafelberg(x0, x1, oben, saat, kante_rechts=True):
    rr = random.Random(saat)
    top = grat(x0 + 26, x1 - 26, oben, [0, 14, 6, 30, 18, 44, 22, 12, 26, 8, 0], rr, 5, .22)
    links = fraktal([(x0 - 10, WASSER_Y), (x0 + 12, oben + 30), top[0]], 5, .25, rr)
    rechts = fraktal([top[-1], (x1 - 10, oben + 26), (x1 + 8, WASSER_Y)], 5, .25, rr)
    umriss = links[:-1] + top + rechts[1:]
    add(f'<path d="{pfad(umriss)}" fill="url(#tafel)"/>')
    # Gegenlicht auf der Oberkante und feine Schichtlinien an der Wand
    add(f'<path d="{pfad(top, zu=False)}" fill="none" stroke="#f6c9a2" stroke-opacity=".55" stroke-width=".9"/>')
    for k in range(7):
        y = oben + 14 + k * rr.uniform(9, 13)
        if y > WASSER_Y - 6:
            break
        xa = x0 + rr.uniform(10, 40)
        xb = x1 - rr.uniform(10, 40)
        linie = fraktal([(xa, y), (xb, y + rr.uniform(-3, 3))], 4, .03, rr)
        add(f'<path d="{pfad(linie, zu=False)}" fill="none" stroke="#e9b8a6" stroke-opacity="{f(.08 + .02 * k)}" stroke-width=".6"/>')
    return umriss


berg_links = tafelberg(-30, 210, 520, 21)
berg_rechts = tafelberg(400, 640, 498, 23)

# --- Dunstband über dem Wasser ---------------------------------------------------
r = random.Random(31)
for _ in range(18):
    cx, cy = r.uniform(-40, 640), r.uniform(548, 604)
    add(f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(r.uniform(60, 170))}" ry="{f(r.uniform(8, 20))}" fill="url(#dunst)" opacity="{f(r.uniform(.15, .45))}"/>')

# --- Wasser: Spiegelung von Himmel, Bergen, Licht ---------------------------------
add(f'<g transform="translate(0 {2 * WASSER_Y}) scale(1 -1)" opacity=".55">'
    f'<path d="{pfad([(-20, WASSER_Y)] + fern_b + [(620, WASSER_Y)])}" fill="#b68ea0"/>'
    f'<path d="{pfad(berg_links)}" fill="#4a3050"/><path d="{pfad(berg_rechts)}" fill="#4a3050"/></g>')
add(f'<rect x="0" y="{WASSER_Y}" width="{W}" height="{H - WASSER_Y}" fill="url(#spiegelung)"/>')
add(f'<ellipse cx="{RISS_X}" cy="{WASSER_Y + 10}" rx="120" ry="9" fill="#fff4d8" opacity=".45"/>')
add(f'<path d="M{RISS_X - 14},{WASSER_Y} L{RISS_X + 14},{WASSER_Y} L{RISS_X + 4},{H - 90} L{RISS_X - 4},{H - 90} Z" fill="#fff1cf" opacity=".22"/>')
r = random.Random(41)
for _ in range(90):
    y = WASSER_Y + 4 + (r.random() ** 1.6) * (H - WASSER_Y - 10)
    x = r.uniform(-20, W)
    lang = r.uniform(12, 70) * (1 - (y - WASSER_Y) / (H - WASSER_Y) * .4)
    add(f'<line x1="{f(x)}" y1="{f(y)}" x2="{f(x + lang)}" y2="{f(y)}" stroke="#fbe3c8" stroke-opacity="{f(r.uniform(.06, .26))}" stroke-width="{f(r.uniform(.5, 1.1))}"/>')

# --- Vordergrund: dunkle Felsen unten rechts + kleine Klippe links --------------------
r = random.Random(51)
vorne = grat(250, 640, 800, [0, 40, 96, 70, 128, 84, 60, 20], r, 6, .22)
add(f'<path d="{pfad([(250, H + 5)] + vorne + [(640, H + 5)])}" fill="url(#vorn)"/>')
add(f'<path d="{pfad(vorne[8:-10], zu=False)}" fill="none" stroke="#f0bf9c" stroke-opacity=".3" stroke-width=".8"/>')
r = random.Random(53)
fels = [(r.uniform(-1, 1), 0) for _ in range(1)]
kl = fraktal([(-20, H + 5), (-10, 760), (40, 742), (86, 770), (104, H + 5)], 5, .25, r)
add(f'<path d="{pfad(kl)}" fill="url(#vorn)" opacity=".95"/>')

# --- Die schwebende Insel (zwei Hälften) -------------------------------------------
def inselhaelfte(stuetz_oben, stuetz_unten, saat):
    rr = random.Random(saat)
    oben = fraktal(stuetz_oben, 4, .08, rr)
    unten = fraktal(stuetz_unten, 4, .34, rr)
    return oben, unten


# linke Hälfte (größer, höher), rechte etwas tiefer und gekippt
l_oben, l_unten = inselhaelfte(
    [(92, 312), (150, 300), (210, 296), (262, 300), (292, 306)],
    [(292, 306), (298, 334), (288, 366), (294, 398), (272, 428), (262, 462), (240, 486), (226, 520), (206, 548),
     (192, 512), (176, 492), (160, 456), (140, 432), (122, 396), (104, 362), (92, 312)], 61)
r_oben, r_unten = inselhaelfte(
    [(310, 318), (360, 312), (420, 314), (478, 322), (522, 334)],
    [(522, 334), (514, 362), (496, 382), (478, 410), (456, 432), (440, 466), (420, 500), (404, 470), (386, 448),
     (362, 428), (344, 404), (330, 380), (318, 356), (322, 336), (310, 318)], 63)

add(f'<circle cx="{RISS_X}" cy="{RISS_Y}" r="70" fill="url(#kern)"/>')
for oben, unten in ((l_oben, l_unten), (r_oben, r_unten)):
    add(f'<path d="{pfad(oben + unten[1:])}" fill="url(#fels)"/>')

# Gegenlicht an den Kanten zum Spalt und Schichtung auf der Unterseite
r = random.Random(71)
for kante, dicke in ((l_unten[:22], 1.3), (r_unten[-26:], 1.3)):
    add(f'<path d="{pfad(kante, zu=False)}" fill="none" stroke="#ffd48c" stroke-opacity=".85" stroke-width="{dicke}"/>')
    add(f'<path d="{pfad(kante, zu=False)}" fill="none" stroke="#fff3cf" stroke-opacity=".35" stroke-width="4"/>')
for unten, links in ((l_unten, True), (r_unten, False)):
    xs = [p[0] for p in unten]
    for k in range(9):
        t = (k + 1) / 10
        y0 = 318 + t * 110
        xa = min(xs) + 14 + t * 30
        xb = max(xs) - 14 - t * 30
        if xb - xa < 20:
            continue
        linie = fraktal([(xa, y0), (xb, y0 + r.uniform(-4, 4))], 4, .05, r)
        add(f'<path d="{pfad(linie, zu=False)}" fill="none" stroke="#a9798f" stroke-opacity="{f(.10 + .02 * k)}" stroke-width=".55"/>')

# Felsfacetten: dunklere Keile von der Oberkante zur Spitze (Bruchflächen)
for unten, spitze in ((l_unten, (206, 548)), (r_unten, (420, 500))):
    xs = [p[0] for p in unten]
    for k in range(5):
        xa = min(xs) + (max(xs) - min(xs)) * (k + .5) / 5 + r.uniform(-8, 8)
        mitte = ((xa + spitze[0]) / 2 + r.uniform(-10, 10), (340 + spitze[1]) / 2 + r.uniform(-12, 12))
        keil = fraktal([(xa - 6, 330), mitte, (spitze[0] + r.uniform(-4, 4), spitze[1] - 10)], 3, .2, r)
        keil2 = fraktal([(spitze[0] + r.uniform(-4, 4), spitze[1] - 10), (mitte[0] + 14, mitte[1]), (xa + 10, 330)], 3, .2, r)
        add(f'<path d="{pfad(keil + keil2[1:])}" fill="#140b16" opacity="{f(r.uniform(.12, .28))}"/>')

# Hängende Wurzeln (feine Linien)
for unten in (l_unten, r_unten):
    for p in unten[::4]:
        if p[1] < 380 or r.random() < .45:
            continue
        lang = r.uniform(5, 18)
        kr = r.uniform(-6, 6)
        add(f'<path d="M{f(p[0])},{f(p[1])} q{f(kr)},{f(lang * .5)} {f(kr * .4)},{f(lang)}" fill="none" stroke="#24162a" stroke-width="{f(r.uniform(.4, 1.1))}" stroke-linecap="round"/>')

# Bäume/Buschwerk auf den Inselrändern
for x, y, s in ((96, 311, 9), (104, 306, 7), (512, 332, 8), (498, 326, 6), (286, 303, 5), (318, 316, 5)):
    add(f'<circle cx="{x}" cy="{y - s}" r="{s}" fill="#2d1c31"/><circle cx="{x + s * .8}" cy="{y - s * 1.3}" r="{f(s * .7)}" fill="#35223a"/>')
    add(f'<line x1="{x}" y1="{y}" x2="{x}" y2="{y - s * .6}" stroke="#24162a" stroke-width="1.2"/>')

# --- Tempel/Burg auf der Insel -------------------------------------------------------
def turm(x, basis, breite, hoehe, stufen, spitze, rr):
    """Gestufter Turm: Körper, mehrere schmaler werdende Etagen, schlanke
    Spitze mit Knauf - viele feine Absätze statt eines Kegels."""
    pts_l, pts_r = [], []
    y = basis
    b = breite
    etage = hoehe / (stufen + 1)
    for i in range(stufen + 1):
        pts_l.append((x - b / 2, y))
        y2 = y - etage * (1.3 if i == 0 else rr.uniform(.8, 1.05))
        pts_l.append((x - b / 2, y2))
        pts_r.append((x + b / 2, y))
        pts_r.append((x + b / 2, y2))
        # Gesims: kleiner Überstand
        pts_l.append((x - b / 2 - 1.2, y2))
        pts_r.append((x + b / 2 + 1.2, y2))
        y = y2
        b *= rr.uniform(.66, .78)
        pts_l.append((x - b / 2 - 1.2, y - .8))
        pts_r.append((x + b / 2 + 1.2, y - .8))
    spitz_y = y - spitze
    form = pts_l + [(x - b * .3, y - 2), (x, spitz_y), (x + b * .3, y - 2)] + list(reversed(pts_r))
    teile_t = [f'<path d="{pfad(form)}" fill="url(#bau)"/>']
    teile_t.append(f'<line x1="{f(x)}" y1="{f(spitz_y)}" x2="{f(x)}" y2="{f(spitz_y - spitze * .35)}" stroke="#2c1b30" stroke-width=".9"/>')
    teile_t.append(f'<circle cx="{f(x)}" cy="{f(spitz_y - spitze * .35)}" r="1.3" fill="#2c1b30"/>')
    # Fensterschlitze und Lichtkante zur Sonne
    for k in range(stufen):
        yy = basis - etage * (k + .7)
        if yy < spitz_y + 8:
            break
        teile_t.append(f'<rect x="{f(x - .8)}" y="{f(yy)}" width="1.6" height="{f(etage * .35)}" fill="#ffcf85" opacity="{f(rr.uniform(.35, .85))}"/>')
    rechts_kante = [p for p in reversed(pts_r)]
    teile_t.append(f'<path d="{pfad(rechts_kante, zu=False)}" fill="none" stroke="#f6c68e" stroke-opacity=".4" stroke-width=".6"/>')
    return "".join(teile_t)


r = random.Random(81)
# Mauerband mit Zinnen
def mauer(x0, x1, y, hoehe):
    pts = [(x0, y), (x0, y - hoehe)]
    x = x0
    while x < x1 - 5:
        pts += [(x, y - hoehe - 3.2), (x + 3, y - hoehe - 3.2), (x + 3, y - hoehe), (x + 6, y - hoehe)]
        x += 6
    pts += [(x1, y - hoehe), (x1, y)]
    add(f'<path d="{pfad(pts)}" fill="url(#bau)"/>')


mauer(112, 286, 306, 20)
mauer(330, 506, 324, 16)
tuerme_links = [(124, 292, 16, 30, 2, 12), (146, 290, 22, 52, 3, 18), (172, 288, 30, 78, 4, 24), (204, 286, 42, 104, 5, 30),
                (238, 288, 26, 70, 4, 22), (262, 290, 18, 44, 3, 14), (280, 294, 12, 26, 2, 10)]
tuerme_rechts = [(342, 310, 14, 26, 2, 10), (366, 310, 22, 46, 3, 16), (396, 308, 30, 72, 4, 22), (426, 310, 20, 44, 3, 14),
                 (452, 312, 24, 56, 3, 18), (478, 314, 16, 32, 2, 12), (498, 318, 12, 22, 2, 8)]
for t in tuerme_links + tuerme_rechts:
    add(turm(*t, r))

# --- Trümmer und Staub aus dem Spalt ---------------------------------------------------
r = random.Random(91)
for i in range(70):
    t = r.random() ** 1.4
    x = RISS_X + r.uniform(-26, 26) * (1 + t * 1.6) + math.sin(t * 5) * 8
    y = 400 + t * 190
    s = max(.6, (1 - t) * r.uniform(1.5, 6.5))
    ecken = [(x + math.cos(a) * s * r.uniform(.6, 1.3), y + math.sin(a) * s * r.uniform(.6, 1.3))
             for a in [k * math.pi / 3 + r.uniform(-.3, .3) for k in range(6)]]
    add(f'<path d="{pfad(ecken)}" fill="#281a2c" opacity="{f(.95 - t * .6)}"/>')
for _ in range(60):
    x, y = RISS_X + r.gauss(0, 60), RISS_Y + r.gauss(40, 70)
    add(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r.uniform(.4, 1.3))}" fill="#fff3d0" opacity="{f(r.uniform(.25, .8))}"/>')

# --- Vögel -------------------------------------------------------------------------
r = random.Random(101)
for _ in range(26):
    x = r.choice([r.uniform(60, 230), r.uniform(380, 560)])
    y = r.uniform(150, 420)
    s = r.uniform(.45, 1.25)
    add(f'<path d="M{f(x - 7 * s)},{f(y - 1.5 * s)} Q{f(x - 3 * s)},{f(y - 4 * s)} {f(x)},{f(y)} Q{f(x + 3 * s)},{f(y - 4 * s)} {f(x + 7 * s)},{f(y - 1.5 * s)}" fill="none" stroke="#3b2640" stroke-width="{f(1.1 * s)}" stroke-linecap="round" opacity="{f(r.uniform(.55, .95))}"/>')

# --- Vignette ------------------------------------------------------------------------
add(f'<rect width="{W}" height="{H}" fill="url(#vignette)"/>')

svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">' + "".join(teile) + "</svg>"
ziel = sys.argv[1] if len(sys.argv) > 1 else "web/static/rueckseite.svg"
open(ziel, "w", encoding="utf-8").write(svg)
print(ziel, round(len(svg) / 1024), "KB")
