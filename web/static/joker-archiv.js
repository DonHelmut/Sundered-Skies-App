// Geparkte Joker-Stile – NICHT Teil des Spiels.
//
// Diese Stile wurden ausprobiert und fuers Erste aussortiert (September 2026:
// ins Spiel kamen Riss, Siegel, Glyphen und Orbit). Sie bleiben hier, damit man
// sie spaeter zurueckholen kann. index.html und tv.html laden diese Datei nicht –
// die Handys laden also nichts davon mit, und im Menue tauchen sie nicht auf.
// Nur die Entwickler-Musterseite (_lab.html) laedt sie zum Anschauen.
//
// Zurueckholen: den Abschnitt nach cards.js verschieben und den Namen in
// JOKER_STILE, JOKER_NAMEN und JOKER_BAU eintragen.
//
// Nutzt die gemeinsamen Bausteine aus cards.js (jokerMotiv, jokerTitel,
// jokerRahmen, jokerStern, jokerFunken, jokerSplitterFlug, rissStrahlen,
// rissRisse, rissAussen, siegelTeile, SIEGEL_RUNEN, gem) – muss also NACH
// cards.js geladen werden.

// --- Splitter – die Karte zerbirst ---------------------------------
// Die Karte ist in Scherben zerbrochen, durch die Fugen leuchtet der Glow. Das
// Motiv liegt EINMAL in den defs und wird per <use> in jede Scherbe gesetzt –
// das Bild wird nicht neunmal geladen. Die grosse Mittelscherbe umschliesst den
// oberen Bildbereich (dort sitzt meist das Gesicht) und bleibt ruhig; die
// aeusseren Scherben atmen langsam nach aussen, ueber den Kartenrand hinaus.
const SPLITTER_PUNKTE = {
  TL: [4, 4], T1: [70, 4], T2: [168, 4], TR: [236, 4],
  R1: [236, 110], R2: [236, 228], BR: [236, 332], B1: [160, 332], B2: [70, 332], BL: [4, 332],
  L1: [4, 210], L2: [4, 96],
  A: [58, 40], B: [186, 34], C: [206, 150], D: [176, 238], E: [96, 250], F: [34, 160],
};
// [Eckpunkte, Ausschlag nach aussen]. Die Scherben teilen sich ihre Kanten
// lueckenlos – ohne Ausschlag ergaeben sie wieder die ganze Karte.
const SPLITTER = [
  ["A B C D E F", 0],
  ["TL T1 A L2", 9], ["T1 T2 B A", 5], ["T2 TR R1 C B", 7], ["R1 R2 D C", 5],
  ["R2 BR B1 D", 10], ["B1 B2 E D", 5], ["B2 BL L1 F E", 8], ["L1 L2 A F", 5],
];

// Bruchkante zwischen zwei Eckpunkten, leicht gezackt. Das Zackenmuster haengt
// NUR vom Punktpaar ab (nicht von der Scherbe): beide Nachbarscherben bekommen
// exakt dieselbe Kante – sonst klaffen Luecken oder Scherben ueberlappen.
// Kanten entlang des Kartenrands bleiben gerade.
function splitterKante(k1, k2) {
  const a = SPLITTER_PUNKTE[k1], b = SPLITTER_PUNKTE[k2];
  const aufRand = ([x, y]) => x === 4 || x === 236 || y === 4 || y === 332;
  if (aufRand(a) && aufRand(b) && (a[0] === b[0] || a[1] === b[1])) return [];
  const vorwaerts = k1 < k2;
  const [p0, p1] = vorwaerts ? [a, b] : [b, a];
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const stuecke = Math.max(2, Math.round(len / 20));
  let saat = [...(vorwaerts ? k1 + k2 : k2 + k1)].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 233280, 7);
  const zufall = () => { saat = (saat * 9301 + 49297) % 233280; return saat / 233280 - 0.5; };
  const punkte = [];
  for (let i = 1; i < stuecke; i++) {
    const t = i / stuecke, aus = zufall() * 10;
    punkte.push([p0[0] + dx * t + nx * aus, p0[1] + dy * t + ny * aus]);
  }
  return vorwaerts ? punkte : punkte.reverse();
}

