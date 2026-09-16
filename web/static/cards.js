// Erzeugt Spielkarten als SVG im Sundered-Skies-Look: Pergament, Zierrahmen,
// thematische Bildkarten. Farben (Pik/Herz/Karo/Kreuz) und 2 Joker bleiben
// standardkonform. Keine externen Bilder.
//
// Wertigkeits-Stufen (sofort am Rahmen erkennbar):
//   2–5 Glut · 6–9 Asche · 10/B/D/K Glanz · A Leere · Joker = eigene Inszenierung (JOKER_STILE).

const SUIT_GLYPH = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const RED_SUITS = new Set(["hearts", "diamonds"]);
// Deutsche Kartenwerte: Bube (B), Dame (D), König (K), Ass (A).
const RANK_LABEL = { J: "B", Q: "D", K: "K", A: "A" };

const CARD_W = 240;
const CARD_H = 336;
// Tinte: Rot zieht ins Glutorange, Schwarz bekommt einen kalten Grünstich –
// beides bleibt kontraststark genug, um am Tisch aus der Entfernung zu lesen.
const INK_RED = "#a63016";
const INK_DARK = "#1f2620";
const BRONZE = "#8a6a2f";
const BRONZE_LT = "#c8a15a";

// Wertigkeits-Stufen: lt = heller Glanz, dk = Schatten, p0..p2 = Kartengrund.
// Benannt nach dem Setting statt nach Schmuckmetall - die Karte steigt vom
// Glutrand der Welt bis in die Leere des Glows auf:
//   GLUT (Schlacke) -> ASCHE -> GLANZ (der Glow) -> LEERE (das Nichts).
// Die Schluessel heissen weiter bronze/silver/gold/platin, damit die CSS-Regeln
// (.tier-platin & Co.) unveraendert greifen.
const TIERS = {
  bronze: { name: "GLUT",  lt: "#e39250", dk: "#8d4318", ink: "#68320f",
            p0: "#f8ecd7", p1: "#eed9b8", p2: "#dcbf94" },
  silver: { name: "ASCHE", lt: "#d5dcd3", dk: "#6e7c72", ink: "#45514a",
            p0: "#f8f8f2", p1: "#e9ece4", p2: "#d3d9ce" },
  gold:   { name: "GLANZ", lt: "#f4f2a4", dk: "#9aa42b", ink: "#535f18",
            p0: "#fcfbe6", p1: "#f2f2ca", p2: "#e0e2a6" },
  platin: { name: "LEERE", lt: "#ffffff", dk: "#7fb4c3", ink: "#33525c",
            p0: "#ffffff", p1: "#eef9fb", p2: "#d4ebf1" },
};

const COL = { L: 0.30, C: 0.5, R: 0.70 };
const PIPS = {
  "2": [["C", 0.20], ["C", 0.78]],
  "3": [["C", 0.20], ["C", 0.49], ["C", 0.78]],
  "4": [["L", 0.20], ["R", 0.20], ["L", 0.78], ["R", 0.78]],
  "5": [["L", 0.20], ["R", 0.20], ["C", 0.49], ["L", 0.78], ["R", 0.78]],
  "6": [["L", 0.20], ["R", 0.20], ["L", 0.49], ["R", 0.49], ["L", 0.78], ["R", 0.78]],
  "7": [["L", 0.20], ["R", 0.20], ["C", 0.345], ["L", 0.49], ["R", 0.49], ["L", 0.78], ["R", 0.78]],
  "8": [["L", 0.20], ["R", 0.20], ["C", 0.345], ["L", 0.49], ["R", 0.49], ["C", 0.635], ["L", 0.78], ["R", 0.78]],
  "9": [["L", 0.20], ["R", 0.20], ["L", 0.39], ["R", 0.39], ["C", 0.49], ["L", 0.59], ["R", 0.59], ["L", 0.78], ["R", 0.78]],
  "10": [["L", 0.20], ["R", 0.20], ["C", 0.295], ["L", 0.39], ["R", 0.39], ["L", 0.59], ["R", 0.59], ["C", 0.685], ["L", 0.78], ["R", 0.78]],
};

function tierKey(card) {
  if (!card) return "bronze";
  if (card.suit === "joker") return "joker";
  const r = String(card.rank);
  if (r === "A") return "platin";
  if (r === "10" || r === "J" || r === "Q" || r === "K") return "gold";
  if (r === "6" || r === "7" || r === "8" || r === "9") return "silver";
  return "bronze";
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

let _cidSeq = 0;

// Papierfaser: EINMAL als kleines Rausch-Bild erzeugen und danach als Muster
// kacheln. Ein feTurbulence-Filter waere pro Karte UND pro Neu-Rendern neu zu
// berechnen - das Bild wird dagegen nur einmal gebaut und dann nur noch kopiert.
let _paperURL = null;
function paperNoise() {
  if (_paperURL) return _paperURL;
  try {
    const N = 96;
    const cv = document.createElement("canvas");
    cv.width = N; cv.height = N;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      // grobe Faser + feines Korn
      const v = 128 + (Math.random() - 0.5) * 92 + Math.sin(i * 0.7) * 6;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    _paperURL = cv.toDataURL("image/png");
  } catch {
    _paperURL = "";
  }
  return _paperURL;
}

// Gemeinsame Definitionen je Karte (eigene IDs – sonst überschreiben sich
// mehrere Karten auf einer Seite gegenseitig die Verläufe!).
// Das Rausch-Muster liegt EINMAL im Dokument; alle Karten verweisen nur darauf
// (sonst steckt das Bild als Daten-URL in jeder einzelnen Karte -> riesig).
let _defsReady = false;
function ensureGlobalDefs() {
  if (_defsReady || typeof document === "undefined") return;
  _defsReady = true;
  const paper = paperNoise();
  if (!paper) return;
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><defs>
    <pattern id="swiPaper" width="96" height="96" patternUnits="userSpaceOnUse">
      <image href="${paper}" xlink:href="${paper}" width="96" height="96"/>
    </pattern></defs></svg>`;
  document.body.appendChild(holder);
}

function defs(uid, t) {
  return `<defs>
    <radialGradient id="${uid}p" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="${t.p0}"/>
      <stop offset="70%" stop-color="${t.p1}"/>
      <stop offset="100%" stop-color="${t.p2}"/>
    </radialGradient>
    <linearGradient id="${uid}s" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="42%" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.14"/>
    </linearGradient>
    <linearGradient id="${uid}m" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="${t.lt}"/>
      <stop offset="45%" stop-color="${t.dk}"/>
      <stop offset="55%" stop-color="${t.lt}"/>
      <stop offset="100%" stop-color="${t.dk}"/>
    </linearGradient>
  </defs>`;
}

// Bruchkante statt Zierblatt: von der Ecke laufen feine Risse ins Kartenbild.
// Die Welt ist zersplittert – das soll man an jeder Karte sehen, ohne dass es
// laut wird (duenne Linien, niedrige Deckkraft).
function flourish(x, y, rot, t) {
  // Zwei Risse laufen von der Ecke weg, knicken unterwegs und verzweigen sich
  // NICHT im Ursprung (sonst wird daraus ein Faecher statt eines Bruchs).
  return `<g transform="translate(${x} ${y}) rotate(${rot})" fill="none"
    stroke="${t.dk}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0,0 L11,6 L19,5 L28,11 L35,10" stroke-width="1.4" opacity="0.62"/>
    <path d="M19,5 L22,13 L20,20" stroke-width="0.85" opacity="0.38"/>
    <path d="M6,3 L4,11 L8,17 L5,27" stroke-width="1.2" opacity="0.5"/>
    <path d="M4,11 L12,15" stroke-width="0.75" opacity="0.3"/>
  </g>`;
}

// Abgesprengter Splitter – unregelmäßig statt symmetrischer Edelstein.
// Schmuck für die beiden oberen Stufen (Glanz & Leere).
function gem(x, y, t, r = 5) {
  return `<path d="M${x},${y - r} L${x + r * 0.82},${y - r * 0.12} L${x + r * 0.34},${y + r}
    L${x - r * 0.72},${y + r * 0.38} L${x - r * 0.52},${y - r * 0.42} Z"
    fill="${t.lt}" stroke="${t.dk}" stroke-width="1" stroke-linejoin="round" opacity="0.95"/>`;
}

// Rahmen in der Metallfarbe der Stufe; höhere Stufen bekommen mehr Schmuck.
function frame(uid, tier, t) {
  let extra = "";
  if (tier === "silver" || tier === "gold" || tier === "platin") {
    extra += `<rect x="20" y="20" width="${CARD_W - 40}" height="${CARD_H - 40}" rx="9" fill="none" stroke="${t.lt}" stroke-width="1" opacity="0.75"/>`;
  }
  if (tier === "gold" || tier === "platin") {
    extra += gem(CARD_W / 2, 15, t) + gem(CARD_W / 2, CARD_H - 15, t) +
             gem(15, CARD_H / 2, t) + gem(CARD_W - 15, CARD_H / 2, t);
  }
  if (tier === "platin") {
    // Strahlenglanz in den Ecken – „edelste" Stufe.
    extra += [[26, 26, 0], [CARD_W - 26, 26, 90], [CARD_W - 26, CARD_H - 26, 180], [26, CARD_H - 26, 270]]
      .map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r})" stroke="${t.lt}" stroke-width="1.2" opacity="0.8">
        <line x1="0" y1="0" x2="16" y2="0"/><line x1="0" y1="0" x2="0" y2="16"/><line x1="0" y1="0" x2="11" y2="11"/>
      </g>`).join("");
  }
  return `
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="url(#${uid}p)" stroke="url(#${uid}m)" stroke-width="4"/>
    <rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="16" fill="url(#swiPaper)" opacity="0.3" style="mix-blend-mode:multiply"/>
    <!-- Gemalte Praegung: heller Lichtrand oben links, dunkler Schatten unten
         rechts. Sieht aus wie gepraegtes Metall, kostet aber nichts. -->
    <path d="M22,10 h${CARD_W - 44} a12,12 0 0 1 12,12" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1.6"/>
    <path d="M10,22 v${CARD_H - 44} a12,12 0 0 0 12,12" fill="none" stroke="#fff" stroke-opacity="0.28" stroke-width="1.4"/>
    <path d="M${CARD_W - 10},22 v${CARD_H - 44} a12,12 0 0 1 -12,12" fill="none" stroke="#000" stroke-opacity="0.24" stroke-width="1.6"/>
    <path d="M22,${CARD_H - 10} h${CARD_W - 44}" fill="none" stroke="#000" stroke-opacity="0.28" stroke-width="1.6"/>
    <rect x="8" y="8" width="${CARD_W - 16}" height="${CARD_H - 16}" rx="14" fill="url(#${uid}s)" opacity="0.85"/>
    <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="12" fill="none" stroke="${t.dk}" stroke-width="1.4" opacity="0.7"/>
    ${extra}
    ${flourish(20, 20, 0, t)}${flourish(CARD_W - 20, 20, 90, t)}
    ${flourish(CARD_W - 20, CARD_H - 20, 180, t)}${flourish(20, CARD_H - 20, 270, t)}`;
}

