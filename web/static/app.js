// Client-Logik für SL- und Spieler-Ansicht – Kern: App-Zustand, Hilfen,
// Aufdeck-Stile, Signale. Rolle kommt vom Server (Laptop/Loopback = SL, sonst Spieler).
//
// Bis 1.5.6 war alles in dieser einen Datei (5 300 Zeilen). Jetzt aufgeteilt,
// damit man schneller findet und zwei PCs seltener in derselben Datei kollidieren:
//   app.js → verbindung.js → dialoge.js → tisch.js → render.js → sl.js →
//   bogen.js → spieler.js → ereignisse.js → aktionen.js → start.js
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich (kein Build).
// Reihenfolge in index.html zählt: Code, der beim LADEN läuft, darf nur auf
// Dinge aus früheren Dateien zugreifen; Aufrufe in Funktionen/Handlern sind egal.

const App = {
  ws: null,
  lastRecv: 0,       // Zeitpunkt der letzten Server-Nachricht (für den Heartbeat)
  wentOfflineAt: 0,  // wann die Verbindung abriss (für die Ausfall-Meldung)
  warteschlange: [], // Aktionen aus einem Aussetzer, die nachgereicht werden
  auswahl: new Set(), // SL: per Strg-Klick gesammelte Figuren (gemeinsam ziehen)
  hilfeOffen: new Set(), // SL: Panels, deren Erklärtext per ⓘ eingeblendet ist
  offeneUnter: new Set(), // aufgeklappte Unter-Klappen (details[data-merk]) - überleben das Neuzeichnen
  gruppeOffen: new Set(), // SL: aufgeklappte Gruppenkarten-Zeilen (Schlüssel = Karten-ID)
  angriffSpaeter: new Set(), // SL: Angriffs-Popups, die er auf „Später" geschoben hat (Anfrage-IDs)
  angriffZugEnde: true,   // SL: nach dem Entscheiden den Zug des Angreifers beenden?
  role: null,
  state: null,
  myPlayerId: localStorage.getItem("playerId") || null,
  myName: localStorage.getItem("playerName") || "",
  myCharacterId: localStorage.getItem("characterId") || null,
  joined: false,
  revealed: new Set(),      // welche Karten schon aufgedeckt animiert wurden
  seenDealt: new Set(),     // versiegelte Karten, deren Einflieg-Animation schon lief
  pendingImageUrl: null,
  overlayImage: null,
  overlayName: null,
  soundCtx: null,
  lastActiveForSound: null,
  editCombatantId: null,
  prevJokerFlash: null,
  lastSeenMsgTs: Number(localStorage.getItem("lastSeenMsgTs") || 0),
  clockOffset: 0,   // Serverzeit − lokale Zeit (gleicht Uhren-Versatz aus)
  tokenPopupId: null,  // Kampfzonen: aktuell geöffnetes Token-Infofenster
  pendingMove: null,   // Kampfzonen: angetippte Ziel-Bahn, wartet auf Bestätigung
  collapsed: (() => { try { return JSON.parse(localStorage.getItem("collapsed") || "{}"); } catch { return {}; } })(),
  rowStatusOpen: new Set(),  // Reihenfolge: pro Zeile aufgeklappte Zustands-Leiste (übersteht Re-Render)
  reqMode: false,            // Spieler: Anfrage-Modus (ein Umschalter für ALLE Meldungen)
  // Beitrittsseite: Ansicht (weiter/liste/neu) und Getipptes - übersteht Server-Updates.
  joinEntwurf: { modus: null, neuName: "", spielerName: (() => { try { return localStorage.getItem("spielerName") ?? localStorage.getItem("playerName") ?? ""; } catch { return ""; } })() },
};