function jokerSplitter(uid, p, image) {
  const scherben = SPLITTER.map(([ecken, weit], i) => {
    const namen = ecken.split(" ");
    const pts = namen.map((k) => SPLITTER_PUNKTE[k]);
    const umriss = namen.flatMap((k, j) => [SPLITTER_PUNKTE[k], ...splitterKante(k, namen[(j + 1) % namen.length])]);
    const poly = umriss.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
    const my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
    const len = Math.hypot(mx - 120, my - 168) || 1;
    const dx = ((mx - 120) / len) * weit, dy = ((my - 168) / len) * weit;
    const atmen = weit
      ? `<animateTransform attributeName="transform" type="translate"
          values="${(dx * 0.3).toFixed(1)} ${(dy * 0.3).toFixed(1)};${dx.toFixed(1)} ${dy.toFixed(1)};${(dx * 0.3).toFixed(1)} ${(dy * 0.3).toFixed(1)}"
          dur="${(5 + i * 0.7).toFixed(1)}s" repeatCount="indefinite"/>`
      : "";
    return `<clipPath id="${uid}s${i}"><polygon points="${poly}"/></clipPath>
      <g>${atmen}
        <use href="#${uid}motiv" xlink:href="#${uid}motiv" clip-path="url(#${uid}s${i})"/>
        <polygon points="${poly}" fill="none" stroke="${p.glow}" stroke-width="2.2" opacity="0.45" stroke-linejoin="round"/>
        <polygon points="${poly}" fill="none" stroke="${p.hot}" stroke-width="0.7" opacity="0.85" stroke-linejoin="round"/>
      </g>`;
  }).join("");
  const flug = (...a) => jokerSplitterFlug(p, ...a);
  return `
    <defs><g id="${uid}motiv">
      ${jokerMotiv(uid, p, image)}
      <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    </g></defs>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="url(#${uid}fuge)">
      <animate attributeName="opacity" values="0.75;1;0.75" dur="1.8s" repeatCount="indefinite"/>
    </rect>
    ${scherben}
    ${jokerFunken(p, [[58, 44, 90, 1.8, 3.2, 0], [204, 150, 110, 1.6, 3.8, 1.2], [96, 252, 120, 2, 3.4, 0.6], [34, 162, 80, 1.5, 3, 2]])}
    ${jokerTitel(uid, p)}
    <g class="joker-aussen">
      ${flug(8, 8, -26, -22, 2.2, 0)}${flug(20, 4, -8, -30, 2.6, 1)}${flug(4, 30, -30, -6, 2.4, 1.7)}
      ${flug(230, 326, 26, 22, 2.3, 0.5)}${flug(218, 330, 8, 30, 2.7, 1.4)}${flug(234, 300, 30, 4, 2.1, 2.1)}
      ${flug(4, 290, -28, 10, 2.5, 0.9)}${flug(234, 60, 26, -16, 2.4, 1.9)}
    </g>
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}`;
}