// Namensschild unten: macht die Stufe unmissverständlich lesbar.
function tierPlate(t, label, glow) {
  const w = 96, h = 20, x = (CARD_W - w) / 2, y = CARD_H - 34;
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"
      fill="${glow ? "rgba(10,16,14,0.72)" : "rgba(255,255,255,0.72)"}"
      stroke="${glow || t.dk}" stroke-width="1.2"/>
    <text x="${CARD_W / 2}" y="${y + h / 2 + 0.5}" font-size="10.5" font-weight="800" letter-spacing="3"
      text-anchor="middle" dominant-baseline="central"
      fill="${glow || t.ink}" font-family="Georgia, 'Times New Roman', serif">${esc(label)}</text>
  </g>`;
}

function corner(rank, glyph, color, x, y, rotate) {
  const transform = rotate ? `rotate(180 ${x} ${y})` : "";
  return `<g transform="${transform}" fill="${color}">
    <text x="${x}" y="${y}" font-size="34" font-weight="700" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">${esc(rank)}</text>
    <text x="${x}" y="${y + 29}" font-size="27" text-anchor="middle">${glyph}</text>
  </g>`;
}

function pip(glyph, color, cx, cy, rotate, size = 44) {
  const transform = rotate ? `rotate(180 ${cx} ${cy})` : "";
  return `<text x="${cx}" y="${cy}" transform="${transform}" fill="${color}" font-size="${size}" text-anchor="middle" dominant-baseline="central">${glyph}</text>`;
}

// Bildkarte: großer deutscher Buchstabe (B/D/K) + Farbsymbol.
function faceCard(label, glyph, color) {
  const cx = CARD_W / 2, cy = CARD_H / 2;
  return `
    <text x="${cx}" y="${cy - 4}" fill="${color}" font-size="122" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="Georgia, 'Times New Roman', serif">${esc(label)}</text>
    <text x="${cx}" y="${cy + 80}" fill="${color}" font-size="48" text-anchor="middle" dominant-baseline="central">${glyph}</text>`;
}

// --- Joker -----------------------------------------------------------------
// Drei Stile (JOKER_STILE) mit gemeinsamer Grundregel: das Motiv – Spielerbild
// oder gemalte Himmelsinseln – bleibt frei sichtbar. Auf der Bildmitte, wo meist
// das Gesicht ist, liegt nichts Deckendes mehr.
//
// Der Joker darf aus der Karte AUSBRECHEN (Splitter, Runenkreis, Ringe, Pulse). Alles, was
// ueber den Kartenrand ragt, steckt in <g class="joker-aussen">; kleine
// Listenkarten blenden das per CSS aus, sonst ragt es in die Nachbarzeilen.
// Seitlich hoechstens ~40 Einheiten hinaus – die Grosskarte ist am Handy 250 px
// breit, links und rechts bleiben nur gut 60 px Platz.
//
// Glühen ist GEMALT (Verlaeufe, breite halbtransparente Striche), nie per
// filter: die Karte ist animiert, ein Filter muesste pro Frame neu rastern.
const JOKER_STILE = ["riss", "siegel", "glyphen", "orbit"];
const JOKER_NAMEN = {
  riss: "✴️ Riss", siegel: "🔯 Siegel", glyphen: "✨ Glyphen", orbit: "🪐 Orbit",
};

// Welcher Stil fuer welchen Joker? Zufaellig aus den angehakten Stilen – aber
// FEST je Joker und Runde (Hash statt Math.random): sonst wuerde er bei jedem
// Neuzeichnen den Stil wechseln. Nebeneffekt: SL, Spieler und TV zeigen denselben
// Stil, solange dort dieselben Stile angehakt sind.
let jokerAuswahl = JOKER_STILE.slice();
let jokerRunde = 0;
let jokerErzwungen = null;          // nur fuer die Musterseite
function jokerStilFuer(card) {
  if (jokerErzwungen) return jokerErzwungen;
  const liste = jokerAuswahl.length ? jokerAuswahl : ["riss"];
  let h = 7;
  for (const ch of `${card.id}:${jokerRunde}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return liste[h % liste.length];
}

function jokerPalette(jokerColor) {
  return jokerColor === "red"
    ? { glow: "#ffb03a", hot: "#fff2c2", deep: "#2a0c05", mid: "#6e2610", fire: "#ff5a14", label: "ROTER JOKER" }
    : { glow: "#5fe0a8", hot: "#e4fff0", deep: "#041c16", mid: "#0f4a36", fire: "#1fc47e", label: "SCHWARZER JOKER" };
}