// --- Ansicht des SL-Laptops zusätzlich auf dem Laptop sichern ---------------
// Der Browser merkt sich Anordnung, Klappzustand, Design & Co. pro ADRESSE.
// Läuft die App einmal auf Port 8001 statt 8000, fehlt dort alles. Deshalb
// schickt der SL-Browser diese Werte an den Server (data/settings.json) und
// übernimmt sie zurück, wenn sie im Browser fehlen. WICHTIG: vor dem ersten
// Zeichnen festhalten, was wirklich fehlte - applySkin() setzt z. B. sofort
// ein Standard-Design und würde die Lücke sonst verdecken.
const SL_ANSICHT_SCHLUESSEL = ["collapsed", "panelAnordnung", "skin", "jokerStile", "reveal"];
const ansichtFehlteBeimStart = new Set(SL_ANSICHT_SCHLUESSEL.filter((k) => {
  try { return localStorage.getItem(k) === null; } catch { return true; }
}));
let ansichtTimer = null;
function slAnsichtSichern() {
  if (App.role !== "gm" || !App.state) return;
  clearTimeout(ansichtTimer);
  ansichtTimer = setTimeout(() => {
    const werte = {};
    SL_ANSICHT_SCHLUESSEL.forEach((k) => {
      try { const v = localStorage.getItem(k); if (v !== null) werte[k] = v; } catch { /* egal */ }
    });
    wsSend({ type: "gm_action", action: { type: "set_sl_ansicht", werte } });
  }, 800);
}
function slAnsichtUebernehmen(server) {
  let geaendert = false, lokalMehr = false;
  SL_ANSICHT_SCHLUESSEL.forEach((k) => {
    const v = server && server[k];
    if (ansichtFehlteBeimStart.has(k) && typeof v === "string") {
      try { localStorage.setItem(k, v); } catch { return; }
      geaendert = true;
      if (k === "collapsed") { try { App.collapsed = JSON.parse(v) || {}; } catch { /* egal */ } }
      if (k === "skin") applySkin(v);
      if (k === "jokerStile") { try { Cards.setJokerAuswahl(JSON.parse(v)); } catch { /* egal */ } }
    } else if (!ansichtFehlteBeimStart.has(k) && !(server && k in server)) {
      lokalMehr = true;          // Browser kennt es, der Laptop noch nicht
    }
  });
  if (lokalMehr) slAnsichtSichern();
  return geaendert;
}

const ASSET_VERSION = "1.5.7";   // muss mit ?v= in index.html und APP_VERSION (Server) übereinstimmen

const $ = (id) => document.getElementById(id);

// Version anzeigen; weicht die geladene App von der Server-Version ab, hängt der
// Browser-Cache -> deutlicher Hinweis (genau die Falle vom „Wunden-Bug").
function versionLine() {
  const server = App._info && App._info.version;
  const stale = server && server !== ASSET_VERSION;
  return `<div class="muted small" style="margin-top:8px">App-Version ${esc(ASSET_VERSION)}${server ? ` · Server ${esc(server)}` : ""}</div>` +
    `<div class="muted small" style="margin-top:2px">Inoffizielles Fanprojekt – nicht verbunden mit Pinnacle (Savage Worlds) oder Triple Ace Games (Sundered Skies).</div>` +
    (stale ? `<div class="pill bad" style="margin-top:4px">⚠ Alte Seite im Cache (v${esc(ASSET_VERSION)} statt v${esc(server)}). Einmal Strg+F5 drücken.</div>` : "");
}
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Einklappbares Panel (merkt sich den Zustand pro id in localStorage, Default offen).
// Panels, die der SL nur zur VORBEREITUNG braucht. Sie starten eingeklappt,
// damit im Spiel alles Wichtige auf einen Bildschirm passt. Wer eines aufklappt,
// dessen Wahl wird gemerkt (App.collapsed) und gewinnt ab dann.
const VORBEREITUNGS_PANELS = new Set([
  "connect", "bibliothek",
  // Gruppen braucht man nicht in jedem Zug. Offen machten sie die linke Spalte
  // deutlich länger - das Panel listet jede Figur als Chip und wächst mit dem
  // Kampf. Ein Klick klappt es auf, die Wahl bleibt. (Nachricht / Bild /
  // Bennies ist dagegen bewusst offen: das braucht der SL mitten im Spiel.)
  "groups",
]);