// --- Aura – legendäre Karte ----------------------------------------
function jokerAura(uid, p, image) {
  // Strahlenkranz hinter der Karte: lange schmale Rauten, oben/unten laenger
  // als seitlich (dort ist am Handy wenig Platz).
  const strahl = (winkel, len, w, op) => {
    const a = (winkel * Math.PI) / 180, cx = 120, cy = 168;
    const ex = cx + Math.sin(a) * len, ey = cy - Math.cos(a) * len;
    const mx = cx + Math.sin(a) * len * 0.35, my = cy - Math.cos(a) * len * 0.35;
    const px = Math.cos(a) * w, py = Math.sin(a) * w;
    return `<path d="M${cx},${cy} L${(mx + px).toFixed(1)},${(my + py).toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)} L${(mx - px).toFixed(1)},${(my - py).toFixed(1)} Z" opacity="${op}"/>`;
  };
  const kranz = Array.from({ length: 16 }, (_, i) => {
    const winkel = i * 22.5;
    const senkrecht = Math.abs(Math.cos((winkel * Math.PI) / 180));
    return strahl(winkel, 150 + senkrecht * 62 + (i % 2 ? -14 : 0), i % 2 ? 5 : 9, i % 2 ? 0.45 : 0.75);
  }).join("");
  const bahn = "M120,-18 A142,186 0 1 1 119.9,-18 Z";
  const umlaeufer = (del) => `<g><animateMotion dur="9s" begin="${del}s" repeatCount="indefinite" path="${bahn}"/>
      <circle r="7" fill="${p.glow}" opacity="0.35"/>
      <path d="M0,-6 L1.6,-1.6 L6,0 L1.6,1.6 L0,6 L-1.6,1.6 L-6,0 L-1.6,-1.6 Z" fill="${p.hot}"/></g>`;
  const band = `M-16,284 L20,284 L20,276 L220,276 L220,284 L256,284 L244,300 L256,316 L220,316 L220,318 L20,318 L20,316 L-16,316 L-4,300 Z`;
  return `
    <g class="joker-aussen">
      <ellipse cx="120" cy="168" rx="160" ry="206" fill="url(#${uid}kranz)">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite"/>
      </ellipse>
      <g fill="${p.glow}">
        <animateTransform attributeName="transform" type="rotate" values="-6 120 168;6 120 168;-6 120 168" dur="12s" repeatCount="indefinite"/>
        ${kranz}
      </g>
    </g>
    ${jokerMotiv(uid, p, image)}
    <g clip-path="url(#${uid}k)">
      <rect x="-240" y="4" width="240" height="${CARD_H - 8}" fill="url(#${uid}holo)">
        <animateTransform attributeName="transform" type="translate" values="0 0;480 0" dur="3.8s" repeatCount="indefinite"/>
      </rect>
    </g>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)" opacity="0.8"/>
    ${jokerRahmen(uid, p, 5)}
    ${[[16, 16], [224, 16], [16, 320], [224, 320]].map(([x, y]) => gem(x, y, { lt: p.hot, dk: p.glow }, 8)).join("")}
    ${jokerFunken(p, [[60, 250, 120, 1.6, 3.8, 0.4], [120, 262, 140, 2, 4.2, 1.6], [180, 248, 110, 1.5, 3.5, 2.4]])}
    <g class="joker-aussen">
      ${umlaeufer(0)}${umlaeufer(3)}${umlaeufer(6)}
      <path d="${band}" fill="${p.deep}" stroke="${p.glow}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M20,284 L20,316 M220,284 L220,316" stroke="${p.glow}" stroke-width="1" opacity="0.6"/>
      <text x="120" y="304" font-size="25" font-weight="800" letter-spacing="7" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, 'Times New Roman', serif" fill="${p.hot}">JOKER</text>
      <circle cx="120" cy="6" r="24" fill="${p.glow}" opacity="0.3">
        <animate attributeName="r" values="20;30;20" dur="2.2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.45;0.1;0.45" dur="2.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="120" cy="6" r="19" fill="${p.deep}" stroke="url(#${uid}rahmen)" stroke-width="3"/>
      <text x="120" y="7" font-size="22" text-anchor="middle" dominant-baseline="central" fill="${p.hot}">★</text>
    </g>`;
}

// --- Blitz – der Glow entlaedt sich -------------------------------
// Drei Entladungen springen NACHEINANDER ueber den Rahmen hinaus, und bei jeder
// leuchtet die Karte kurz auf. Die Form wechselt nur einmal pro Entladung –
// ein Umspringen mehrmals pro Sekunde sah grisselig aus, ebenso duenne,
// spitz geknickte Linien mit Seitenaesten.
function blitzPfad(x1, y1, x2, y2, bauch, saat) {
  let s = saat;
  const zufall = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  let d = `M${x1},${y1}`;
  for (let i = 1; i < 6; i++) {
    const t = i / 6, aus = bauch * 4 * t * (1 - t) + zufall() * 16;
    d += ` L${(x1 + dx * t + nx * aus).toFixed(1)},${(y1 + dy * t + ny * aus).toFixed(1)}`;
  }
  return d + ` L${x2},${y2}`;
}