function jokerDefs(uid, p) {
  return `<defs>
    <clipPath id="${uid}k"><rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18"/></clipPath>
    <linearGradient id="${uid}himmel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.deep}"/><stop offset="58%" stop-color="${p.mid}"/>
      <stop offset="100%" stop-color="${p.deep}"/>
    </linearGradient>
    <radialGradient id="${uid}sonne">
      <stop offset="0%" stop-color="${p.hot}" stop-opacity="0.95"/>
      <stop offset="30%" stop-color="${p.glow}" stop-opacity="0.8"/>
      <stop offset="62%" stop-color="${p.fire}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${p.fire}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${uid}rand" cx="50%" cy="40%" r="76%">
      <stop offset="52%" stop-color="${p.glow}" stop-opacity="0"/>
      <stop offset="82%" stop-color="${p.glow}" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="${p.deep}" stop-opacity="0.72"/>
    </radialGradient>
    <!-- Der Glow faellt auf die Figur: hebt dunkle Charakterbilder an, ohne Filter. -->
    <radialGradient id="${uid}licht" cx="50%" cy="36%" r="58%">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.3"/>
      <stop offset="60%" stop-color="${p.glow}" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${uid}boden" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.55"/>
      <stop offset="40%" stop-color="${p.glow}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${uid}saeule" gradientUnits="userSpaceOnUse" x1="0" y1="330" x2="0" y2="110">
      <stop offset="0%" stop-color="${p.hot}" stop-opacity="0.9"/>
      <stop offset="35%" stop-color="${p.glow}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${p.glow}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${uid}band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.deep}" stop-opacity="0"/>
      <stop offset="45%" stop-color="${p.deep}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${p.deep}" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="${uid}rahmen" x1="0" y1="0" x2="0.45" y2="1">
      <stop offset="0%" stop-color="${p.hot}"/><stop offset="35%" stop-color="${p.glow}"/>
      <stop offset="65%" stop-color="${p.hot}"/><stop offset="100%" stop-color="${p.fire}"/>
    </linearGradient>
    <linearGradient id="${uid}strahl" gradientUnits="userSpaceOnUse" x1="0" y1="-40" x2="0" y2="300">
      <stop offset="0%" stop-color="${p.hot}" stop-opacity="0.9"/>
      <stop offset="40%" stop-color="${p.glow}" stop-opacity="0.45"/>
      <stop offset="90%" stop-color="${p.glow}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${uid}fuge" cx="50%" cy="44%" r="72%">
      <stop offset="0%" stop-color="${p.hot}"/>
      <stop offset="45%" stop-color="${p.glow}"/>
      <stop offset="100%" stop-color="${p.fire}"/>
    </radialGradient>
    <!-- Lichthof: die Karte deckt die inneren ~75–82 % ab, sichtbar ist nur der
         Ring darueber hinaus – dort muss das Licht noch kraeftig sein. -->
    <radialGradient id="${uid}kranz">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.7"/>
      <stop offset="72%" stop-color="${p.glow}" stop-opacity="0.6"/>
      <stop offset="86%" stop-color="${p.glow}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${uid}holo" x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="30%" stop-color="#ff7ab8" stop-opacity="0.22"/>
      <stop offset="45%" stop-color="#fff2a0" stop-opacity="0.34"/>
      <stop offset="55%" stop-color="#9dffdd" stop-opacity="0.3"/>
      <stop offset="70%" stop-color="#8fb4ff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>`;
}

// Motiv: Spielerbild randlos – ohne Bild schwebende Inseln vor dem Glow.
function jokerMotiv(uid, p, image) {
  if (image) {
    return `<g clip-path="url(#${uid}k)">
      <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="${p.deep}"/>
      <image href="${esc(image)}" xlink:href="${esc(image)}" x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" preserveAspectRatio="xMidYMid slice"/>
      <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}licht)"/>
    </g>`;
  }
  return `<g clip-path="url(#${uid}k)">
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}himmel)"/>
    <circle cx="120" cy="150" r="130" fill="url(#${uid}sonne)">
      <animate attributeName="r" values="124;136;124" dur="4.5s" repeatCount="indefinite"/>
    </circle>
    ${jokerInsel(192, 62, 44, 34, p, 5.5, 0)}
    ${jokerInsel(50, 96, 58, 44, p, 6.5, 1.2)}
    ${jokerInsel(124, 152, 138, 100, p, 7.5, 0.5, true)}
  </g>`;
}

// Schwebende Felsinsel: flach gewoelbte Oberkante, darunter ein zackiger,
// umgekehrter Felskegel mit Gesteinsschichten, von unten vom Glow angeleuchtet.
// (Zu flach und breit gezeichnet sehen Inseln aus wie Fledermaeuse – darum ist
// der Kegel tief und die Unterseite ausgefranst.) Wippt langsam.
const INSEL_OBEN = [[-0.42, -0.05], [-0.26, -0.1], [-0.06, -0.14], [0.14, -0.12], [0.34, -0.07], [0.5, 0.03]];
const INSEL_UNTEN = [[0.46, 0.18], [0.35, 0.3], [0.3, 0.46], [0.18, 0.58], [0.13, 0.82], [0.04, 0.7],
  [-0.02, 1], [-0.1, 0.74], [-0.18, 0.64], [-0.24, 0.48], [-0.36, 0.36], [-0.46, 0.2], [-0.5, 0.05]];
function jokerInsel(x, y, w, h, p, dur, delay, ruinen) {
  const pt = (fx, fy) => `${(x + fx * w).toFixed(1)},${(y + fy * h).toFixed(1)}`;
  const linie = (punkte) => punkte.map(([a, b]) => pt(a, b)).join(" L");
  const umriss = `M${pt(-0.5, 0.05)} L${linie(INSEL_OBEN)} L${linie(INSEL_UNTEN)} Z`;
  // Leuchtkante nur an der rechten Unterseite – Licht kommt von unten rechts.
  const kante = `M${linie(INSEL_UNTEN.slice(0, 8))}`;
  const schichten = `M${pt(-0.4, 0.26)} L${pt(-0.1, 0.3)} L${pt(0.28, 0.24)}
    M${pt(-0.2, 0.5)} L${pt(0.02, 0.54)} L${pt(0.22, 0.48)}`;
  // Ruinen: ein hoher schmaler Turm und ein abgebrochener.
  const ruine = ruinen
    ? `<path d="M${pt(-0.2, -0.1)} l0,${-h * 0.62} l${w * 0.03},${-h * 0.1} l${w * 0.03},${h * 0.1} l0,${h * 0.62} Z
         M${pt(0.12, -0.12)} l0,${-h * 0.36} l${w * 0.02},${h * 0.06} l${w * 0.025},${-h * 0.1} l${w * 0.015},${h * 0.04} l0,${h * 0.36} Z"
         fill="${p.deep}"/>`
    : "";
  return `<g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>
    ${ruine}
    <path d="${umriss}" fill="${p.deep}" stroke="${p.deep}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="${schichten}" fill="none" stroke="${p.glow}" stroke-width="0.8" opacity="0.28"/>
    <path d="${kante}" fill="none" stroke="${p.glow}" stroke-width="1.6" stroke-linejoin="round" opacity="0.8"/>
  </g>`;
}

// Grosses JOKER unten auf dunklem Band. Der Leuchtrand ist ein breiter,
// halbtransparenter Strich hinter der Schrift – pulsiert langsam.
function jokerTitel(uid, p) {
  const schrift = `x="${CARD_W / 2}" y="298" font-size="34" font-weight="800" letter-spacing="7"
    text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"`;
  return `
    <rect x="4" y="222" width="${CARD_W - 8}" height="${CARD_H - 226}" fill="url(#${uid}band)" clip-path="url(#${uid}k)"/>
    <text ${schrift} fill="none" stroke="${p.glow}" stroke-width="7" opacity="0.35">JOKER
      <animate attributeName="opacity" values="0.2;0.55;0.2" dur="2.4s" repeatCount="indefinite"/></text>
    <text ${schrift} fill="${p.hot}" stroke="${p.deep}" stroke-width="1.2" paint-order="stroke">JOKER</text>
    <text x="${CARD_W / 2}" y="317" font-size="9.5" font-weight="700" letter-spacing="3.5"
      text-anchor="middle" fill="${p.glow}">${p.label}</text>`;
}

// Eckzeichen: nur ein leuchtender Stern – kein Kasten, der Bild verdeckt.
function jokerStern(p, x, y) {
  return `<g>
    <circle cx="${x}" cy="${y}" r="14" fill="${p.glow}" opacity="0.22"/>
    <text x="${x}" y="${y + 1}" font-size="24" text-anchor="middle" dominant-baseline="central"
      fill="${p.hot}" stroke="${p.deep}" stroke-width="2.2" paint-order="stroke">★</text>
  </g>`;
}

// Rahmen mit pulsierendem Leuchtsaum.
function jokerRahmen(uid, p, breit = 4) {
  const r = `x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="none"`;
  return `
    <g><animate attributeName="opacity" values="0.55;1;0.55" dur="2.2s" repeatCount="indefinite"/>
      <rect ${r} stroke="${p.glow}" stroke-width="12" opacity="0.18"/>
      <rect ${r} stroke="${p.glow}" stroke-width="6" opacity="0.35"/>
    </g>
    <rect ${r} stroke="url(#${uid}rahmen)" stroke-width="${breit}"/>
    <rect x="11" y="11" width="${CARD_W - 22}" height="${CARD_H - 22}" rx="13" fill="none" stroke="${p.hot}" stroke-width="0.8" opacity="0.5"/>`;
}