function section(id, title, body, defaultOpen) {
  if (defaultOpen === undefined) defaultOpen = !VORBEREITUNGS_PANELS.has(id);
  const saved = App.collapsed[id];
  const open = saved === undefined ? defaultOpen : saved !== true;
  // Erklärtexte (Klasse "hilfe") sind beim SL erst hinter dem ⓘ in der
  // Überschrift. Nach dem dritten Spielabend las sie keiner mehr, sie kosteten
  // aber in jedem Panel ein, zwei Zeilen.
  const hatHilfe = App.role === "gm" && /class="[^"]*\bhilfe\b/.test(body);
  const hilfeAn = hatHilfe && App.hilfeOffen.has(id);
  const hilfeKnopf = hatHilfe
    ? `<button type="button" class="hilfe-knopf${hilfeAn ? " on" : ""}" data-act="hilfe-umschalten" data-sec="${id}" title="Erklärung ${hilfeAn ? "ausblenden" : "einblenden"}">ⓘ</button>` : "";
  return `<details class="panel section${hilfeAn ? " hilfe-an" : ""}" data-sec="${id}"${open ? " open" : ""}>` +
    // SL: an der Ueberschrift ziehbar (Panels selbst anordnen, siehe PANEL_BAU).
    `<summary class="sec-head"${App.role === "gm" && PANEL_BAU[id] ? ` draggable="true" data-panel-zieh="${id}" title="Klicken: auf-/zuklappen · Ziehen: an andere Stelle verschieben"` : ""}>` +
    `<span class="sec-title">${title}</span>${hilfeKnopf}<span class="sec-caret">▸</span></summary>` +
    `<div class="panel-body">${body}</div></details>`;
}
// Klappzustand merken (toggle bubbelt nicht -> capture).
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches) return;
  if (d.matches("details.section[data-sec]")) {
    App.collapsed[d.dataset.sec] = !d.open;   // true = eingeklappt
    try { localStorage.setItem("collapsed", JSON.stringify(App.collapsed)); } catch { /* ignore */ }
    slAnsichtSichern();
  }
  if (d.matches("details[data-merk]")) {
    if (d.open) App.offeneUnter.add(d.dataset.merk); else App.offeneUnter.delete(d.dataset.merk);
  }
  // (Die Zustands-Leiste einer Figur ist kein <details> mehr, sondern wird per
  // "⋯"-Knopf umgeschaltet - siehe "zustand-umschalten".)
}, true);

// --- Aufdeck-Stile ----------------------------------------------------------
// Pro Gerät wählbar (wie die Skins). „random" würfelt je Karte einen Stil aus –
// die Wahl wird pro Karte gemerkt, damit ein Neu-Rendern sie nicht ändert.
const REVEALS = ["flip", "slide", "wipe", "shatter", "mist", "iris", "random"];
const REVEAL_NAMES = {
  flip: "🎴 Umdrehen", slide: "🃏 Abziehen", wipe: "✨ Lichtwisch",
  shatter: "💥 Zersplittern", mist: "🌫️ Glutnebel", iris: "🧭 Kompass-Blende",
  random: "🎲 Zufall",
};
const _revealPick = new Map();   // Karten-Key -> gewürfelter Stil

function revealSetting() {
  const v = localStorage.getItem("reveal");
  return REVEALS.includes(v) ? v : "random";
}
function revealStyleFor(key) {
  const s = revealSetting();
  if (s !== "random") return s;
  if (!_revealPick.has(key)) {
    const pool = REVEALS.filter((x) => x !== "random");
    _revealPick.set(key, pool[Math.floor(Math.random() * pool.length)]);
    if (_revealPick.size > 200) _revealPick.clear();   // simpel begrenzt
  }
  return _revealPick.get(key);
}

// Zersplittern: die Rückseite wird in Scherben zerlegt, die auseinanderdriften.
const SHARDS = [
  ["polygon(50% 50%, 0% 0%, 52% 0%)", -34, -52, "-16deg"],
  ["polygon(50% 50%, 52% 0%, 100% 0%, 100% 34%)", 42, -44, "14deg"],
  ["polygon(50% 50%, 100% 34%, 100% 100%, 62% 100%)", 52, 40, "18deg"],
  ["polygon(50% 50%, 62% 100%, 12% 100%)", 6, 62, "-8deg"],
  ["polygon(50% 50%, 12% 100%, 0% 100%, 0% 44%)", -48, 38, "-20deg"],
  ["polygon(50% 50%, 0% 44%, 0% 0%)", -46, -14, "10deg"],
];
function shatterBack(node) {
  const back = node.querySelector(".flip-back");
  const inner = node.querySelector(".flip-inner");
  if (!back || !inner) return;
  const frag = document.createDocumentFragment();
  const shards = SHARDS.map(([clip, dx, dy, rot]) => {
    const d = document.createElement("div");
    d.className = "shard";
    d.style.clipPath = clip;
    d.style.webkitClipPath = clip;
    d.style.setProperty("--dx", dx + "%");
    d.style.setProperty("--dy", dy + "%");
    d.style.setProperty("--rot", rot);
    d.innerHTML = back.innerHTML;
    frag.appendChild(d);
    return d;
  });
  inner.appendChild(frag);
  // Erst knackt es kurz (Zittern der Rueckseite), dann brechen die Scherben weg.
  setTimeout(() => shards.forEach((s) => s.classList.add("go")), 230);
  setTimeout(() => shards.forEach((s) => s.remove()), 1500);
}

