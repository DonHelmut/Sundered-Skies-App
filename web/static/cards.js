// Erzeugt Spielkarten als SVG im Sundered-Skies-Look: Pergament, Zierrahmen,
// thematische Bildkarten. Farben (Pik/Herz/Karo/Kreuz) und 2 Joker bleiben
// standardkonform. Keine externen Bilder.
//
// Wertigkeits-Stufen (sofort am Rahmen erkennbar):
//   2–5 Bronze · 6–9 Silber · 10/B/D/K Gold · A Platin · Joker = Flammen-Emblem.

const SUIT_GLYPH = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const RED_SUITS = new Set(["hearts", "diamonds"]);
// Deutsche Kartenwerte: Bube (B), Dame (D), König (K), Ass (A).
const RANK_LABEL = { J: "B", Q: "D", K: "K", A: "A" };

const CARD_W = 240;
const CARD_H = 336;
const INK_RED = "#9e2b1c";
const INK_DARK = "#2b241c";
const BRONZE = "#8a6a2f";
const BRONZE_LT = "#c8a15a";

// Metall-Stufen: lt = heller Glanz, dk = Schatten, plate = Namensschild-Grund.
const TIERS = {
  bronze: { name: "BRONZE", lt: "#d8b06a", dk: "#8a6a2f", ink: "#5c4620",
            p0: "#fbf1d8", p1: "#f2e2bd", p2: "#e4cd9c" },
  silver: { name: "SILBER", lt: "#f2f7fa", dk: "#8ea0ac", ink: "#54626b",
            p0: "#fdfaf3", p1: "#eef0ea", p2: "#dcdfd9" },
  gold:   { name: "GOLD",   lt: "#ffe89a", dk: "#c08c1e", ink: "#6d5210",
            p0: "#fdf5de", p1: "#f7e9c0", p2: "#eed79b" },
  platin: { name: "PLATIN", lt: "#ffffff", dk: "#9db6c8", ink: "#4a5c68",
            p0: "#ffffff", p1: "#f2f6fa", p2: "#dde7ef" },
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

// Zierecke (kleines Blatt/Wirbel) an einer Innenkante.
function flourish(x, y, rot, t) {
  return `<g transform="translate(${x} ${y}) rotate(${rot})" fill="none" stroke="${t.dk}" stroke-width="2" opacity="0.75">
    <path d="M0,0 q14,2 18,16 q-12,-2 -18,-16 Z" fill="${t.dk}" opacity="0.55"/>
    <circle cx="2" cy="2" r="2.4" fill="${t.dk}"/>
  </g>`;
}

// Kleiner Edelstein/Rhombus – Schmuck für Gold & Platin.
function gem(x, y, t, r = 5) {
  return `<path d="M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z"
    fill="${t.lt}" stroke="${t.dk}" stroke-width="1" opacity="0.95"/>`;
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

// Funkeln: Stern + weicher Hof (als Kreis GEMALT, nicht gefiltert – ein
// drop-shadow hier würde pro Frame neu gerastert und lässt das Umdrehen hängen).
function sparkles(color, seedList) {
  return seedList.map(([x, y, r, delay]) => `
    <g transform="translate(${x} ${y})">
      <animate attributeName="opacity" values="0.1;1;0.1" dur="2.4s" begin="${delay}s" repeatCount="indefinite"/>
      <circle r="${r * 1.9}" fill="${color}" opacity="0.16"/>
      <circle r="${r * 1.1}" fill="${color}" opacity="0.28"/>
      <path d="M0,-${r} L${r * 0.26},-${r * 0.26} L${r},0 L${r * 0.26},${r * 0.26} L0,${r}
               L-${r * 0.26},${r * 0.26} L-${r},0 L-${r * 0.26},-${r * 0.26} Z" fill="#fff8e0"/>
    </g>`).join("");
}

// Flammen/Rauch, die von unten aufsteigen.
// Züngelnde Flammen von unten. Das Glühen ist GEMALT (drei Lagen: Glut außen,
// Flamme, heißer Kern) statt per Filter – sieht warm aus und kostet fast nichts.
function flames(uid, color, hot) {
  // [x, Hoehe, Breite, Verzoegerung, Dauer]
  const wisps = [
    [40, 78, 20, 0.0, 3.4],
    [86, 116, 26, 0.7, 4.2],
    [134, 92, 22, 1.3, 3.0],
    [182, 128, 28, 1.9, 3.9],
    [218, 70, 18, 2.5, 3.3],
  ];
  const wisp = (h, w) =>
    `M0,0 C${-w},${-h * 0.32} ${w * 0.62},${-h * 0.5} ${w * 0.12},${-h}` +
    ` C${w * 0.95},${-h * 0.52} ${w * 1.02},${-h * 0.26} 0,0 Z`;
  const body = wisps.map(([x, h, w, delay, dur]) => `
    <g transform="translate(${x} ${CARD_H - 20})">
      <animateTransform attributeName="transform" type="scale" additive="sum"
        values="1 0.82; 1.06 1.18; 1 0.82" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.45;0.95;0.45" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>
      <path d="${wisp(h * 1.22, w * 1.5)}" fill="${color}" opacity="0.18"/>
      <path d="${wisp(h, w)}" fill="${color}" opacity="0.55"/>
      <path d="${wisp(h * 0.55, w * 0.5)}" fill="${hot}" opacity="0.75"/>
    </g>`).join("");
  return `<rect x="0" y="${CARD_H - 130}" width="${CARD_W}" height="130" fill="url(#${uid}e)"/>${body}`;
}

// Emblem: loderndes Feuerzeichen im Ring – ersetzt den Drachen (als Pfad zu
// unruhig) und passt zum Flammen-Thema.
function jokerEmblem(cx, cy, r, color, hot) {
  // Strahlenkranz (dreht sich langsam) hinter dem Zeichen.
  const rays = Array.from({ length: 16 }).map((_, i) => {
    const a = (i * Math.PI) / 8;
    const r1 = r + 6, r2 = r + (i % 2 ? 14 : 24);
    return `<line x1="${(Math.cos(a) * r1).toFixed(1)}" y1="${(Math.sin(a) * r1).toFixed(1)}"
      x2="${(Math.cos(a) * r2).toFixed(1)}" y2="${(Math.sin(a) * r2).toFixed(1)}"
      stroke="${color}" stroke-width="${i % 2 ? 1 : 2}" opacity="${i % 2 ? 0.25 : 0.45}"/>`;
  }).join("");
  return `<g transform="translate(${cx} ${cy})">
    <g opacity="0.9">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360"
        dur="26s" repeatCount="indefinite"/>
      ${rays}
    </g>
    <circle r="${r + 2}" fill="${color}" opacity="0.10"/>
    <animate attributeName="opacity" values="0.8;1;0.8" dur="3s" repeatCount="indefinite"/>
    <circle r="${r}" fill="none" stroke="${color}" stroke-width="2" opacity="0.55"/>
    <circle r="${r - 7}" fill="none" stroke="${color}" stroke-width="1" opacity="0.32"/>
    <g transform="translate(0 ${r * 0.66}) scale(${r / 40})">
      <path d="M0,0 C-30,-12 -34,-40 -12,-58 C-16,-42 -6,-36 0,-44 C6,-52 4,-64 -2,-74
               C24,-60 34,-30 20,-8 C14,2 6,4 0,0 Z" fill="${color}" opacity="0.6"/>
      <path d="M0,-2 C-16,-10 -18,-28 -5,-40 C-7,-30 -1,-26 2,-31 C6,-37 5,-44 1,-50
               C17,-40 22,-22 13,-9 C9,-3 4,-1 0,-2 Z" fill="${hot}" opacity="0.9"/>
    </g>
  </g>`;
}

// Joker MIT Porträt: Bild bleibt groß sichtbar, Flammen/Funkeln/Emblem obendrauf.
function jokerPortrait(card, image) {
  const warm = card.jokerColor === "red";
  const glow = warm ? "#ffb03a" : "#5fe0a8";
  const hot = warm ? "#fff0b8" : "#dfffe9";
  const deep = warm ? "#4a1408" : "#07231a";
  const uid = "jp" + (++_cidSeq);
  const ix = 16, iy = 16, iw = CARD_W - 32, ih = CARD_H - 32;
  return `
    <defs>
      <clipPath id="${uid}c"><rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="12"/></clipPath>
      <radialGradient id="${uid}v" cx="50%" cy="42%" r="72%">
        <stop offset="55%" stop-color="${deep}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${deep}" stop-opacity="0.92"/>
      </radialGradient>
      <linearGradient id="${uid}g" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="${glow}"/><stop offset="50%" stop-color="#f6e7c4"/>
        <stop offset="100%" stop-color="${glow}"/>
      </linearGradient>
      <linearGradient id="${uid}e" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="${glow}" stop-opacity="0.42"/>
        <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="${deep}" stroke="url(#${uid}g)" stroke-width="4"/>
    <g clip-path="url(#${uid}c)">
      <image href="${esc(image)}" xlink:href="${esc(image)}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid slice"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="url(#${uid}v)"/>
      ${flames(uid, glow, hot)}
      ${sparkles(glow, [[44, 60, 6, 0], [196, 74, 5, 0.7], [60, 250, 4.5, 1.3], [188, 236, 6, 1.9], [120, 40, 4, 2.4]])}
      ${jokerEmblem(CARD_W / 2, 104, 40, glow, hot)}
    </g>
    <g fill="none">
      <animate attributeName="opacity" values="0.6;1;0.6" dur="2.6s" repeatCount="indefinite"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="12" stroke="${glow}" stroke-width="9" opacity="0.12"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="12" stroke="${glow}" stroke-width="4.5" opacity="0.28"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="12" stroke="${hot}" stroke-width="1.6" opacity="0.95"/>
    </g>
    ${jokerCornerStar(glow, 34, 40, false)}
    ${jokerCornerStar(glow, CARD_W - 34, CARD_H - 40, true)}
    ${tierPlate(TIERS.bronze, "JOKER", glow)}`;
}

function jokerCornerStar(glow, x, y, rot) {
  const transform = rot ? `rotate(180 ${x} ${y})` : "";
  return `<g transform="${transform}">
    <rect x="${x - 17}" y="${y - 22}" width="34" height="46" rx="9" fill="rgba(8,14,12,0.72)" stroke="${glow}" stroke-width="1.4"/>
    <text x="${x}" y="${y - 2}" font-size="22" text-anchor="middle" dominant-baseline="central" fill="${glow}">★</text>
    <text x="${x}" y="${y + 15}" font-size="9" font-weight="800" letter-spacing="1" text-anchor="middle" dominant-baseline="central" fill="${glow}">JKR</text>
  </g>`;
}

// Joker OHNE Bild: dunkle Karte mit Flammen-Emblem, Flammen und Funkeln.
function jokerCard(jokerColor) {
  const warm = jokerColor === "red";
  const glow = warm ? "#ffb03a" : "#5fe0a8";
  const hot = warm ? "#fff0b8" : "#dfffe9";
  const deep = warm ? "#2a0d06" : "#0b241c";
  const label = warm ? "ROTER" : "SCHWARZER";
  const uid = "jc" + (++_cidSeq);
  return `
    <defs>
      <radialGradient id="${uid}m" cx="50%" cy="40%" r="72%">
        <stop offset="0%" stop-color="${glow}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${deep}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${uid}g" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="${glow}"/><stop offset="50%" stop-color="#f6e7c4"/>
        <stop offset="100%" stop-color="${glow}"/>
      </linearGradient>
      <linearGradient id="${uid}e" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="${glow}" stop-opacity="0.42"/>
        <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="${deep}" stroke="url(#${uid}g)" stroke-width="4"/>
    <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="12" fill="url(#${uid}m)"/>
    ${flames(uid, glow, hot)}
    ${sparkles(glow, [[46, 70, 6, 0], [194, 86, 5, 0.8], [58, 246, 5, 1.4], [186, 232, 6, 2.0], [120, 46, 4.5, 2.6]])}
    ${jokerEmblem(CARD_W / 2, 126, 52, glow, hot)}
    <g fill="none">
      <animate attributeName="opacity" values="0.55;1;0.55" dur="2.6s" repeatCount="indefinite"/>
      <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="12" stroke="${glow}" stroke-width="9" opacity="0.12"/>
      <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="12" stroke="${glow}" stroke-width="4.5" opacity="0.3"/>
      <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="12" stroke="${hot}" stroke-width="1.5" opacity="0.95"/>
    </g>
    <text x="${CARD_W / 2}" y="228" fill="#f6e7c4" font-size="28" font-weight="800" letter-spacing="5" text-anchor="middle" font-family="Georgia, serif">JOKER</text>
    <text x="${CARD_W / 2}" y="252" fill="${glow}" font-size="13" font-weight="700" letter-spacing="3" text-anchor="middle">${label}</text>
    ${jokerCornerStar(glow, 34, 40, false)}
    ${jokerCornerStar(glow, CARD_W - 34, CARD_H - 40, true)}`;
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
    return svgWrap(image ? jokerPortrait(card, image) : jokerCard(card.jokerColor), "is-joker");
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

window.Cards = { renderCardSVG, renderBackSVG };