// Aufsteigende Funken: [x, startY, Steighoehe, Radius, Dauer, Verzoegerung].
function jokerFunken(p, liste, farbe) {
  return liste.map(([x, y, hoch, r, dur, del]) => `<g opacity="0">
      <animateTransform attributeName="transform" type="translate" values="0 0;${(Math.sin(x) * 10).toFixed(1)} -${hoch}" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;0" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
      <circle cx="${x}" cy="${y}" r="${r * 2.8}" fill="${farbe || p.glow}" opacity="0.3"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${p.hot}"/>
    </g>`).join("");
}

// Kleiner Splitter, der ueber den Kartenrand hinausfliegt und verglueht.
function jokerSplitterFlug(p, x, y, dx, dy, dur, del) {
  return `<path d="M${x},${y} l6,-3 l2,7 l-7,2 Z" fill="${p.hot}" opacity="0">
      <animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy}" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;0" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
    </path>`;
}

// --- Riss – der Glow bricht durch ----------------------------------
const JOKER_RISSE = [
  "M236,8 L214,36 L223,58 L203,84 L211,106 L195,130",
  "M223,58 L236,72",
  "M4,328 L25,300 L16,278 L37,252 L28,230 L45,206",
  "M16,278 L4,264",
];

// Bausteine von „Riss" – das „Ritual" setzt sich ebenfalls daraus zusammen.
// Licht faellt von oberhalb der Karte ein und pendelt langsam. Kraeftig genug,
// dass es auch auf hellen Bildern (Himmel!) noch ankommt.
function rissStrahlen(uid) {
  const strahlen = [[-36, 15, 0.27], [-19, 9, 0.2], [-3, 19, 0.34], [14, 11, 0.22], [31, 17, 0.27]]
    .map(([winkel, w, op]) => {
      const a = (winkel * Math.PI) / 180, len = 360, cx = 120, cy = -40;
      const ex = cx + Math.sin(a) * len, ey = cy + Math.cos(a) * len;
      const px = Math.cos(a) * w, py = -Math.sin(a) * w;
      return `<path d="M${cx},${cy} L${(ex + px).toFixed(1)},${(ey + py).toFixed(1)} L${(ex - px).toFixed(1)},${(ey - py).toFixed(1)} Z" opacity="${op}"/>`;
    }).join("");
  return `<g clip-path="url(#${uid}k)"><g fill="url(#${uid}strahl)">
      <animateTransform attributeName="transform" type="rotate" values="-4 120 -40;4 120 -40;-4 120 -40" dur="9s" repeatCount="indefinite"/>
      ${strahlen}
    </g></g>`;
}