// Wie lange ein Aufdeck-Stil laeuft (ms). „flip" = die 3D-Drehung der kleinen
// Karten samt Pop-Leuchten.
function revealDauer(style) {
  return style === "mist" ? 1400 : style === "shatter" ? 1500 : style === "flip" ? 850 : 1000;
}

// Aufdecken mit dem gewählten Stil starten (setzt „revealing" für die Dauer).
function playReveal(node) {
  const style = (node.className.match(/\brv-(\w+)\b/) || [])[1] || "flip";
  if (style === "flip") return;
  // Ohne 3D-Drehung darf die (stillstehende) Vorderseite ihren Filter behalten.
  node.classList.remove("flipping", "reveal-pop");
  node.classList.add("revealing");
  const inner = node.querySelector(".flip-inner");
  const extras = [];
  if (style === "shatter") {
    shatterBack(node);
  } else if (style === "mist" && inner) {
    ["mistfx", "mistfx b"].forEach((cls) => {
      const m = document.createElement("div");
      m.className = cls;
      inner.appendChild(m); extras.push(m);
    });
  }
  const dur = revealDauer(style);
  setTimeout(() => {
    node.classList.remove("revealing");
    extras.forEach((el) => el.remove());
  }, dur);
}

// Filter (Schatten/Glühen) sehen im Ruhezustand toll aus und kosten dort nichts –
// solange sich die Karte aber DREHT, müsste der Browser sie pro Frame neu rastern.
// Darum markieren wir die laufende Drehung; die CSS schaltet die Filter dann ab.
document.addEventListener("transitionstart", (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains("flip-inner")) {
    const f = t.closest(".flip");
    if (f) f.classList.add("flipping");
  }
}, true);
// Die Einflug-Klasse bleibt sonst dauerhaft am Element kleben (und würde den
// schönen Ruhe-Filter für immer abschalten) -> nach der Animation entfernen.
document.addEventListener("animationend", (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains("dealin") && e.animationName === "dealIn") {
    t.classList.remove("dealin");
  }
}, true);
["transitionend", "transitioncancel"].forEach((ev) => {
  document.addEventListener(ev, (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains("flip-inner")) {
      const f = t.closest(".flip");
      if (f) f.classList.remove("flipping");
    }
  }, true);
});

// --- Signale (kurzer Ton + Vibration) ---------------------------------------
let _actx = null;
function playBeep(freq, ms) {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === "suspended") _actx.resume();
    const o = _actx.createOscillator(), g = _actx.createGain();
    o.type = "sine"; o.frequency.value = freq || 880;
    o.connect(g); g.connect(_actx.destination);
    const t = _actx.currentTime;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (ms || 120) / 1000);
    o.start(t); o.stop(t + (ms || 120) / 1000);
  } catch { /* Audio ohne Nutzergeste evtl. blockiert – egal */ }
}
// iPhone: Ton gibt es nur, wenn der AudioContext bei einer BERÜHRUNG geweckt
// wurde. Bisher entstand er erst beim „Du bist dran" - ohne Berührung - und
// blieb auf iPhones stumm. Darum bei jedem Antippen wecken (kostet nichts,
// wenn er schon läuft); iOS legt ihn nach Sperrbildschirm wieder schlafen.
// pointerdown zählt auf Touch-Geräten nicht als Geste, pointerup/touchend schon.
function tonWecken() {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === "running") return;
    _actx.resume();
    const q = _actx.createBufferSource();          // stiller Mini-Ton schaltet iOS frei
    q.buffer = _actx.createBuffer(1, 1, 22050);
    q.connect(_actx.destination); q.start(0);
  } catch { /* ohne Web Audio eben ohne Ton */ }
}
["pointerup", "touchend", "keydown"].forEach((ev) => document.addEventListener(ev, tonWecken, { capture: true, passive: true }));
// Vibration kann das iPhone im Browser gar nicht (navigator.vibrate fehlt).
const kannVibrieren = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
// Ersatz, den jeder sieht: der Bildschirmrand blitzt golden auf.
function dranBlitz() {
  document.querySelectorAll(".dran-blitz").forEach((n) => n.remove());
  const n = el(`<div class="dran-blitz" aria-hidden="true"></div>`);
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 1800);
}