// [x1, y1, x2, y2, Bauch (Vorzeichen = nach aussen), Start]
const BLITZE = [
  [4, 36, 4, 158, 34, 0],
  [236, 176, 236, 298, -34, 1.2],
  [148, 4, 226, 4, -30, 2.4],
];
const BLITZ_TAKT = 3.6;   // alle 3.6 s feuert jede Entladung einmal

function jokerBlitz(uid, p, image) {
  const huelle = (start, werte) => `<animate attributeName="opacity" values="${werte}"
      keyTimes="0;0.02;0.05;0.08;0.2;1" dur="${BLITZ_TAKT}s" begin="${start}s" repeatCount="indefinite"/>`;
  const entladungen = BLITZE.map(([x1, y1, x2, y2, bauch, start], i) => {
    const formen = [0, 1, 2].map((k) => blitzPfad(x1, y1, x2, y2, bauch * (0.85 + k * 0.12), 97 + i * 31 + k * 7));
    const neueForm = `<animate attributeName="d" values="${formen.join(";")}" dur="${BLITZ_TAKT * 3}s" begin="${start}s" repeatCount="indefinite" calcMode="discrete"/>`;
    const lage = (farbe, w, op) => `<path d="${formen[0]}" stroke="${farbe}" stroke-width="${w}" opacity="${op}">${neueForm}</path>`;
    const hof = (x, y) => `<circle cx="${x}" cy="${y}" r="16" fill="url(#${uid}kranz)"/>`;
    return `<g opacity="0" fill="none" stroke-linecap="round" stroke-linejoin="round">
      ${huelle(start, "0;1;0.3;0.95;0;0")}
      ${lage(p.glow, 12, 0.14)}${lage(p.glow, 4, 0.55)}${lage(p.hot, 1.6, 1)}
      ${hof(x1, y1)}${hof(x2, y2)}
    </g>`;
  }).join("");
  // Die Karte leuchtet bei jeder Entladung mit auf.
  const aufleuchten = BLITZE.map(([, , , , , start]) =>
    `<rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="${p.hot}" opacity="0" clip-path="url(#${uid}k)">
      ${huelle(start, "0;0.24;0.07;0.2;0;0")}</rect>`).join("");
  return `
    ${jokerMotiv(uid, p, image)}
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    ${aufleuchten}
    ${jokerFunken(p, [[40, 300, 110, 1.8, 2.6, 0], [120, 318, 140, 1.5, 3.1, 1.1], [196, 306, 120, 2, 2.8, 0.5]])}
    ${jokerTitel(uid, p)}
    ${jokerRahmen(uid, p)}
    <g class="joker-aussen">${entladungen}</g>
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}`;
}

// --- Zerrissen – zwei Ecken sind herausgerissen ----------------------------
// Zwei grosse Stuecke (oben rechts, unten links) sind aus der Karte gerissen und
// schweben nach aussen weg. Die Risse laufen am Gesicht (oben Mitte) vorbei.
// Damit es nach GERISSENEM Papier aussieht und nicht nach einem Zickzack-Schnitt:
// fein gezackte Kante, Papierfasern, verkohlter Rand mit Glutkern, glimmende
// Fetzen. Das Motiv liegt nur einmal in den defs (<use> je Stueck).
function feinerRiss(grob, saat) {
  let s = saat;
  const zufall = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  const fein = [grob[0]];
  for (let i = 0; i < grob.length - 1; i++) {
    const [ax, ay] = grob[i], [bx, by] = grob[i + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    const stuecke = Math.max(3, Math.round(len / 5));
    for (let k = 1; k < stuecke; k++) {
      const t = k / stuecke, aus = zufall() * 5;
      fein.push([+(ax + dx * t + nx * aus).toFixed(1), +(ay + dy * t + ny * aus).toFixed(1)]);
    }
    fein.push([bx, by]);
  }
  return fein;
}
const RISS_OBEN = feinerRiss([[130, 4], [146, 20], [152, 44], [176, 64], [184, 96], [206, 112], [214, 138], [236, 150]], 11);
const RISS_UNTEN = feinerRiss([[4, 210], [24, 222], [34, 248], [58, 258], [66, 286], [90, 300], [98, 322], [110, 332]], 23);

// Papierfasern: kurze Haerchen entlang der Kante. `seite` (+1/-1) bestimmt, zu
// welcher Seite sie abstehen – immer in den Spalt hinein, weg vom eigenen Stueck.
function rissFasern(pts, farbe, saat, seite) {
  let s = saat;
  const zufall = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  let d = "";
  for (let i = 1; i < pts.length - 1; i += 2) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i + 1], [x, y] = pts[i];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const lang = 2 + zufall() * 5, schraeg = (zufall() - 0.5) * 4;
    d += `M${x},${y} l${((-dy / len) * seite * lang + (dx / len) * schraeg).toFixed(1)},${((dx / len) * seite * lang + (dy / len) * schraeg).toFixed(1)} `;
  }
  return `<path d="${d}" fill="none" stroke="${farbe}" stroke-width="0.7" opacity="0.75" stroke-linecap="round"/>`;
}

