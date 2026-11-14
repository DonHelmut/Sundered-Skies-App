// Einheitliche Linien-Symbole statt bunter Emoji (Kalle, 14.11.2026, Vorschlag 2
// der Studio-Runde): Emoji sehen je nach Handy/Windows anders aus, mal bunt,
// mal schwarz-weiß, mal gar nicht – das wirkte zusammengewürfelt. Statt jede
// Stelle im Code umzuschreiben, tauscht symboleEinsetzen() ein Emoji direkt am
// Anfang eines Tag-Inhalts („<button>⚔ Kampf") gegen ein SVG. Läuft beim
// Zeichnen (domAbgleichen, el, Dialoge) – ein Regex-Durchlauf, kein Beobachter,
// der bei jeder Änderung den DOM absucht (am Handy spürbar).
// Formen: Lucide (https://lucide.dev), ISC-Lizenz, Copyright Lucide Contributors.

const SYMBOL_PFADE = {
  "ban": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M4.929 4.929 19.07 19.071\"/>",
  "book-open": "<path d=\"M12 5v16\"/> <path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\"/>",
  "brush": "<path d=\"m11 10 3 3\"/> <path d=\"M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z\"/> <path d=\"M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031\"/>",
  "camera": "<path d=\"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z\"/> <circle cx=\"12\" cy=\"13\" r=\"3\"/>",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
  "clipboard-list": "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\"/> <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/> <path d=\"M12 11h4\"/> <path d=\"M12 16h4\"/> <path d=\"M8 11h.01\"/> <path d=\"M8 16h.01\"/>",
  "crosshair": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <line x1=\"22\" x2=\"18\" y1=\"12\" y2=\"12\"/> <line x1=\"6\" x2=\"2\" y1=\"12\" y2=\"12\"/> <line x1=\"12\" x2=\"12\" y1=\"6\" y2=\"2\"/> <line x1=\"12\" x2=\"12\" y1=\"22\" y2=\"18\"/>",
  "dices": "<rect width=\"12\" height=\"12\" x=\"2\" y=\"10\" rx=\"2\" ry=\"2\"/> <path d=\"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6\"/> <path d=\"M6 18h.01\"/> <path d=\"M10 14h.01\"/> <path d=\"M15 6h.01\"/> <path d=\"M18 9h.01\"/>",
  "download": "<path d=\"M12 15V3\"/> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/> <path d=\"m7 10 5 5 5-5\"/>",
  "flag": "<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\"/>",
  "footprints": "<path d=\"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z\"/> <path d=\"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z\"/> <path d=\"M16 17h4\"/> <path d=\"M4 13h4\"/>",
  "hand": "<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\"/> <path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\"/> <path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\"/> <path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\"/>",
  "heart-plus": "<path d=\"m14.479 19.374-.971.939a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5a5.2 5.2 0 0 1-.219 1.49\"/> <path d=\"M15 15h6\"/> <path d=\"M18 12v6\"/>",
  "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/> <circle cx=\"9\" cy=\"9\" r=\"2\"/> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"/>",
  "keyboard": "<path d=\"M10 8h.01\"/> <path d=\"M12 12h.01\"/> <path d=\"M14 8h.01\"/> <path d=\"M16 12h.01\"/> <path d=\"M18 8h.01\"/> <path d=\"M6 8h.01\"/> <path d=\"M7 16h10\"/> <path d=\"M8 12h.01\"/> <rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>",
  "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"/> <path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\"/> <path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\"/>",
  "life-buoy": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"m4.93 4.93 4.24 4.24\"/> <path d=\"m14.83 9.17 4.24-4.24\"/> <path d=\"m14.83 14.83 4.24 4.24\"/> <path d=\"m9.17 14.83-4.24 4.24\"/> <circle cx=\"12\" cy=\"12\" r=\"4\"/>",
  "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>",
  "log-in": "<path d=\"m10 17 5-5-5-5\"/> <path d=\"M15 12H3\"/> <path d=\"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4\"/>",
  "mail": "<path d=\"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7\"/> <rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/>",
  "menu": "<path d=\"M4 5h16\"/> <path d=\"M4 12h16\"/> <path d=\"M4 19h16\"/>",
  "message-circle": "<path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\"/>",
  "mic": "<path d=\"M12 19v3\"/> <path d=\"M19 10v2a7 7 0 0 1-14 0v-2\"/> <rect x=\"9\" y=\"2\" width=\"6\" height=\"13\" rx=\"3\"/>",
  "moon": "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\"/>",
  "notebook-pen": "<path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4\"/> <path d=\"M2 6h4\"/> <path d=\"M2 10h4\"/> <path d=\"M2 14h4\"/> <path d=\"M2 18h4\"/> <path d=\"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z\"/>",
  "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/> <path d=\"m15 5 4 4\"/>",
  "pin": "<path d=\"M12 17v5\"/> <path d=\"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z\"/>",
  "plus": "<path d=\"M5 12h14\"/> <path d=\"M12 5v14\"/>",
  "pointer": "<path d=\"M22 14a8 8 0 0 1-8 8\"/> <path d=\"M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2\"/> <path d=\"M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1\"/> <path d=\"M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10\"/> <path d=\"M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\"/>",
  "qr-code": "<rect width=\"5\" height=\"5\" x=\"3\" y=\"3\" rx=\"1\"/> <rect width=\"5\" height=\"5\" x=\"16\" y=\"3\" rx=\"1\"/> <rect width=\"5\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\"/> <path d=\"M21 16h-3a2 2 0 0 0-2 2v3\"/> <path d=\"M21 21v.01\"/> <path d=\"M12 7v3a2 2 0 0 1-2 2H7\"/> <path d=\"M3 12h.01\"/> <path d=\"M12 3h.01\"/> <path d=\"M12 16v.01\"/> <path d=\"M16 12h1\"/> <path d=\"M21 12v.01\"/> <path d=\"M12 21v-1\"/>",
  "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/> <path d=\"M3 3v5h5\"/>",
  "scan": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\"/> <path d=\"M17 3h2a2 2 0 0 1 2 2v2\"/> <path d=\"M21 17v2a2 2 0 0 1-2 2h-2\"/> <path d=\"M7 21H5a2 2 0 0 1-2-2v-2\"/>",
  "scroll-text": "<path d=\"M15 12h-5\"/> <path d=\"M15 8h-5\"/> <path d=\"M19 17V5a2 2 0 0 0-2-2H4\"/> <path d=\"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3\"/>",
  "search": "<path d=\"m21 21-4.34-4.34\"/> <circle cx=\"11\" cy=\"11\" r=\"8\"/>",
  "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"/> <circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "skip-forward": "<path d=\"M21 4v16\"/> <path d=\"M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z\"/>",
  "sliders-horizontal": "<path d=\"M10 5H3\"/> <path d=\"M12 19H3\"/> <path d=\"M14 3v4\"/> <path d=\"M16 17v4\"/> <path d=\"M21 12h-9\"/> <path d=\"M21 19h-5\"/> <path d=\"M21 5h-7\"/> <path d=\"M8 10v4\"/> <path d=\"M8 12H3\"/>",
  "swords": "<path d=\"m13 19 6-6\"/> <path d=\"M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5\"/> <path d=\"m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586\"/> <path d=\"m16 16 4 4\"/> <path d=\"m19 21 2-2\"/> <path d=\"m5 14 4 4\"/> <path d=\"m5 21-2-2\"/> <path d=\"M7.5 16.5 4 20\"/>",
  "target": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <circle cx=\"12\" cy=\"12\" r=\"6\"/> <circle cx=\"12\" cy=\"12\" r=\"2\"/>",
  "trash-2": "<path d=\"M10 11v6\"/> <path d=\"M14 11v6\"/> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/> <path d=\"M3 6h18\"/> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>",
  "tv": "<path d=\"m17 2-5 5-5-5\"/> <rect width=\"20\" height=\"15\" x=\"2\" y=\"7\" rx=\"2\"/>",
  "undo-2": "<path d=\"M9 14 4 9l5-5\"/> <path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\"/>",
  "upload": "<path d=\"M12 3v12\"/> <path d=\"m17 8-5-5-5 5\"/> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/>",
  "user-plus": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/> <circle cx=\"9\" cy=\"7\" r=\"4\"/> <line x1=\"19\" x2=\"19\" y1=\"8\" y2=\"14\"/> <line x1=\"22\" x2=\"16\" y1=\"11\" y2=\"11\"/>",
  "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/> <path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/> <path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/> <circle cx=\"9\" cy=\"7\" r=\"4\"/>",
  "wifi": "<path d=\"M12 20h.01\"/> <path d=\"M2 8.82a15 15 0 0 1 20 0\"/> <path d=\"M5 12.859a10 10 0 0 1 14 0\"/> <path d=\"M8.5 16.429a5 5 0 0 1 7 0\"/>",
};
const SYMBOL_ZU = {"🂠": "layers", "⚔": "swords", "📜": "scroll-text", "📝": "notebook-pen", "✉": "mail", "🎯": "crosshair", "🩹": "heart-plus", "🏁": "flag", "☰": "menu", "▣": "scan", "▤": "scan", "⚙": "settings", "🎙": "mic", "📖": "book-open", "🎛": "sliders-horizontal", "📺": "tv", "💾": "download", "⤵": "upload", "🛟": "life-buoy", "⟲": "rotate-ccw", "🧹": "brush", "⌨": "keyboard", "✋": "hand", "👆": "pointer", "🚫": "ban", "👣": "footprints", "↶": "undo-2", "⏭": "skip-forward", "➕": "plus", "📶": "wifi", "🃏": "layers", "🏹": "target", "👥": "users", "🌙": "moon", "📷": "camera", "📌": "pin", "🗑": "trash-2", "✏": "pencil", "🔍": "search", "💬": "message-circle", "📋": "clipboard-list", "🔒": "lock", "🖼": "image", "🎲": "dices"};