// SL: kurzer Doppelton, wenn eine NEUE Spieler-Anfrage eintrifft (nichts verpassen).
function checkRequestAlert() {
  if (App.role !== "gm" || !App.state) return;
  const ids = new Set((App.state.requests || []).map((r) => r.id));
  const prev = App._prevReqIds || new Set();
  let isNew = false;
  ids.forEach((id) => { if (!prev.has(id)) isNew = true; });
  if (isNew && App._reqInit) { playBeep(880, 90); setTimeout(() => playBeep(1170, 110), 120); }
  App._prevReqIds = ids;
  App._reqInit = true;
}

// Rundenzähler: „Runde 3" gut sichtbar - beim SL in der Leiste unten, beim
// Spieler oben rechts. Wechselt die Runde, pulsiert er einmal kurz (nur beim
// ersten Zeichnen nach dem Wechsel, sonst würde jedes Update ihn neu anstoßen).
function rundenZaehler(s) {
  if (!s || !s.round) return "";
  const neu = App._gezeigteRunde !== undefined && App._gezeigteRunde !== s.round;
  App._gezeigteRunde = s.round;
  return `<span class="runden-zaehler${neu ? " neu" : ""}" title="Aktuelle Kampfrunde">Runde <b>${s.round}</b></span>`;
}

// Wer kommt nach dem aktiven Akteur dran? Pausierte, ausgeschiedene und schon
// fertige Figuren werden uebersprungen. (SL-Leiste „danach:" und die
// Vorwarnung „Gleich bist du dran" auf dem Handy.)
function naechsterAkteur(s) {
  if (!s || !s.activeId) return null;
  const platz = s.combatants.findIndex((c) => c.id === s.activeId);
  if (platz < 0) return null;
  // Teilt der Aktive eine Gruppenkarte, sind die übrigen Mitglieder nicht
  // „danach" - sie handeln gerade mit.
  const gruppe = new Set(kartenGruppeVon(s.combatants[platz]).map((x) => x.id));
  return s.combatants.slice(platz + 1).find((c) => !gruppe.has(c.id) && !c.benched && !(c.status || {}).out && !c.done) || null;
}

// „Ork 11" -> „Ork" (wie _grundname am Server).
function grundname(name) {
  const m = /^(.*?)\s+(\d+)$/.exec(String(name || "").trim());
  return m ? m[1] : String(name || "").trim();
}
// Gruppenkarte (optional): Statisten derselben Seite mit gleichem Namen, die
// dieselbe Karte halten, handeln gemeinsam. Ohne Schalter: jeder für sich.
function kartenGruppeVon(c) {
  const s = App.state;
  if (!c || !s || !s.gruppenKarte || !c.card || c.kind !== "npc" || c.isWildCard) return c ? [c] : [];
  const g = grundname(c.name);
  return s.combatants.filter((x) => x.card && x.card.id === c.card.id && x.kind === "npc"
    && !x.isWildCard && !!x.ally === !!c.ally && grundname(x.name) === g);
}
// Wer darf fürs Erholen einen Benny ausgeben - und woher kommt er?
// Nur Wild Cards. Gegner-Wild-Cards zahlen aus dem SL-Pool, alle anderen selbst.
function bennyQuelle(c) {
  if (!c || !c.isWildCard) return null;
  const feind = c.kind === "npc" && !c.ally;
  return { feind, n: feind ? ((App.state && App.state.slBennies) || 0) : (c.bennies || 0) };
}
// Parade / Robustheit / Panzer: bei NSC aus der Vorlage, bei Spielern aus dem
// Charakterbogen (eingetragen oder - wie dort - aus Kämpfen/Konstitution gerechnet).
function kampfwerte(c) {
  if (!c) return {};
  if (c.kind !== "npc" && c.bogen) {
    const b = c.bogen;
    const zahl = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
    let p = zahl(b.parade), r = zahl(b.robustheit);
    try { if (p === null) p = autoParade(b); if (r === null) r = autoRobustheit(b); } catch { /* unvollständig */ }
    return { p, r, panzer: zahl(b.panzer) };
  }
  return { p: c.parade ?? null, r: c.robustheit ?? null, panzer: c.panzer ?? null };
}
function kampfwerteText(c) {
  const w = kampfwerte(c);
  const teile = [];
  if (w.p != null) teile.push(`P ${w.p}`);
  if (w.r != null) teile.push(`R ${w.r}${w.panzer ? `(${w.panzer})` : ""}`);
  return teile.join(" · ");
}
// Eingabefelder Parade/Robustheit/Panzer für die Formulare.
function kampfwerteFelder(prefix, c) {
  const feld = (k, titel, hilfe) => `<label class="field kampfwert"><span>${titel}</span>
    <input id="${prefix}-${k}" type="number" min="0" max="30" inputmode="numeric" value="${c && c[k] != null ? c[k] : ""}" title="${hilfe}"></label>`;
  return `<div class="row tight kampfwerte-felder">
    ${feld("parade", "Parade", "z. B. 6")}
    ${feld("robustheit", "Robustheit", "Gesamtwert inkl. Panzer, z. B. 8")}
    ${feld("panzer", "davon Panzer", "nur zur Anzeige: 8(2)")}
  </div>`;
}
function kampfwerteLesen(prefix) {
  const w = {};
  ["parade", "robustheit", "panzer"].forEach((k) => { const el = $(`${prefix}-${k}`); w[k] = el ? el.value : ""; });
  return w;
}