// Glimmender Papierfetzen: loest sich, taumelt und verglueht ausserhalb.
function jokerFetzen(p, x, y, dx, dy, dur, del) {
  return `<g opacity="0">
      <animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy}" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.6;1" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
      <path d="M${x},${y} l5,-2 l3,4 l-2,5 l-6,-1 Z" fill="${p.deep}" stroke="${p.glow}" stroke-width="0.9">
        <animateTransform attributeName="transform" type="rotate" values="0 ${x + 2} ${y + 2};220 ${x + 2} ${y + 2}" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/>
      </path>
    </g>`;
}

function jokerZerrissen(uid, p, image) {
  const zug = (pts) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  const linie = (pts) => `M${pts.map(([x, y]) => `${x},${y}`).join(" L")}`;
  const hauptstueck = [[4, 4], ...RISS_OBEN, [236, 332], ...RISS_UNTEN.slice().reverse()];
  const stueckOben = [...RISS_OBEN, [236, 4]];
  const stueckUnten = [...RISS_UNTEN, [4, 332]];
  // Kante: Gluthof, Fasern, verkohlter Rand, heisser Kern.
  const kante = (pts, seite, saat) => `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${linie(pts)}" stroke="${p.glow}" stroke-width="5" opacity="0.3"/>
      ${rissFasern(pts, p.hot, saat, seite)}
      <path d="${linie(pts)}" stroke="${p.deep}" stroke-width="2.4" opacity="0.75"/>
      <path d="${linie(pts)}" stroke="${p.hot}" stroke-width="0.8" opacity="0.95"/>
    </g>`;
  const stueck = (id, pts, kanten) => `<clipPath id="${uid}${id}"><polygon points="${zug(pts)}"/></clipPath>
      <use href="#${uid}motiv" xlink:href="#${uid}motiv" clip-path="url(#${uid}${id})"/>
      <polygon points="${zug(pts)}" fill="none" stroke="url(#${uid}rahmen)" stroke-width="2.2" stroke-linejoin="round"/>
      ${kanten}`;
  // Schweben: nach aussen wegdriften und leicht drehen, dann ein Stueck zurueck.
  const schweben = (dx, dy, grad, cx, cy, dur) => `
      <animateTransform attributeName="transform" type="translate" values="${dx * 0.5} ${dy * 0.5};${dx} ${dy};${dx * 0.5} ${dy * 0.5}" dur="${dur}s" repeatCount="indefinite"/>
      <g><animateTransform attributeName="transform" type="rotate" values="${grad * 0.5} ${cx} ${cy};${grad} ${cx} ${cy};${grad * 0.5} ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite"/>`;
  const fetzen = (...a) => jokerFetzen(p, ...a);
  return `
    <defs><g id="${uid}motiv">
      ${jokerMotiv(uid, p, image)}
      <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    </g></defs>
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="18" fill="url(#${uid}fuge)">
      <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite"/>
    </rect>
    ${stueck("haupt", hauptstueck, kante(RISS_OBEN, -1, 5) + kante(RISS_UNTEN, 1, 9))}
    <g>${schweben(20, -16, 7, 196, 60, 5.5)}${stueck("oben", stueckOben, kante(RISS_OBEN, 1, 13))}</g></g>
    <g>${schweben(-18, 16, -6, 40, 290, 6.2)}${stueck("unten", stueckUnten, kante(RISS_UNTEN, -1, 17))}</g></g>
    ${jokerFunken(p, [[176, 64, 70, 1.6, 2.4, 0], [206, 112, 80, 1.8, 2.8, 0.9], [34, 248, 70, 1.5, 2.6, 0.4], [90, 300, 60, 1.7, 3, 1.5],
      [152, 44, 60, 1.4, 2.2, 1.8], [58, 258, 80, 1.6, 3.2, 2.3]])}
    <g class="joker-aussen">
      ${fetzen(176, 64, 26, -22, 3, 0)}${fetzen(206, 112, 30, -10, 3.4, 1.1)}${fetzen(152, 44, 14, -30, 2.8, 2)}
      ${fetzen(34, 248, -28, 14, 3.2, 0.6)}${fetzen(66, 286, -22, 26, 2.9, 1.6)}${fetzen(90, 300, -8, 32, 3.5, 2.4)}
    </g>
    ${jokerTitel(uid, p)}
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}`;
}