function symbolSvg(name) {
  const p = SYMBOL_PFADE[name];
  return p ? `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>` : "";
}

// Nur direkt hinter dem öffnenden Tag ersetzen – so bleiben Emoji mitten im
// Text (Notizen, Nachrichten der Spieler) und in Attributen (title="…") stehen.
// Textarea/Input haben keinen solchen Inhalt-Anfang, der hier passt: <textarea>
// ist ausgenommen, sonst stünde SVG-Quelltext im Eingabefeld.
const SYMBOL_RE = new RegExp(
  "(<(?!textarea|option|title)[a-z][a-z0-9]*\\b[^<>]*>)(\\s*)(" +
  Object.keys(SYMBOL_ZU).sort((a, b) => b.length - a.length).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
  ")\uFE0F?", "g");
// Ausnahme Notizen: dort wählen die Spieler ihre Themen-Emoji selbst
// („📜 Aufträge", „💎 Seelensteine") – ein Teil davon als Linie, der Rest bunt,
// sähe kaputt aus. Themen-Chips/-Reiter und Knöpfe mit data-emoji bleiben roh.
const SYMBOL_ROH = /\bnotiz-(chip|reiter)|data-emoji/;
function symboleEinsetzen(html) {
  if (typeof html !== "string" || !html) return html;
  return html.replace(SYMBOL_RE, (ganz, tag, leer, emo) =>
    SYMBOL_ROH.test(tag) ? ganz : tag + leer + symbolSvg(SYMBOL_ZU[emo]));
}