// SL: abgelaufene Dauer-Effekte kurz einblenden (nur neue, nicht beim Laden).
function checkEffektMeldungen() {
  if (App.role !== "gm" || !App.state) return;
  const liste = App.state.effektMeldungen || [];
  const gesehen = App._effektGesehen || new Set();
  if (App._effektInit) {
    liste.filter((m) => !gesehen.has(m.id)).forEach((m, i) =>
      setTimeout(() => toast((m.icon || "⏱") + " " + m.text), i * 1600));
  }
  App._effektGesehen = new Set(liste.map((m) => m.id));
  App._effektInit = true;
}

// Spieler: Vibration + Ton, wenn man dran wird (abschaltbar, pro Handy gemerkt).
function checkTurnNotify() {
  const s = App.state;
  if (!s || App.role === "gm") return;
  const mine = myCombatant();
  const myTurn = !!(mine && s.activeId === mine.id && s.phase === "running");
  if (myTurn && !App._prevMyTurn && App._turnInit && localStorage.getItem("notifyTurn") !== "off") {
    try { if (navigator.vibrate) navigator.vibrate([130, 70, 130]); } catch { /* ignore */ }
    playBeep(660, 150); setTimeout(() => playBeep(990, 170), 170);
  }
  // Wer dran ist, soll es auch SEHEN: nach oben springen, egal wo im Handy
  // gerade gescrollt wurde. Läuft unabhängig vom Ton/Vibration - die kann man
  // abschalten, verpassen darf man seinen Zug trotzdem nicht.
  if (myTurn && !App._prevMyTurn && App._turnInit) {   // (Spieler-Ansicht)
    dranBlitz();
    // Erst nach dem Neuzeichnen springen, sonst zielt es auf die alte Seite.
    setTimeout(() => {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* s. u. */ }
      // Nachfassen: manche Browser ignorieren "smooth" KOMMENTARLOS - kein
      // Fehler, es passiert nur nichts. Deshalb kurz darauf nachsehen und
      // notfalls hart springen. Lieber ruckartig oben als gar nicht.
      setTimeout(() => { if (window.scrollY > 0) window.scrollTo(0, 0); }, 450);
    }, 60);
  }
  // Vorwarnung: man ist als Naechster dran -> einmal kurz vibrieren (leiser
  // als beim eigenen Zug), damit man das Handy schon mal in die Hand nimmt.
  const binNaechster = !!(mine && !myTurn && !mine.benched && (naechsterAkteur(s) || {}).id === mine.id
    && s.phase !== "idle");
  if (binNaechster && !App._prevNaechster && App._turnInit && localStorage.getItem("notifyTurn") !== "off") {
    try { if (navigator.vibrate) navigator.vibrate(90); } catch { /* ignore */ }
  }
  App._prevNaechster = binNaechster;
  App._prevMyTurn = myTurn;
  App._turnInit = true;
}