// --- Ritual – Siegel und Riss zusammen --------------------------------------
// Die Karte steht im Runenkreis, und der Glow bricht dabei durch sie hindurch:
// Lichtfaecher, Risse und Splitter vom „Riss" ueber dem Kreis vom „Siegel".
function jokerRitual(uid, p, image) {
  const s = siegelTeile(uid, p);
  return `
    ${s.defs}
    ${s.hinten}
    ${jokerMotiv(uid, p, image)}
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    ${s.boden}
    ${rissStrahlen(uid)}
    ${jokerFunken(p, [[60, 320, 130, 1.6, 3.3, 0.4], [124, 326, 170, 1.9, 4.1, 3.1], [184, 306, 125, 2.2, 3.4, 1.7]])}
    ${jokerTitel(uid, p)}
    ${jokerRahmen(uid, p)}
    ${rissRisse(p)}
    ${s.vorne}
    ${rissAussen(uid, p)}
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}`;
}

// --- Entladung – ein grosser Blitz springt um die Karte ----------------------
// Ein einziger grosser Blitz laeuft aussen um die Karte herum von einer Ecke zur
// gegenueberliegenden – abwechselnd oben-links herum und unten-rechts herum –
// und die Karte leuchtet dabei kraeftig auf. Wenige grosse Entladungen wirken
// mehr nach Blitz als viele kleine.
function entladungPfad(fuehrung, saat) {
  let s = saat;
  const zufall = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  const pts = [fuehrung[0]];
  for (let i = 0; i < fuehrung.length - 1; i++) {
    const [ax, ay] = fuehrung[i], [bx, by] = fuehrung[i + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    const stuecke = Math.max(2, Math.round(len / 18));
    for (let k = 1; k < stuecke; k++) {
      const t = k / stuecke, aus = zufall() * 16;
      pts.push([ax + dx * t + nx * aus, ay + dy * t + ny * aus]);
    }
    pts.push([bx, by]);
  }
  // Zwei kurze Seitenaeste, weg von der Kartenmitte.
  const ast = (i) => {
    const [x, y] = pts[i], wx = x - 120, wy = y - 168, wl = Math.hypot(wx, wy) || 1;
    const l = 10 + (zufall() + 0.5) * 8;
    return `M${x.toFixed(1)},${y.toFixed(1)} L${(x + (wx / wl) * l * 0.6 + zufall() * 8).toFixed(1)},${(y + (wy / wl) * l * 0.6 + zufall() * 8).toFixed(1)}`
      + ` L${(x + (wx / wl) * l).toFixed(1)},${(y + (wy / wl) * l).toFixed(1)}`;
  };
  return {
    haupt: "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L"),
    aeste: ast(Math.floor(pts.length * 0.35)) + " " + ast(Math.floor(pts.length * 0.7)),
  };
}