// Gluehende Risse aus zwei Ecken, ein Lichtimpuls laeuft sie entlang.
function rissRisse(p) {
  const lage = (farbe, w, op) => JOKER_RISSE.map((d) =>
    `<path d="${d}" stroke="${farbe}" stroke-width="${w}" opacity="${op}"/>`).join("");
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
      ${lage(p.glow, 8, 0.22)}${lage(p.glow, 2.8, 0.8)}${lage(p.hot, 1.1, 1)}
      <g stroke-dasharray="16 110">
        <animate attributeName="stroke-dashoffset" values="126;0" dur="1.6s" repeatCount="indefinite"/>
        ${lage("#ffffff", 2.2, 0.95)}
      </g>
    </g>`;
}

// Wo die Risse den Rand treffen: Lichtblitz, abgesprengte Splitter fliegen hinaus.
function rissAussen(uid, p) {
  const splitter = (...a) => jokerSplitterFlug(p, ...a);
  const blitz = (x, y) => `<circle cx="${x}" cy="${y}" r="16" fill="url(#${uid}kranz)">
      <animate attributeName="r" values="12;22;12" dur="1.8s" repeatCount="indefinite"/></circle>`;
  return `<g class="joker-aussen">
      ${blitz(236, 8)}${blitz(4, 328)}
      ${splitter(230, 12, 30, -26, 1.9, 0)}${splitter(226, 20, 36, -8, 2.3, 0.8)}${splitter(232, 6, 14, -34, 2.1, 1.4)}
      ${splitter(6, 322, -30, 24, 2, 0.4)}${splitter(12, 316, -36, 6, 2.4, 1.1)}${splitter(4, 330, -14, 30, 2.2, 1.7)}
    </g>`;
}

// Ausbruch (nur beim Riss selbst): alle 4,5 s flammen die Risse auf, zwei
// Nebenrisse schiessen ins Bild – am Gesicht (oben Mitte) vorbei –, eine
// Splitter-Salve fliegt hinaus, die Karte leuchtet auf und zittert kurz.
// Dazwischen bleibt es die ruhige Riss-Optik.
const RISS_TAKT = 4.5;
const RISS_NEBENRISSE = [
  "M211,106 L190,120 L195,142 L172,158 L176,178",
  "M37,252 L58,240 L52,220 L76,206 L70,186",
];

function rissAusbruch(uid, p) {
  const zeit = (werte, zeiten) => `values="${werte}" keyTimes="${zeiten}" dur="${RISS_TAKT}s" repeatCount="indefinite"`;
  const aufflammen = JOKER_RISSE.map((d) => `<path d="${d}" stroke="${p.glow}" stroke-width="18" opacity="0">
      <animate attributeName="opacity" ${zeit("0;0;0.55;0.15;0;0", "0;0.48;0.5;0.58;0.66;1")}/></path>`).join("");
  // Nebenrisse „wachsen" per Strichlaenge (pathLength 100 = ganze Linie).
  const wachsen = `<animate attributeName="stroke-dashoffset" ${zeit("100;100;0;0", "0;0.5;0.53;1")}/>`;
  const neben = RISS_NEBENRISSE.map((d) => `<g opacity="0">
      <animate attributeName="opacity" ${zeit("0;0;1;1;0;0", "0;0.49;0.5;0.62;0.76;1")}/>
      <path d="${d}" pathLength="100" stroke="${p.glow}" stroke-width="6" opacity="0.35" stroke-dasharray="100" stroke-dashoffset="100">${wachsen}</path>
      <path d="${d}" pathLength="100" stroke="${p.hot}" stroke-width="1.2" stroke-dasharray="100" stroke-dashoffset="100">${wachsen}</path>
    </g>`).join("");
  const salve = [[236, 8, 34, -30], [228, 16, 40, -6], [232, 4, 12, -40], [4, 328, -34, 28], [10, 318, -40, 4], [6, 332, -10, 38]]
    .map(([x, y, dx, dy]) => `<path d="M${x},${y} l6,-3 l2,7 l-7,2 Z" fill="${p.hot}" opacity="0">
      <animateTransform attributeName="transform" type="translate" ${zeit(`0 0;0 0;${dx} ${dy};${dx} ${dy}`, "0;0.5;0.72;1")}/>
      <animate attributeName="opacity" ${zeit("0;0;1;0;0", "0;0.5;0.52;0.72;1")}/>
    </path>`).join("");
  return {
    blitz: `<rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="${p.hot}" opacity="0" clip-path="url(#${uid}k)">
      <animate attributeName="opacity" ${zeit("0;0;0.26;0.06;0;0", "0;0.49;0.51;0.56;0.64;1")}/></rect>`,
    risse: `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${aufflammen}${neben}</g>`,
    aussen: `<g class="joker-aussen">${salve}</g>`,
    zittern: `<animateTransform attributeName="transform" type="translate"
      ${zeit("0 0;0 0;1.6 -1.2;-1.4 1;0.8 0.6;0 0;0 0", "0;0.495;0.505;0.52;0.535;0.55;1")}/>`,
  };
}

function jokerRiss(uid, p, image) {
  const aus = rissAusbruch(uid, p);
  return `<g>${aus.zittern}
    ${jokerMotiv(uid, p, image)}
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    ${rissStrahlen(uid)}
    ${aus.blitz}
    ${jokerFunken(p, [[34, 300, 120, 2, 3.6, 0], [70, 320, 150, 1.5, 4.4, 1.1], [104, 312, 110, 2.3, 3.1, 2], [150, 318, 140, 1.7, 4.8, 0.6],
      [184, 306, 125, 2.2, 3.4, 1.7], [210, 322, 160, 1.4, 5.2, 2.6], [124, 326, 170, 1.9, 4.1, 3.1]])}
    ${jokerTitel(uid, p)}
    ${jokerRahmen(uid, p)}
    ${rissRisse(p)}
    ${aus.risse}
    ${rissAussen(uid, p)}
    ${aus.aussen}
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}
  </g>`;
}

// --- Siegel – Beschwoerung ------------------------------------------
// Ein leuchtender Runenkreis liegt flach unter der Karte, als stuende sie darin,
// und dreht sich. Gezeichnet wird er als Kreis, der flachgedrueckt wird. Die
// hintere Haelfte liegt HINTER der Karte (nur seitlich sichtbar), die vordere
// davor – das ergibt die Tiefe. Runen sind eigene Linienzeichen: Unicode-Runen
// fehlen auf vielen Handys in der Schrift und erschienen als leere Kaestchen.
const SIEGEL_RUNEN = [
  "M0,0 L0,14 M0,3 L7,0 M0,8 L7,5",
  "M0,14 L0,0 L7,5 L7,14",
  "M0,0 L0,14 M0,4 L6,7 L0,10",
  "M3,0 L3,14 M0,4 L6,10 M6,4 L0,10",
  "M0,0 L7,7 L0,14",
  "M0,14 L3.5,0 L7,14 M1.5,8 L5.5,8",
];

// Bausteine vom „Siegel" – das „Ritual" nutzt sie ebenfalls.
function siegelTeile(uid, p) {
  const strich = `vector-effect="non-scaling-stroke"`;
  const runen = Array.from({ length: 12 }, (_, i) => {
    const winkel = i * 30;
    return `<g transform="rotate(${winkel}) translate(-3.5 -138)">
      <path d="${SIEGEL_RUNEN[i % SIEGEL_RUNEN.length]}" fill="none" stroke="${p.hot}" stroke-width="1.4" ${strich}/></g>`;
  }).join("");
  const stern = (r) => [0, 1, 2, 3, 4, 5].map((k) => {
    const a = (k * 60 - 90) * Math.PI / 180;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  });
  const [s0, s1, s2, s3, s4, s5] = stern(112);
  const kreis = `<g id="${uid}siegel"><g>
      <animateTransform attributeName="transform" type="rotate" values="0;360" dur="24s" repeatCount="indefinite"/>
      <circle r="150" fill="none" stroke="${p.glow}" stroke-width="7" opacity="0.25" ${strich}/>
      <circle r="150" fill="none" stroke="${p.hot}" stroke-width="1.8" ${strich}/>
      <circle r="124" fill="none" stroke="${p.glow}" stroke-width="1.2" opacity="0.85" ${strich}/>
      <polygon points="${s0} ${s2} ${s4}" fill="none" stroke="${p.glow}" stroke-width="1.3" opacity="0.8" ${strich}/>
      <polygon points="${s1} ${s3} ${s5}" fill="none" stroke="${p.glow}" stroke-width="1.3" opacity="0.8" ${strich}/>
      ${runen}
    </g></g>`;
  // Flach unter die Karte legen; Mitte genau an der Unterkante.
  const lage = (clip) => `<g clip-path="url(#${uid}${clip})"><g transform="translate(120 330) scale(0.98 0.24)">
      <use href="#${uid}siegel" xlink:href="#${uid}siegel"/></g></g>`;
  const saeule = (x, dur, del) => `<rect x="${x - 5}" y="110" width="10" height="220" fill="url(#${uid}saeule)" opacity="0">
      <animate attributeName="opacity" values="0;0.9;0.3;0.9;0" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/></rect>`;
  return {
    defs: `<defs>
      ${kreis}
      <clipPath id="${uid}hinten"><rect x="-80" y="200" width="400" height="130"/></clipPath>
      <clipPath id="${uid}vorne"><rect x="-80" y="330" width="400" height="80"/></clipPath>
    </defs>`,
    // Hintere Kreishaelfte, Lichtsaeulen und Funken – liegen HINTER der Karte.
    hinten: `<g class="joker-aussen">
      ${lage("hinten")}
      ${saeule(-14, 3.2, 0)}${saeule(254, 3.6, 1.1)}${saeule(-26, 4.1, 2)}${saeule(266, 2.9, 0.6)}
      ${jokerFunken(p, [[-16, 320, 150, 1.8, 3, 0.2], [256, 316, 160, 1.6, 3.4, 1.3], [-24, 300, 120, 1.4, 2.7, 2.1], [262, 296, 130, 1.9, 3.8, 0.9]])}
    </g>`,
    // Licht von unten auf die Karte; alle 5 s flammt der Kreis auf und die
    // Karte leuchtet leicht mit.
    boden: `<rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}boden)" clip-path="url(#${uid}k)">
      <animate attributeName="opacity" values="0.7;1;0.7" dur="2.6s" repeatCount="indefinite"/>
    </rect>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="${p.hot}" opacity="0" clip-path="url(#${uid}k)">
      <animate attributeName="opacity" values="0;0;0.14;0;0" keyTimes="0;0.7;0.76;0.9;1" dur="5s" repeatCount="indefinite"/>
    </rect>`,
    // Vordere Kreishaelfte – liegt VOR der Karte.
    vorne: `<g class="joker-aussen">
      <ellipse cx="120" cy="330" rx="150" ry="30" fill="${p.glow}" opacity="0.14">
        <animate attributeName="opacity" values="0.14;0.14;0.5;0.14;0.14" keyTimes="0;0.7;0.76;0.9;1" dur="5s" repeatCount="indefinite"/>
      </ellipse>
      ${lage("vorne")}
    </g>`,
  };
}

function jokerSiegel(uid, p, image) {
  const s = siegelTeile(uid, p);
  return `
    ${s.defs}
    ${s.hinten}
    ${jokerMotiv(uid, p, image)}
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    ${s.boden}
    ${jokerFunken(p, [[60, 320, 130, 1.6, 3.3, 0.4], [160, 324, 150, 1.9, 3.7, 1.5]])}
    ${jokerTitel(uid, p)}
    ${jokerRahmen(uid, p)}
    ${s.vorne}
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}`;
}

// --- Orbit – gekreuzte Runenringe wie eine Armillarsphaere ------------------
// Zwei schraeg gekreuzte Ringe drehen sich gegenlaeufig um die Karte. Hintere
// Haelften liegen hinter der Karte, vordere davor; Lichtkugeln mit Schweif
// wandern dadurch hinter und vor die Karte. (Ein einzelner duenner Ring war zu
// langweilig.) Technik wie beim Siegel: flachgedrueckter, sich drehender Kreis.
function jokerOrbit(uid, p, image) {
  const strich = `vector-effect="non-scaling-stroke"`;
  const kugel = (r, winkel, richtung) => [4, 3, 2, 1, 0].map((k) => {
    const a = ((winkel - richtung * k * 7 - 90) * Math.PI) / 180;
    const x = (Math.cos(a) * r).toFixed(1), y = (Math.sin(a) * r).toFixed(1);
    return k === 0
      ? `<circle cx="${x}" cy="${y}" r="14" fill="url(#${uid}kranz)"/><circle cx="${x}" cy="${y}" r="5.5" fill="${p.hot}"/>`
      : `<circle cx="${x}" cy="${y}" r="${5 - k}" fill="${p.glow}" opacity="${(0.7 - k * 0.14).toFixed(2)}"/>`;
  }).join("");
  // [id, Radius, Drehdauer, Richtung, Mitte y, Neigung, Stauchung]
  const ringe = [["a", 150, 12, 1, 186, -14, 0.22], ["b", 136, 9, -1, 176, 22, 0.3]];
  const ringDef = ([id, r, dur, richtung]) => `<g id="${uid}ring${id}"><g>
      <animateTransform attributeName="transform" type="rotate" values="0;${360 * richtung}" dur="${dur}s" repeatCount="indefinite"/>
      <circle r="${r}" fill="none" stroke="${p.glow}" stroke-width="12" opacity="0.22" ${strich}/>
      <circle r="${r}" fill="none" stroke="${p.hot}" stroke-width="2.4" ${strich}/>
      <circle r="${r - 13}" fill="none" stroke="${p.glow}" stroke-width="1.2" opacity="0.8" stroke-dasharray="5 8" ${strich}/>
      ${Array.from({ length: 14 }, (_, i) => `<g transform="rotate(${(i * 360) / 14}) translate(-3.2 ${-r + 1}) scale(0.9)">
        <path d="${SIEGEL_RUNEN[i % SIEGEL_RUNEN.length]}" fill="none" stroke="${p.hot}" stroke-width="1.5" ${strich}/></g>`).join("")}
      ${kugel(r, 0, richtung)}${kugel(r, 180, richtung)}
    </g></g>`;
  const schnitt = (cy, neigung, vorne) =>
    `<rect x="-140" y="${vorne ? cy : cy - 110}" width="520" height="110" transform="rotate(${neigung} 120 ${cy})"/>`;
  const lage = ([id, , , , cy, neigung, stauch], vorne) =>
    `<g clip-path="url(#${uid}${vorne ? "v" : "h"}${id})"><g transform="translate(120 ${cy}) rotate(${neigung}) scale(0.98 ${stauch})">
      <use href="#${uid}ring${id}" xlink:href="#${uid}ring${id}"/></g></g>`;
  return `
    <defs>
      ${ringe.map(ringDef).join("")}
      ${ringe.map(([id, , , , cy, neigung]) => `<clipPath id="${uid}h${id}">${schnitt(cy, neigung, false)}</clipPath>
        <clipPath id="${uid}v${id}">${schnitt(cy, neigung, true)}</clipPath>`).join("")}
    </defs>
    <g class="joker-aussen">${ringe.map((r) => lage(r, false)).join("")}</g>
    ${jokerMotiv(uid, p, image)}
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="${p.hot}" opacity="0" clip-path="url(#${uid}k)">
      <animate attributeName="opacity" values="0;0;0.16;0;0" keyTimes="0;0.46;0.5;0.6;1" dur="6s" repeatCount="indefinite"/>
    </rect>
    ${jokerFunken(p, [[40, 300, 110, 1.6, 3, 0.3], [196, 306, 120, 1.8, 3.4, 1.4]])}
    ${jokerTitel(uid, p)}
    ${jokerRahmen(uid, p)}
    <g class="joker-aussen">${ringe.map((r) => lage(r, true)).join("")}</g>
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}`;
}

// --- Glyphen – die Karte laedt sich auf -------------------------------------
// Runen entlang des Kartenrands leuchten nacheinander auf (links hoch, oben
// entlang, rechts runter). Sind alle an, leuchtet die Karte auf und ein Ring
// pulst hinter der Karte nach aussen; dann verloeschen sie und es beginnt neu.
// Unten bleibt Platz fuer JOKER.
const GLYPHEN_TAKT = 6;

function jokerGlyphen(uid, p, image) {
  const orte = [];
  for (let y = 262; y >= 42; y -= 22) orte.push([14, y]);    // links hoch
  for (let x = 40; x <= 200; x += 20) orte.push([x, 14]);    // oben entlang
  for (let y = 42; y <= 262; y += 22) orte.push([226, y]);   // rechts runter
  const runen = orte.map(([x, y], i) => {
    const an = 0.04 + (i / orte.length) * 0.6;
    const zeiten = `0;${an.toFixed(3)};${(an + 0.015).toFixed(3)};0.78;0.86;1`;
    const rune = SIEGEL_RUNEN[i % SIEGEL_RUNEN.length];
    return `<g transform="translate(${x - 2.8} ${y - 5.6}) scale(0.8)" fill="none" stroke-linecap="round">
      <path d="${rune}" stroke="${p.glow}" stroke-width="6" opacity="0">
        <animate attributeName="opacity" values="0;0;0.5;0.5;0;0" keyTimes="${zeiten}" dur="${GLYPHEN_TAKT}s" repeatCount="indefinite"/></path>
      <path d="${rune}" stroke="${p.hot}" stroke-width="1.8" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.3;1;1;0.3;0.3" keyTimes="${zeiten}" dur="${GLYPHEN_TAKT}s" repeatCount="indefinite"/></path>
    </g>`;
  }).join("");
  const puls = (dash) => `<ellipse cx="120" cy="168" rx="128" ry="176" fill="none" stroke="${dash ? p.hot : p.glow}"
      stroke-width="${dash ? 1.4 : 5}"${dash ? ' stroke-dasharray="3 9"' : ""} opacity="0">
      <animate attributeName="rx" values="128;128;156;156" keyTimes="0;0.66;0.86;1" dur="${GLYPHEN_TAKT}s" repeatCount="indefinite"/>
      <animate attributeName="ry" values="176;176;204;204" keyTimes="0;0.66;0.86;1" dur="${GLYPHEN_TAKT}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0;0.9;0;0" keyTimes="0;0.66;0.68;0.86;1" dur="${GLYPHEN_TAKT}s" repeatCount="indefinite"/>
    </ellipse>`;
  return `
    <g class="joker-aussen">${puls(false)}${puls(true)}</g>
    ${jokerMotiv(uid, p, image)}
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    <rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="16" fill="none" stroke="${p.deep}" stroke-width="18" opacity="0.45" clip-path="url(#${uid}k)"/>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="${p.hot}" opacity="0" clip-path="url(#${uid}k)">
      <animate attributeName="opacity" values="0;0;0.28;0.08;0;0" keyTimes="0;0.66;0.69;0.74;0.8;1" dur="${GLYPHEN_TAKT}s" repeatCount="indefinite"/>
    </rect>
    ${runen}
    ${jokerFunken(p, [[60, 310, 120, 1.6, 3.2, 0.5], [180, 316, 130, 1.8, 3.6, 1.8]])}
    ${jokerTitel(uid, p)}
    ${jokerRahmen(uid, p)}`;
}

// Weitere, geparkte Stile liegen in joker-archiv.js (vom Spiel nicht geladen).
const JOKER_BAU = { riss: jokerRiss, siegel: jokerSiegel, glyphen: jokerGlyphen, orbit: jokerOrbit };

// Joker mit oder ohne Bild im aktuell gewaehlten Stil.
function jokerSVG(card, image) {
  const p = jokerPalette(card.jokerColor);
  const uid = "jk" + (++_cidSeq);
  const bau = JOKER_BAU[jokerStilFuer(card)] || JOKER_BAU.riss;
  return jokerDefs(uid, p) + bau(uid, p, image);
}

// --- Zusammenbau ------------------------------------------------------------

function svgWrap(inner, extraClass = "", withDefs = "") {
  return `<svg class="card-svg ${extraClass}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" preserveAspectRatio="xMidYMid meet">
    ${withDefs}${inner}</svg>`;
}

// Ecken-Badge (Rang + Farbe) mit lesbarem Hintergrund – für Porträt-Karten.
function cornerBadge(rank, glyph, color, x, y, rotate, t) {
  const transform = rotate ? `rotate(180 ${x} ${y})` : "";
  return `<g transform="${transform}">
    <rect x="${x - 19}" y="${y - 25}" width="38" height="64" rx="9" fill="#f6ecd2" stroke="${t.dk}" stroke-width="1.6" opacity="0.96"/>
    <text x="${x}" y="${y}" font-size="30" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${color}" font-family="Georgia, 'Times New Roman', serif">${esc(rank)}</text>
    <text x="${x}" y="${y + 26}" font-size="23" text-anchor="middle" dominant-baseline="central" fill="${color}">${glyph}</text>
  </g>`;
}

// Vorderseite als Porträt: hochgeladenes Bild groß, Rang/Farbe in den Ecken.
function portraitFace(card, image, uid, tier, t) {
  const glyph = SUIT_GLYPH[card.suit];
  const color = RED_SUITS.has(card.suit) ? INK_RED : INK_DARK;
  const label = RANK_LABEL[card.rank] || card.rank;
  // Bild fuellt die GANZE Karte (frueher lag es 18px innen -> ringsum war der
  // Pergamentrand als grauer Streifen zu sehen). Nur der Metallrahmen liegt
  // noch obendrauf; Schmuck der Stufe kommt darueber.
  const ix = 5, iy = 5, iw = CARD_W - 10, ih = CARD_H - 10;
  const cid = uid + "c";
  let extra = "";
  if (tier === "gold" || tier === "platin") {
    extra = gem(CARD_W / 2, 15, t) + gem(CARD_W / 2, CARD_H - 15, t) +
            gem(15, CARD_H / 2, t) + gem(CARD_W - 15, CARD_H / 2, t);
  }
  return `
    <clipPath id="${cid}"><rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="16"/></clipPath>
    <image href="${esc(image)}" xlink:href="${esc(image)}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/>
    <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="16" fill="url(#swiPaper)" opacity="0.12" style="mix-blend-mode:overlay"/>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="none" stroke="url(#${uid}m)" stroke-width="5"/>
    <rect x="9" y="9" width="${CARD_W - 18}" height="${CARD_H - 18}" rx="14" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="1.2"/>
    ${extra}
    ${cornerBadge(label, glyph, color, 34, 40, false, t)}
    ${cornerBadge(label, glyph, color, CARD_W - 34, CARD_H - 40, true, t)}
    ${tierPlate(t, t.name, null)}`;
}

function renderCardSVG(card, image) {
  ensureGlobalDefs();
  if (!card) return renderBackSVG(image);
  // Joker: mit Bild als Porträt (Bild bleibt sichtbar!), sonst Drachen-Karte.
  if (card.suit === "joker") {
    return svgWrap(jokerSVG(card, image), "is-joker");
  }

  const tier = tierKey(card);
  const t = TIERS[tier];
  const uid = "c" + (++_cidSeq);
  const d = defs(uid, t);

  if (image) return svgWrap(portraitFace(card, image, uid, tier, t), "tier-" + tier, d);

  const glyph = SUIT_GLYPH[card.suit];
  const color = RED_SUITS.has(card.suit) ? INK_RED : INK_DARK;
  const label = RANK_LABEL[card.rank] || card.rank;

  let center = "";
  if (card.rank in PIPS) {
    for (const [col, yf] of PIPS[card.rank]) {
      center += pip(glyph, color, COL[col] * CARD_W, yf * CARD_H, yf > 0.5);
    }
  } else if (card.rank === "A") {
    center = pip(glyph, color, CARD_W / 2, CARD_H / 2 - 8, false, 104);
  } else {
    center = faceCard(label, glyph, color);
  }

  const corners =
    corner(label, glyph, color, 32, 44, false) +
    corner(label, glyph, color, CARD_W - 32, CARD_H - 44, true);

  return svgWrap(frame(uid, tier, t) + center + corners + tierPlate(t, t.name, null), "tier-" + tier, d);
}

function renderBackSVG(image) {
  // Rückseite mit hochgeladenem Char-Bild: Porträt + Bronze-Rahmen + Vignette.
  // WICHTIG: für ALLE Karten identisch – darf den Joker nicht verraten.
  if (image) {
    const ix = 5, iy = 5, iw = CARD_W - 10, ih = CARD_H - 10;
    const cid = "cb" + (++_cidSeq);
    const cx = CARD_W / 2, cy = CARD_H / 2;
    const rays = Array.from({ length: 8 }).map((_, i) => {
      const a = (i * Math.PI) / 4;
      return `<line x1="${(Math.cos(a) * 40).toFixed(1)}" y1="${(Math.sin(a) * 40).toFixed(1)}" x2="${(Math.cos(a) * 70).toFixed(1)}" y2="${(Math.sin(a) * 70).toFixed(1)}" stroke-width="${i % 2 ? 1 : 2.5}"/>`;
    }).join("");
    // Rückseite: Bild entsättigt + abgedunkelt + Bronze-Kompass -> klar „verdeckt".
    return `<svg class="card-svg card-back" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="${cid}f"><feColorMatrix type="saturate" values="0.2"/></filter>
        <radialGradient id="${cid}v" cx="50%" cy="46%" r="72%">
          <stop offset="0%" stop-color="#1a1206" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#0c0904" stop-opacity="0.82"/>
        </radialGradient>
        <clipPath id="${cid}"><rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="16"/></clipPath>
      </defs>
      <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="#0f0b06" stroke="${BRONZE}" stroke-width="3"/>
      <g clip-path="url(#${cid})">
        <image href="${esc(image)}" xlink:href="${esc(image)}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid slice" filter="url(#${cid}f)"/>
        <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="#241a10" opacity="0.42"/>
        <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="url(#${cid}v)"/>
      </g>
      <g transform="translate(${cx} ${cy + 1.5})" stroke="#000" fill="none" opacity="0.5">
        <circle r="54" stroke-width="2"/><circle r="40" stroke-width="1"/>
        ${rays}
      </g>
      <g transform="translate(${cx} ${cy})" stroke="${BRONZE_LT}" fill="none" opacity="0.62">
        <circle r="54" stroke-width="2"/><circle r="40" stroke-width="1"/>
        ${rays}
        <path d="M0,-48 L10,0 L0,48 L-10,0 Z" fill="${BRONZE_LT}" opacity="0.55"/>
      </g>
      <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="none" stroke="${BRONZE_LT}" stroke-width="5" opacity="0.95"/>
      <rect x="9" y="9" width="${CARD_W - 18}" height="${CARD_H - 18}" rx="14" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="1.2"/>
    </svg>`;
  }
  return `<svg class="card-svg card-back" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <defs>
      <radialGradient id="bg" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="#1c4034"/><stop offset="100%" stop-color="#0e241d"/>
      </radialGradient>
    </defs>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="url(#bg)" stroke="${BRONZE}" stroke-width="3"/>
    <rect x="16" y="16" width="${CARD_W - 32}" height="${CARD_H - 32}" rx="12" fill="none" stroke="${BRONZE_LT}" stroke-width="1.6" opacity="0.7"/>
    <g transform="translate(${CARD_W / 2} ${CARD_H / 2})" stroke="${BRONZE_LT}" fill="none" opacity="0.85">
      <circle r="52" stroke-width="2"/><circle r="38" stroke-width="1"/>
      ${Array.from({ length: 8 }).map((_, i) => {
        const a = (i * Math.PI) / 4;
        return `<line x1="${Math.cos(a) * 38}" y1="${Math.sin(a) * 38}" x2="${Math.cos(a) * 66}" y2="${Math.sin(a) * 66}" stroke-width="${i % 2 ? 1 : 2.5}"/>`;
      }).join("")}
      <path d="M0,-46 L10,0 L0,46 L-10,0 Z" fill="${BRONZE_LT}" opacity="0.5"/>
    </g>
    <text x="${CARD_W / 2}" y="${CARD_H / 2}" fill="#f0e2bf" font-size="26" text-anchor="middle" dominant-baseline="central">✦</text>
  </svg>`;
}

// --- Talent-Spur -------------------------------------------------------------
// Kurzschreibweise einer Karte: "K♠", "10♦", "🃏".
function cardShort(card) {
  if (!card) return "";
  if (card.rank === "JOKER") return "🃏";
  return (RANK_LABEL[card.rank] || card.rank) + (SUIT_GLYPH[card.suit] || "");
}

// Was hat das kartenrelevante Talent bewirkt? Zeigt die verworfenen Karten
// durchgestrichen und die behaltene hervorgehoben. Ohne diese Spur sieht man dem
// Ergebnis nicht an, dass „Schnell"/„Kühler Kopf"/„Zögerlich" ueberhaupt gewirkt
// hat – es liegt einfach eine Karte da. Die schrittweise Animation dazu laeuft
// nur auf dem Handy des jeweiligen Spielers; diese Spur bleibt stehen und ist
// fuer SL, Mitspieler und TV gleichermassen sichtbar.
// Der Text besteht ausschliesslich aus Kartenwerten/-farben (feste Zeichensaetze),
// enthaelt also nie Nutzereingaben -> kein Escaping noetig.
function cardTrail(combatant) {
  const seq = combatant && combatant.draw;
  const kept = combatant && combatant.card;
  if (!Array.isArray(seq) || seq.length < 2 || !kept) return "";
  const weg = seq.filter((c) => c && c.id !== kept.id);
  if (!weg.length) return "";
  const rot = (c) => RED_SUITS.has(c.suit) ? " rot" : "";
  const titel = `${weg.length + 1} Karten gezogen, ${weg.length} verworfen – `
    + `${weg.map(cardShort).join(", ")} raus, ${cardShort(kept)} bleibt`;
  return `<span class="talent-spur" title="${titel}">`
    + weg.map((c) => `<span class="tt-weg${rot(c)}">${cardShort(c)}</span>`).join("")
    + `<span class="tt-pfeil">→</span>`
    + `<span class="tt-bleibt${rot(kept)}">${cardShort(kept)}</span></span>`;
}

// --- Karten-Wechsel: ein Talent verwirft eine Karte --------------------------
// Drei Takte, damit man den Wechsel SIEHT statt nur ein „Zack":
//   1. Markieren  – die Karte pulsiert zweimal glutrot, ein Schild sagt warum.
//   2. Verwerfen  – eine Kopie der Karte verglüht und kippt weg.
//   3. Nachziehen – die neue Karte steigt darunter auf.
// Bewegt wird nur über transform/opacity/box-shadow – kein animierter filter
// (der würde das Karten-SVG pro Frame neu rastern, siehe style.css).
// „Schnell" pulsiert knapper: dort koennen mehrere Nieten hintereinander
// fliegen, und die Zeiten summieren sich. Das Verglühen (TOSS) ist bei beiden
// gleich – seine Dauer steht fest im CSS (.discard-ghost, 0.7s).
const DISCARD = { SEE: 300, MARK: 1100, TOSS: 700 };
const DISCARD_SCHNELL = { SEE: 200, MARK: 700, TOSS: 700 };
for (const d of [DISCARD, DISCARD_SCHNELL]) d.TOTAL = d.SEE + d.MARK + d.TOSS;
const discardTiming = (reason) => (reason && reason.schnell ? DISCARD_SCHNELL : DISCARD);

// Vergleichswert wie engine.card_value (für die Begründung im Schild).
const _RANK_NUM = { A: 14, K: 13, Q: 12, J: 11 };
const _SUIT_NUM = { spades: 4, hearts: 3, diamonds: 2, clubs: 1 };
function _cardVal(c) {
  if (c.rank === "JOKER") return 150 + (c.jokerColor === "black" ? 2 : 1);
  return (_RANK_NUM[c.rank] || Number(c.rank)) * 10 + (_SUIT_NUM[c.suit] || 0);
}

// Warum flog welche Karte raus? Bildet engine.deal_one_combatant nach: die
// ersten 1–3 Karten sind die Auswahl (Kühler Kopf/Zögerlich), alles danach
// sind „Schnell"-Nachzieher. Ergebnis: Karten-ID -> Schild-HTML.
// Enthält nur feste Texte, keine Nutzereingaben.
function discardReasons(draw, kept, talents) {
  const out = new Map();
  if (!Array.isArray(draw) || !kept) return out;
  const t = new Set(talents || []);
  const [count, mode, name] =
    t.has("sehr_kuehler_kopf") ? [3, "best", "Sehr Kühler Kopf"]
    : t.has("kuehler_kopf") ? [2, "best", "Kühler Kopf"]
    : t.has("zoegerlich") ? [2, "worst", "Zögerlich"]
    : [1, "best", ""];
  const first = draw.slice(0, count);
  // Auswahl wie engine._select: bei „worst" gewinnt trotzdem ein Joker.
  const jokers = first.filter((c) => c.rank === "JOKER");
  const higher = (a, b) => (_cardVal(a) >= _cardVal(b) ? a : b);
  const lower = (a, b) => (_cardVal(a) <= _cardVal(b) ? a : b);
  const chosen = mode === "worst"
    ? (jokers.length ? jokers.reduce(higher) : first.reduce(lower))
    : first.reduce(higher);
  // Kurz halten: das Schild liegt auf einer ~250 px breiten Karte und darf die
  // Eckwerte nicht verdecken.
  const warum = mode === "worst"
    ? (chosen.rank === "JOKER" ? "Joker zählt trotzdem" : "stärkere fliegt")
    : "schwächere fliegt";
  for (const c of draw) {
    if (c.id === kept.id) continue;
    const ausAuswahl = count > 1 && first.includes(c) && c.id !== chosen.id;
    out.set(c.id, ausAuswahl
      ? { html: `<b>${name}</b><span>${warum}</span>`, schnell: false }
      : { html: `<b>Schnell</b><span>5 oder weniger</span>`, schnell: true });
  }
  return out;
}

// Ein Wechsel: die sichtbare Karte in `flip` wird markiert, verworfen und
// durch `nextSvg` ersetzt. Dauer: MARK + TOSS der passenden Zeiten (discardTiming).
function playDiscard(flip, nextSvg, reason) {
  const inner = flip.querySelector(".flip-inner");
  const front = flip.querySelector(".flip-front");
  if (!inner || !front) return;
  const holder = flip.closest(".card-holder") || flip.parentNode;
  const tm = discardTiming(reason);

  // Takt 1: markieren. Das Schild haengt am Halter, nicht an der pulsierenden
  // Karte – so bleibt der Text ruhig und lesbar. Zwei Pulse passen genau in
  // MARK; das CSS liest die Pulsdauer aus --puls.
  const tag = document.createElement("div");
  tag.className = "discard-tag";
  tag.innerHTML = (reason && reason.html) || "<b>verworfen</b>";
  holder.appendChild(tag);
  flip.style.setProperty("--puls", tm.MARK / 2 + "ms");
  flip.classList.add("discard-mark");

  setTimeout(() => {
    flip.classList.remove("discard-mark");
    flip.style.removeProperty("--puls");
    if (!flip.isConnected) { tag.remove(); return; }
    // Takt 2: Kopie der alten Karte verglueht und kippt weg ...
    const ghost = document.createElement("div");
    ghost.className = "discard-ghost";
    ghost.innerHTML = front.innerHTML;
    inner.appendChild(ghost);
    tag.classList.add("gone");
    // ... Takt 3: waehrenddessen steigt darunter die neue Karte auf.
    front.innerHTML = nextSvg;
    front.classList.remove("draw-in");
    void front.offsetWidth;            // Animation sicher neu starten
    front.classList.add("draw-in");
    setTimeout(() => {
      ghost.remove();
      tag.remove();
      front.classList.remove("draw-in");
    }, tm.TOSS + 60);
  }, tm.MARK);
}

// Ganze Zieh-Sequenz abspielen: `seq` = gezeigte Reihenfolge (behaltene Karte
// zuletzt), seq[0] liegt bereits offen. Startet nach `startDelay` ms und gibt
// die Gesamtdauer zurueck (fuer die Render-Sperre in app.js).
function playDrawSequence(flip, seq, reasons, image, startDelay = 0) {
  if (!Array.isArray(seq) || seq.length < 2) return 0;
  const grund = (card) => reasons && reasons.get(card.id);
  let i = 1;
  const next = () => {
    if (!flip.isConnected || i >= seq.length) return;
    const tm = discardTiming(grund(seq[i - 1]));
    playDiscard(flip, renderCardSVG(seq[i], image), grund(seq[i - 1]));
    i += 1;
    // Naechster Wechsel: dieser endet nach MARK+TOSS, dann kurz die neue Karte zeigen.
    if (i < seq.length) setTimeout(next, tm.MARK + tm.TOSS + discardTiming(grund(seq[i - 1])).SEE);
  };
  setTimeout(next, startDelay + discardTiming(grund(seq[0])).SEE);
  return startDelay + drawSequenceDuration(seq, reasons);
}

// Gesamtdauer aller Wechsel (fuer die Render-Sperre in app.js).
function drawSequenceDuration(seq, reasons) {
  if (!Array.isArray(seq) || seq.length < 2) return 0;
  let summe = 0;
  for (const card of seq.slice(0, -1)) summe += discardTiming(reasons && reasons.get(card.id)).TOTAL;
  return summe;
}

window.Cards = {
  renderCardSVG, renderBackSVG, short: cardShort, trail: cardTrail,
  DISCARD, DISCARD_SCHNELL, discardReasons, playDrawSequence, drawSequenceDuration,
  JOKER_STILE, JOKER_NAMEN,
  // Angehakte Stile (leer/ungueltig -> alle).
  setJokerAuswahl: (liste) => {
    const gut = (liste || []).filter((s) => JOKER_STILE.includes(s));
    jokerAuswahl = gut.length ? gut : JOKER_STILE.slice();
  },
  setJokerRunde: (n) => { jokerRunde = Number(n) || 0; },
  // Nur Musterseite: einen Stil erzwingen (null = wieder normal waehlen).
  setJokerStil: (s) => { jokerErzwungen = JOKER_BAU[s] ? s : null; },
};