// Fuehrungslinien knapp ausserhalb der Karte (seitlich hoechstens ~32 hinaus).
const ENTLADUNGEN = [
  { weg: [[236, 4], [214, -22], [120, -30], [26, -22], [-26, 30], [-32, 168], [-26, 300], [4, 332]], start: 0 },
  { weg: [[4, 332], [26, 356], [120, 364], [214, 356], [262, 300], [268, 168], [262, 40], [236, 4]], start: 1.6 },
];
const ENTLADUNG_TAKT = 3.2;

function jokerEntladung(uid, p, image) {
  const huelle = (start, werte) => `<animate attributeName="opacity" values="${werte}"
      keyTimes="0;0.02;0.05;0.08;0.26;1" dur="${ENTLADUNG_TAKT}s" begin="${start}s" repeatCount="indefinite"/>`;
  const blitze = ENTLADUNGEN.map(({ weg, start }, i) => {
    const formen = [0, 1, 2].map((k) => entladungPfad(weg, 131 + i * 37 + k * 11));
    const wechsel = (teil) => `<animate attributeName="d" values="${formen.map((f) => f[teil]).join(";")}" dur="${ENTLADUNG_TAKT * 3}s" begin="${start}s" repeatCount="indefinite" calcMode="discrete"/>`;
    const lage = (teil, farbe, w, op) => `<path d="${formen[0][teil]}" stroke="${farbe}" stroke-width="${w}" opacity="${op}">${wechsel(teil)}</path>`;
    const hof = ([x, y]) => `<circle cx="${x}" cy="${y}" r="22" fill="url(#${uid}kranz)"/>`;
    return `<g opacity="0" fill="none" stroke-linecap="round" stroke-linejoin="round">
      ${huelle(start, "0;1;0.35;1;0;0")}
      ${lage("haupt", p.glow, 14, 0.16)}${lage("haupt", p.glow, 5, 0.6)}${lage("haupt", p.hot, 2, 1)}
      ${lage("aeste", p.glow, 3, 0.5)}${lage("aeste", p.hot, 1, 1)}
      ${hof(weg[0])}${hof(weg[weg.length - 1])}
    </g>`;
  }).join("");
  const aufleuchten = ENTLADUNGEN.map(({ start }) =>
    `<rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="${p.hot}" opacity="0" clip-path="url(#${uid}k)">
      ${huelle(start, "0;0.3;0.1;0.26;0;0")}</rect>`).join("");
  return `
    ${jokerMotiv(uid, p, image)}
    <rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" fill="url(#${uid}rand)" clip-path="url(#${uid}k)"/>
    ${aufleuchten}
    ${jokerFunken(p, [[40, 300, 110, 1.8, 2.6, 0], [120, 318, 140, 1.5, 3.1, 1.1], [196, 306, 120, 2, 2.8, 0.5]])}
    ${jokerTitel(uid, p)}
    ${jokerRahmen(uid, p)}
    <g class="joker-aussen">${blitze}</g>
    ${jokerStern(p, 28, 32)}
    ${jokerStern(p, CARD_W - 26, 300)}`;
}

// Anmelden: bauen laesst sich jeder Stil (Musterseite), auswaehlbar sind sie nicht.
Object.assign(JOKER_BAU, {
  ritual: jokerRitual, zerrissen: jokerZerrissen, entladung: jokerEntladung,
  blitz: jokerBlitz, splitter: jokerSplitter, aura: jokerAura,
});
Object.assign(JOKER_NAMEN, {
  ritual: "🔮 Ritual", zerrissen: "📜 Zerrissen", entladung: "🌩️ Entladung",
  blitz: "⚡ Blitz", splitter: "🔷 Splitter", aura: "🌟 Aura",
});
window.JOKER_ARCHIV = ["ritual", "zerrissen", "entladung", "blitz", "splitter", "aura"];
