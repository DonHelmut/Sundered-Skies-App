// Client-Logik für SL- und Spieler-Ansicht.
// Rolle kommt vom Server (Laptop/Loopback = SL, sonst Spieler).

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

const ASSET_VERSION = "1.4.5";   // muss mit ?v= in index.html und APP_VERSION (Server) übereinstimmen

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

// --- Verbindung -------------------------------------------------------------

// App-Heartbeat: erkennt eine tote Leitung (WLAN-Aussetzer) in Sekunden, statt
// zu warten bis TCP von selbst zusammenbricht. Alle 4 s ein Ping; kommt >9 s
// nichts mehr vom Server (auch kein Pong), Verbindung hart schließen -> Reconnect.
// Bei flackerndem WLAN zählt jede Sekunde: je früher wir den Abriss bemerken,
// desto früher läuft der Wiederaufbau - und desto kürzer steht das Spiel.
let heartbeatTimer = null;
function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    const ws = App.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - (App.lastRecv || 0) > 9000) {
      try { ws.close(); } catch { /* onclose übernimmt den Reconnect */ }
      return;
    }
    try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* nächster Tick */ }
  }, 4000);
}

// Hat das Handy still auf Mobilfunk umgeschaltet? Passiert, wenn das WLAN kein
// Internet hat (Router lebt, Anbieter-Leitung tot): das Handy schickt dann alles
// ueber mobile Daten und findet den Laptop im WLAN nicht mehr – obwohl „WLAN
// verbunden" dasteht. Chrome auf Android verraet das ueber navigator.connection;
// iPhone/Safari kennt die Schnittstelle nicht, dort bleibt es beim allgemeinen
// Hinweis nach 25 s.
function aufMobilfunk() {
  try { return !!navigator.connection && navigator.connection.type === "cellular"; } catch { return false; }
}
try {
  // Mobile Daten aus -> Netz wechselt zurueck aufs WLAN -> sofort neu verbinden
  // statt auf den naechsten 1,5-s-Versuch zu warten; Hinweis aktualisieren.
  if (navigator.connection && navigator.connection.addEventListener) {
    navigator.connection.addEventListener("change", () => {
      if (aufMobilfunk()) App.warMobilfunk = true;
      if ($("offline-hinweis") || offlineTimer) zeigeOfflineHinweis();
      ensureConnected();
    });
  }
} catch { /* ohne Schnittstelle eben nicht */ }

function connect() {
  // Keine Doppel-Sockets: läuft schon einer (verbindend/offen), nichts tun.
  if (App.ws && (App.ws.readyState === WebSocket.CONNECTING || App.ws.readyState === WebSocket.OPEN)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  App.ws = ws;

  ws.onopen = () => {
    App.lastRecv = Date.now();
    App.reconnectTries = 0;
    setStatus("online");
    versteckeOfflineHinweis();
    startHeartbeat();
    // War die Leitung vorher weg? Dauer an den Server melden (fürs Diagnose-Log).
    if (App.wentOfflineAt) {
      const gapMs = Date.now() - App.wentOfflineAt;
      App.wentOfflineAt = 0;
      // Stand das Handy zwischendurch auf Mobilfunk, steht die Ursache im Log.
      const event = App.warMobilfunk ? "wieder verbunden (war auf Mobilfunk)" : "wieder verbunden";
      App.warMobilfunk = false;
      try { ws.send(JSON.stringify({ type: "clientlog", event, gapMs })); } catch { /* egal */ }
    }
  };
  ws.onclose = () => {
    stopHeartbeat();
    if (aufMobilfunk()) App.warMobilfunk = true;
    if (!App.wentOfflineAt) App.wentOfflineAt = Date.now();
    App.reconnectTries = (App.reconnectTries || 0) + 1;
    setStatus("offline");
    zeigeOfflineHinweis();
    // Kommt die Leitung 20 s nicht zurück, könnte der Laptop eine ANDERE
    // Adresse haben (WLAN-Aussetzer, Router-Neustart). Dann die übrigen
    // bekannten Adressen durchprobieren und dorthin umleiten.
    if (Date.now() - App.wentOfflineAt > 20000) adressFallback();
    setTimeout(connect, 1500);
  };
  ws.onerror = () => setStatus("reconnect");
  ws.onmessage = (ev) => {
    App.lastRecv = Date.now();   // jede Nachricht (auch Pong) hält die Leitung „frisch"
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "pong") return;   // reiner Heartbeat, nichts zu tun
    if (msg.type === "hello") {
      if (veraltetNeuLaden(msg.version, ASSET_VERSION)) return;
      App.role = msg.role;
      document.body.classList.toggle("player", App.role === "player");
      // Die SL-Optik (Kopfleiste, flache Panels, Liste als Tabelle) gilt nur am
      // Laptop - die Handys behalten ihre gewohnte Ansicht.
      document.body.classList.toggle("sl-ansicht", App.role === "gm");
      maybeAutoRejoin();
      // ERST nach dem Wieder-Beitritt nachreichen: vorher weiß der Server
      // nicht, wer da sendet, und würde Spieler-Aktionen verwerfen.
      warteschlangeSenden();
    } else if (msg.type === "state") {
      if (msg.state.serverNow) App.clockOffset = msg.state.serverNow - Date.now();
      App.state = msg.state;
      if (App.role === "gm" && !App._ansichtAbgeglichen) {
        App._ansichtAbgeglichen = true;
        if (slAnsichtUebernehmen(msg.state.slAnsicht)) App._letztesHtml = null;
      }
      checkRequestAlert();   // SL: neue Anfrage -> Signal
      checkEffektMeldungen(); // SL: Dauer-Effekt abgelaufen -> Hinweis
      checkTurnNotify();     // Spieler: dran -> Vibration/Ton
      pruefeAktivenWechsel();  // SL: aktive Zeile ins Bild holen
      // Während einer laufenden Karten-Aufdeckung NICHT sofort neu rendern – sonst
      // baut render() die Karte neu und sie schnappt aufgedeckt (das „Hakeln").
      // Neuesten Zustand nur merken und direkt nach der Animation einmal anwenden.
      if (App.revealLockUntil && Date.now() < App.revealLockUntil) { App.pendingRender = true; return; }
      // Spieler tippt gerade im Charakterbogen -> nach dem Feld nachholen.
      if (tipptImBogen() || blattScrollt()) { App.bogenWartet = true; if (blattScrollt()) setTimeout(bogenNachholen, 800); return; }
      render();
    } else if (msg.type === "joinError") {
      // Charakter wird gerade woanders gespielt oder ist unbekannt -> zurück
      // auf die Beitrittsseite, mit Erklärung.
      App.joined = false;
      App.joinFehler = msg.message || null;
      if (msg.grund === "unbekannt") {
        // Gemerkte ID stammt von einem anderen/alten Server: vergessen, damit
        // das Handy nicht bei jedem Verbinden wieder anklopft.
        App.myPlayerId = null; App.myCharacterId = null;
        try { localStorage.removeItem("playerId"); localStorage.removeItem("characterId"); } catch { /* egal */ }
      }
      if (App.state && (App.state.roster || []).length) App.joinEntwurf.modus = "liste";
      if (msg.grund === "charakter-unbekannt") {
        // Veraltete ID aus einer früheren Runde vergessen - sonst meldet sich
        // das Handy beim nächsten Laden automatisch wieder damit an.
        App.myCharacterId = null;
        try { localStorage.removeItem("characterId"); } catch { /* egal */ }
      }
      render();
    } else if (msg.type === "joined") {
      App.myPlayerId = msg.playerId;
      App.joined = true;
      localStorage.setItem("playerId", msg.playerId);
      render();
    }
  };
}

// Verbindung weg: großer, ruhiger Hinweis statt nur der kleinen Pille oben.
// Wichtig ist die Bitte, NICHT neu zu laden - ein Neuladen holt die Seite vom
// Server, und genau der ist ja gerade nicht erreichbar. Dann bliebe das Handy
// auf einer leeren Fehlerseite sitzen, während die App sich von selbst wieder
// gefangen hätte.
let offlineTimer = null;
function zeigeOfflineHinweis() {
  const seit = App.wentOfflineAt ? Math.round((Date.now() - App.wentOfflineAt) / 1000) : 0;
  const mobil = aufMobilfunk();
  if (mobil) App.warMobilfunk = true;
  let el = $("offline-hinweis");
  if (!el) {
    // Erst nach 4 s einblenden - kurze Aussetzer soll niemand mitbekommen.
    // Ausnahme Mobilfunk: das geht NICHT von selbst weg, also sofort zeigen.
    if (seit < 4 && !mobil) {
      if (!offlineTimer) offlineTimer = setTimeout(() => { offlineTimer = null; zeigeOfflineHinweis(); }, 4000);
      return;
    }
    el = document.createElement("div");
    el.id = "offline-hinweis";
    el.className = "offline-hinweis";
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="offline-box">
      <div class="offline-titel">📡 Verbindung unterbrochen</div>
      ${mobil ? `<div class="offline-mobilfunk">
        <div class="offline-mobilfunk-titel">📱 Dein Handy ist auf Mobilfunk umgesprungen</div>
        Das WLAN hat gerade kein Internet – deshalb nutzt dein Handy mobile Daten und
        findet den Spieltisch nicht mehr.<br>
        <b>Mobile Daten ausschalten</b> (oder Flugmodus an und WLAN wieder an) –
        dann geht es sofort weiter.
      </div>` : ""}
      <div class="offline-text">Die App versucht es von selbst weiter – <b>Versuch ${App.reconnectTries || 1}</b>, seit ${seit} s.</div>
      <div class="offline-warn">Bitte die Seite <b>NICHT neu laden</b> und den Tab offen lassen.<br>Sobald das WLAN zurück ist, geht es automatisch weiter.</div>
      ${App.warteschlange.length
        ? `<div class="offline-warteschlange">✋ ${App.warteschlange.length} Eingabe${App.warteschlange.length === 1 ? "" : "n"} gemerkt – wird nachgereicht, sobald die Verbindung steht.</div>`
        : `<div class="offline-text small">Was du jetzt tippst, wird gemerkt und nachgereicht.</div>`}
      ${seit > 25 && !mobil ? `<div class="offline-text small" style="text-align:left; line-height:1.5">
        <b>Dauert es länger?</b> Hat das WLAN gerade kein Internet, schalten viele
        Handys still auf <b>Mobilfunk</b> um – dann ist der Laptop unerreichbar,
        obwohl „WLAN verbunden“ dasteht.<br>Abhilfe: mobile Daten kurz ausschalten.
      </div>` : ""}
      <div class="offline-text small">Adresse: ${esc(location.host)}</div>
      <button class="primary" data-act="jetzt-verbinden">Jetzt erneut versuchen</button>
    </div>`;
}

function versteckeOfflineHinweis() {
  if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
  const el = $("offline-hinweis");
  if (el) el.remove();
}

// Der Laptop kann nach einem WLAN-Aussetzer eine andere IP haben. Wir kennen
// aus /api/info alle seine Adressen - die der Reihe nach anklopfen und bei der
// ersten, die antwortet, weitermachen. Läuft höchstens einmal pro Minute.
async function adressFallback() {
  if (App._fallbackLaeuft) return;
  const zuletzt = Number(localStorage.getItem("fallbackZeit") || 0);
  if (Date.now() - zuletzt < 60000) return;
  App._fallbackLaeuft = true;
  localStorage.setItem("fallbackZeit", String(Date.now()));
  try {
    let adressen = [];
    try { adressen = JSON.parse(localStorage.getItem("serverAdressen") || "[]"); } catch { /* egal */ }
    for (const url of adressen) {
      if (url.includes(location.host)) continue;          // die aktuelle bringt nichts
      try {
        const r = await fetch(url + "api/info", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (!r.ok) continue;
        const info = await r.json();
        if (!info || !info.prettyUrl) continue;           // fremder Dienst, nicht unsere App
        location.replace(url);                            // dort geht es weiter
        return;
      } catch { /* nächste Adresse */ }
    }
  } finally {
    App._fallbackLaeuft = false;
  }
}

// Handys pausieren beim Sperren die Reconnect-Schleife. Beim Wieder-Aufwecken
// (Tab sichtbar / Fokus / Netz zurück) SOFORT neu verbinden statt zu warten.
function ensureConnected() {
  if (!App.ws || App.ws.readyState === WebSocket.CLOSING || App.ws.readyState === WebSocket.CLOSED) connect();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) ensureConnected(); });
window.addEventListener("focus", ensureConnected);
window.addEventListener("online", ensureConnected);

// Alle Adressen des Servers merken - Grundlage für adressFallback().
function merkeServerAdressen(info) {
  try {
    const urls = (info && info.urls) || [];
    if (urls.length) localStorage.setItem("serverAdressen", JSON.stringify(urls));
  } catch { /* Speicher voll/gesperrt - dann eben ohne */ }
}

function setStatus(kind) {
  const map = {
    online: ["good", "Verbunden"],
    offline: ["bad", "Getrennt – neuer Versuch…"],
    reconnect: ["warn", "Verbinde neu…"],
  };
  const [cls, txt] = map[kind] || ["", "…"];
  const s = $("status");
  if (s) { s.className = "pill " + cls; s.textContent = txt; }
}

// --- Aussetzer überbrücken ---------------------------------------------------
// Bisher verschwand jede Aktion, die während eines WLAN-Aussetzers getippt
// wurde, ersatzlos: der Spieler tippt „Zug bestätigen", nichts passiert, und
// niemand merkt warum. Jetzt warten solche Aktionen und werden beim
// Wiederverbinden nachgereicht.
const WARTE_MAX_ALTER = 25000;   // älter als das wäre keine gültige Absicht mehr
const WARTE_MAX_ANZAHL = 20;

function merkeFuerSpaeter(obj) {
  // Herzschlag und Protokollmeldungen nachzureichen wäre sinnlos.
  if (obj.type === "ping" || obj.type === "clientlog") return;
  const text = JSON.stringify(obj);
  // Wer aus Ungeduld fünfmal tippt, soll nicht fünf Aktionen auslösen.
  if (App.warteschlange.some((e) => e.text === text)) return;
  App.warteschlange.push({ text, zeit: Date.now() });
  if (App.warteschlange.length > WARTE_MAX_ANZAHL) App.warteschlange.shift();
  zeigeOfflineHinweis();      // Zähler im Hinweis mitführen
}

function warteschlangeSenden() {
  if (!App.warteschlange.length) return;
  const jetzt = Date.now();
  const frisch = App.warteschlange.filter((e) => jetzt - e.zeit < WARTE_MAX_ALTER);
  const verworfen = App.warteschlange.length - frisch.length;
  App.warteschlange = [];
  let ok = 0;
  frisch.forEach((e) => { try { App.ws.send(e.text); ok++; } catch { /* Leitung doch wieder weg */ } });
  if (ok) toast(`${ok} Aktion${ok === 1 ? "" : "en"} nachgereicht.`);
  if (verworfen) toast(`${verworfen} zu alte Aktion${verworfen === 1 ? "" : "en"} verworfen.`);
}

function gmAction(action) { wsSend({ type: "gm_action", action }); }

function wsSend(obj) {
  if (App.ws && App.ws.readyState === 1) {
    try { App.ws.send(JSON.stringify(obj)); return true; }
    catch { /* Socket kippte genau jetzt -> unten einreihen */ }
  }
  merkeFuerSpaeter(obj);
  return false;
}

// --- Eigene Rückfragen statt confirm()/alert()/prompt() ---------------------
// Nach ein paar Browser-Dialogen bietet der Browser „weitere Dialoge von
// localhost:8000 unterbinden" an. Wer das anklickt, bekommt auf jedes
// confirm() sofort still „Abbrechen" - Entfernen, Abräumen, Löschen taten
// dann einfach nichts mehr (Stefan: „die Steuerung ist bricked"). Eigene
// Dialoge kann der Browser nicht sperren. Sie hängen an <body>, nicht an
// #app - render() würde sie sonst mitten in der Frage wegwischen.
let _dialogZu = null;
function dialog({ text, knoepfe, eingabe = null }) {
  return new Promise((fertig) => {
    if (_dialogZu) _dialogZu(null);                // höchstens einer offen
    const box = el(`<div class="app-dialog-hg" role="dialog" aria-modal="true">
      <div class="app-dialog panel">
        <div class="app-dialog-text">${esc(text).replace(/\n/g, "<br>")}</div>
        ${eingabe ? `<input class="app-dialog-eingabe" maxlength="60" value="${esc(eingabe.vorgabe || "")}">` : ""}
        <div class="app-dialog-knoepfe">${knoepfe.map((k, i) =>
          `<button type="button" class="${k.art || "ghost"}" data-i="${i}">${esc(k.text)}</button>`).join("")}</div>
      </div></div>`);
    const feld = box.querySelector("input");
    const standard = knoepfe.findIndex((k) => k.standard);
    const abbruch = knoepfe.findIndex((k) => k.abbruch);
    const wertVon = (i) => {
      const k = knoepfe[i];
      if (!k) return null;
      if (feld && !k.abbruch) return feld.value.trim() || null;
      return k.wert;
    };
    const zu = (wert) => {
      box.remove();
      document.removeEventListener("keydown", taste, true);
      _dialogZu = null;
      fertig(wert);
    };
    const abbrechen = () => zu(abbruch >= 0 ? knoepfe[abbruch].wert : null);
    function taste(e) {
      // Solange der Dialog offen ist, bekommt die SL-Steuerung keine Tasten
      // (sonst gäbe die Leertaste nebenbei den nächsten Zug frei).
      e.stopImmediatePropagation();
      if (e.key === "Escape") { e.preventDefault(); abbrechen(); }
      else if (e.key === "Enter" && standard >= 0) { e.preventDefault(); zu(wertVon(standard)); }
    }
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) { e.stopPropagation(); zu(wertVon(Number(b.dataset.i))); }
      else if (e.target === box) abbrechen();       // Klick daneben = Abbrechen
    });
    document.addEventListener("keydown", taste, true);
    _dialogZu = zu;
    document.body.appendChild(box);
    if (feld) { feld.focus(); feld.select(); }
    else { const b = box.querySelector(`button[data-i="${standard >= 0 ? standard : 0}"]`); if (b) b.focus(); }
  });
}
// Ja/Nein -> true/false. gefahr: roter Knopf (Löschen, Entfernen …).
const frage = (text, ja = "OK", gefahr = false) => dialog({ text, knoepfe: [
  { text: "Abbrechen", wert: false, abbruch: true },
  { text: ja, wert: true, art: gefahr ? "bad" : "primary", standard: true }] });
const hinweis = (text) => dialog({ text, knoepfe: [{ text: "OK", wert: true, art: "primary", standard: true, abbruch: true }] });
// Texteingabe -> getrimmter Text oder null (Abbrechen/leer).
const eingabe = (text, vorgabe = "", ja = "OK") => dialog({ text, eingabe: { vorgabe }, knoepfe: [
  { text: "Abbrechen", wert: null, abbruch: true },
  { text: ja, art: "primary", standard: true }] });

// Nach einem Update laufen offene Tabs (Laptop, Handys, Beamer) mit dem ALTEN
// Seiten-Code weiter und verbinden sich einfach neu - mit alter Logik. So kam
// „Probe Schnell" trotz Schutz in 1.4.3 wieder rein. Weicht die Server-Version
// ab: einmal neu laden. Hängt danach der Cache, zeigt versionLine() den Hinweis.
function veraltetNeuLaden(serverVersion, eigene) {
  let schon = null;
  try { schon = sessionStorage.getItem("neuGeladenFuer"); } catch { /* egal */ }
  if (!serverVersion || serverVersion === eigene) {
    if (schon) try { sessionStorage.removeItem("neuGeladenFuer"); } catch { /* egal */ }
    return false;
  }
  if (schon === serverVersion) return false;          // schon versucht - nicht im Kreis laden
  try { sessionStorage.setItem("neuGeladenFuer", serverVersion); } catch { /* egal */ }
  location.reload();
  return true;
}

function maybeAutoRejoin() {
  if (App.role === "player" && App.myPlayerId && App.myName) {
    // auto: der Server nimmt das nur von Geräten an, die er kennt (sonst Beitrittsseite).
    wsSend({ type: "join", name: App.myName, characterId: App.myCharacterId, playerId: App.myPlayerId, auto: true });
    App.joined = true;
  }
}

// --- Karten / Flip ----------------------------------------------------------

// opts.open   = soll die Karte (auf diesem Gerät) offen liegen? (SL: immer; Spieler:
//               nur wenn tischweit aufgedeckt). opts.tappable = eigene verdeckte
//               Großkarte, die der Spieler antippen darf.
function cardSlot(cid, card, status, extraClass = "", opts = {}) {
  const { open = true, tappable = false } = opts;
  const key = card ? `${cid}:${card.id}` : `${cid}:none`;
  // Char-Bild dieser Figur: Vorder- UND Rückseite im Design des Bildes.
  const cimg = ((App.state && App.state.combatants.find((x) => x.id === cid)) || {}).image || null;
  const front = card ? Cards.renderCardSVG(card, cimg) : Cards.renderBackSVG(cimg);
  const isJoker = card && card.suit === "joker";
  const holderCls = ["card-holder", extraClass,
    status && status.out ? "is-out" : "",
    status && status.shaken ? "is-shaken" : "",
    isJoker ? "joker-slot" : ""].filter(Boolean).join(" ");
  const faces = `<div class="flip-inner">
      <div class="flip-face flip-front">${front}</div>
      <div class="flip-face flip-back">${Cards.renderBackSVG(cimg)}</div>
    </div>`;

  const faceUp = card ? open : true;   // ohne Karte: Rückseite als Platzhalter zeigen

  // Verdeckt liegen lassen (tischweit noch nicht aufgedeckt).
  if (!faceUp) {
    if (tappable) {
      const fresh = !App.seenDealt.has(key);          // Einflieg-Animation nur einmal
      const flipCls = "flip rv-" + revealStyleFor(key) + " await-tap" + (fresh ? " dealin-seal" : "");
      return `<div class="${holderCls}">
        <div class="${flipCls}" data-rkey="${esc(key)}" data-cid="${esc(cid)}" data-act="reveal-card">${faces}</div>
        ${statusOverlay(status)}
        <div class="tap-hint">👆 Antippen zum Aufdecken</div>
      </div>`;
    }
    return `<div class="${holderCls}">
      <div class="flip rv-${revealStyleFor(key)}" data-rkey="${esc(key)}">${faces}</div>
      ${statusOverlay(status)}
    </div>`;
  }

  // Offen: animiert aufdecken, falls auf DIESEM Gerät neu (sonst statisch offen).
  const animate = card && !App.revealed.has(key);
  const flipCls = "flip rv-" + revealStyleFor(key) + (animate ? "" : " revealed");
  const attr = animate ? ` data-newreveal="${esc(key)}"` : "";
  return `<div class="${holderCls}">
    <div class="${flipCls}"${attr}>${faces}</div>
    ${statusOverlay(status)}
  </div>`;
}

function statusOverlay(st) {
  if (!st) return "";
  let out = "";
  if (st.out) out += `<div class="st-cover">☠</div>`;
  const corner = [];
  if (st.shaken && !st.out) corner.push(`<div class="st-shaken">😵</div>`);
  if (st.wounds > 0 && !st.out) {
    corner.push(`<div class="st-wounds">${Array.from({ length: st.wounds }).map(() => '<span class="st-wound"></span>').join("")}</div>`);
  }
  if (corner.length) out += `<div class="st-corner">${corner.join("")}</div>`;
  return out;
}

function statusBadges(c, ohneKern) {
  const st = c.status;
  if (!st) return "";
  if (st.out && !ohneKern) return `<span class="pill bad">Ausgeschaltet</span>`;
  const b = [];
  if (st.shaken && !ohneKern) b.push(`<span class="pill warn">Angeschlagen</span>`);
  // Wunden mit Abzug – für jede Figur, die welche hat (SL kann auch Statisten
  // zähe machen). Deutlich sichtbar für SL und Spieler.
  if (st.wounds > 0 && !ohneKern) {
    b.push(`<span class="pill bad">🩸 ${st.wounds} Wunde${st.wounds > 1 ? "n" : ""} · −${st.wounds}</span>`);
  }
  const conds = (App.state && App.state.conditions) || {};
  Object.keys(conds).forEach((k) => { if (st[k]) b.push(`<span class="pill">${esc(conds[k])}</span>`); });
  return b.join(" ") + effektBadges(c);
}

// SL-Reihenfolge: Angeschlagen, Wunden und K.O. in einer FESTEN Spalte rechts -
// spielwichtig, darum nie abgeschnitten und in jeder Zeile an derselben Stelle.
// Wunden als Punkte: gefüllt = Wunde, leer = was die Figur noch aushält (nach
// der eingestellten Hausregel, wie max_wounds am Server). Klick öffnet das ⋯-Feld.
function zustandZelle(c) {
  const st = c.status || {};
  const s = App.state || {};
  const max = c.isWildCard ? 3 : Math.max(0, (s.statistenKo || 3) - 1);
  const w = st.wounds || 0;
  let inhalt;
  if (st.out) {
    inhalt = `<span class="z-raus">☠ raus</span>`;
  } else {
    const punkte = Array.from({ length: Math.max(max, w) }, (_, i) =>
      `<i class="z-punkt${i < w ? " voll" : ""}"></i>`).join("");
    inhalt = `<span class="z-shaken${st.shaken ? " an" : ""}">😵</span>`
      + `<span class="z-wunden">${punkte}</span>${w ? `<b class="z-abzug">−${w}</b>` : ""}`;
  }
  const titel = st.out ? "Ausgeschaltet" : [st.shaken ? "Angeschlagen" : "nicht angeschlagen",
    w ? `${w} Wunde${w > 1 ? "n" : ""} (−${w} auf Würfe)` : "keine Wunden", `hält ${max} Wunde${max === 1 ? "" : "n"} aus`].join(" · ");
  return `<button type="button" class="zustand-zelle${st.out ? " raus" : ""}" data-act="zustand-umschalten" data-id="${c.id}" title="${titel} – Klick: Zustände, Treffer, Heilung">${inhalt}</button>`;
}

// Dauer-Effekte als kleine Uhr-Pillen: „⏱ Betäubt · 2" (Restrunden), ohne Zahl
// = ohne Ablauf. Zaehlen serverseitig bei jeder neuen Runde runter.
function effektBadges(c) {
  return (c.effekte || []).map((e) =>
    ` <span class="pill effekt" title="${e.runden ? `noch ${e.runden} Runde${e.runden > 1 ? "n" : ""}` : "ohne Ablauf"}">⏱ ${esc(e.name)}${e.runden ? ` · ${e.runden}` : ""}</span>`).join("");
}

// SL: Effekte im ⋯-Feld verwalten. Schnellwahl fuer das Uebliche, sonst frei.
const EFFEKT_VORSCHLAEGE = ["Betäubt", "Abgelenkt", "Verwundbar", "Am Boden", "Verwirrt", "Schutz", "Brennt", "Unsichtbar", "Gebunden"];
function effektSteuerung(c) {
  const liste = (c.effekte || []).map((e) => `
    <span class="effekt-zeile">
      ⏱ ${esc(e.name)}
      ${e.runden ? `<button class="st-btn" data-act="effekt-minus" data-id="${c.id}" data-effekt="${e.id}" title="Eine Runde weniger">–</button>
        <b>${e.runden}</b>
        <button class="st-btn" data-act="effekt-plus" data-id="${c.id}" data-effekt="${e.id}" title="Eine Runde mehr">+</button>` : `<span class="muted small">ohne Ablauf</span>`}
      <button class="st-btn" data-act="effekt-weg" data-id="${c.id}" data-effekt="${e.id}" title="Effekt entfernen">✕</button>
    </span>`).join("");
  return `<div class="effekt-steuerung">
    ${liste}
    <span class="effekt-neu">
      <input list="effekt-vorschlaege" id="effname-${c.id}" placeholder="Effekt, z. B. Betäubt" maxlength="40">
      <input type="number" id="effrunden-${c.id}" min="0" max="99" value="1" title="Runden (0 = ohne Ablauf)">
      <button class="st-btn" data-act="effekt-add" data-id="${c.id}">⏱ + Effekt</button>
    </span>
  </div>`;
}

function reqBtn(label, kind, detail) {
  return `<button class="st-btn" data-act="player-request" data-kind="${kind}" data-detail='${esc(JSON.stringify(detail))}' data-label="${esc(label)}">${esc(label)}</button>`;
}

// Spieler ändern nichts selbst – sie fragen beim SL an.
// Nur laufende Anfragen (unter jeder Box angezeigt).
function pendingRequestLine(c) {
  const pending = (App.state.requests || []).filter((r) => r.combatantId === c.id);
  return pending.length
    ? `<div class="center muted small" style="margin-top:6px">⏳ Angefragt: ${pending.map((r) => esc(r.label || r.kind)).join(", ")}</div>` : "";
}

// EIN Umschalter für ALLE Anfragen: aus = nichts sichtbar (ruhige Ansicht),
// an = sämtliche Meldungen (Benny, Angeschlagen, Wunden, K.O., Zustände).
function playerQuickControls(c) {
  // Der SL kann Anfragen ganz abschalten -> dann gibt es hier gar nichts.
  if (App.state && App.state.requestsEnabled === false) return "";
  const on = App.reqMode;
  const toggle = `<button class="${on ? "primary" : "ghost"} big" data-act="toggle-req-mode" style="width:100%">
      ${on ? "✕ Anfragen schließen" : "✋ Etwas beim Spielleiter anfragen"}
    </button>`;
  if (!on) return `<div style="margin-top:10px">${toggle}${pendingRequestLine(c)}</div>`;

  const st = c.status || {};
  const conds = (App.state && App.state.conditions) || {};
  const rows = [];

  // Benny (nur Wild Cards mit Vorrat).
  if (c.isWildCard && (c.bennies || 0) > 0) {
    rows.push(reqBtn("🪙 Benny ausgeben", "benny", { delta: -1 }));
  }
  // Angeschlagen setzen/aufheben.
  rows.push(st.shaken
    ? reqBtn("😵 Angeschlagen aufheben", "status", { shaken: false })
    : reqBtn("😵 Angeschlagen", "status", { shaken: true }));
  // Wunden – für JEDE Figur (nicht nur Wild Cards).
  rows.push(reqBtn("🩸 Wunde +", "status", { woundsDelta: 1 }));
  if ((st.wounds || 0) > 0) rows.push(reqBtn("🩹 Wunde heilen", "status", { woundsDelta: -1 }));
  // K.O.
  rows.push(st.out
    ? reqBtn("☠ Nicht mehr K.O.", "status", { out: false })
    : reqBtn("☠ K.O.", "status", { out: true }));
  // Alle weiteren Zustände (Verwundbar, Abgelenkt, Am Boden, Betäubt …).
  Object.keys(conds).forEach((k) => rows.push(st[k]
    ? reqBtn(conds[k] + " aufheben", "status", { [k]: false })
    : reqBtn(conds[k], "status", { [k]: true })));

  return `<div style="margin-top:10px">
    ${toggle}
    <div class="req-box">
      <div class="center muted small">Der Spielleiter bestätigt deine Anfrage.</div>
      <div class="status-ctrl" style="justify-content:center; flex-wrap:wrap; margin-top:8px">${rows.join("")}</div>
    </div>
    ${pendingRequestLine(c)}
  </div>`;
}

// Große, deutliche Status-Anzeige für die Spieler-Ansicht.
function bigStatusDisplay(c) {
  const st = c.status || {};
  const conds = (App.state && App.state.conditions) || {};
  const b = [];
  if (st.out) {
    b.push(`<span class="big-status s-out">☠ Ausgeschaltet</span>`);
  } else {
    if (st.shaken) b.push(`<span class="big-status s-shaken">😵 Angeschlagen</span>`);
    if (st.wounds > 0) b.push(`<span class="big-status s-wound">🩸 ${st.wounds} Wunde${st.wounds > 1 ? "n" : ""} (−${st.wounds})</span>`);
    Object.keys(conds).forEach((k) => { if (st[k]) b.push(`<span class="big-status s-cond">${esc(conds[k])}</span>`); });
  }
  if (!b.length) b.push(`<span class="big-status s-ok">✓ Gesund</span>`);
  (c.effekte || []).forEach((e) => b.push(`<span class="big-status s-cond">⏱ ${esc(e.name)}${e.runden ? ` · noch ${e.runden} Runde${e.runden > 1 ? "n" : ""}` : ""}</span>`));
  return `<div class="big-status-row">${b.join("")}</div>`;
}

function bennyBadge(c) {
  if (!c.isWildCard) return "";
  return `<span class="pill" style="border-color:var(--gold);color:var(--gold)">🪙 ${c.bennies || 0}</span>`;
}

function bennyControls(c) {
  if (!c.isWildCard) return "";
  return `<span class="status-ctrl" style="gap:4px">
    <span class="small muted">Bennies</span>
    <button class="st-btn" data-act="benny-minus" data-id="${c.id}">–</button>
    <span class="small" style="min-width:30px;text-align:center">🪙 ${c.bennies || 0}</span>
    <button class="st-btn" data-act="benny-plus" data-id="${c.id}">+</button>
  </span>`;
}

function statusControls(c) {
  const st = c.status || {};
  const conds = (App.state && App.state.conditions) || {};
  // Wunden-Anzeige (Regeln laufen über die Quick-Buttons Treffer/Heilung).
  const woundBtns = `<span class="small" style="min-width:34px;text-align:center">🩸 ${st.wounds || 0}</span>`;
  const condBtns = Object.keys(conds).map((k) =>
    `<button class="st-btn ${st[k] ? "on" : ""}" data-act="st-cond" data-id="${c.id}" data-cond="${k}">${esc(conds[k])}</button>`
  ).join("");
  // Treffer/Heilung liegen als 1-Klick-Aktionen oben in der Zeile – hier bleibt
  // das Seltenere: Zustände, K.O., Neu ziehen, Bearbeiten.
  return `<div class="status-ctrl">
    ${!st.out ? `<button class="st-btn" data-act="apply-hit" data-id="${c.id}" title="Treffer: nicht angeschlagen → Angeschlagen; sonst +1 Wunde (Steigerungen: 🎯 Treffer unten)">💥 Treffer</button>` : ""}
    <button class="st-btn" data-act="apply-heal" data-id="${c.id}" title="Heilung: wieder wach / −1 Wunde / Angeschlagen weg">🩹 Heilen</button>
    ${woundBtns}
    <button class="st-btn ${st.shaken ? "on-shaken" : ""}" data-act="st-shaken" data-id="${c.id}">Angeschlagen</button>
    <button class="st-btn ${st.out ? "on-out" : ""}" data-act="st-out" data-id="${c.id}">${st.out ? "Ausgeschaltet" : "K.O."}</button>
    ${condBtns}
    ${c.card && !st.out ? `<button class="st-btn ${c.held ? "on" : ""}" data-act="${c.held ? "intervene" : "hold"}" data-id="${c.id}" title="${c.held ? "Jetzt eingreifen" : "Aktion aufsparen (Abwarten)"}">${c.held ? "⚡ Eingreifen" : "⏸ Abwarten"}</button>` : ""}
    <button class="st-btn" data-act="redraw" data-id="${c.id}" title="Neue Karte ziehen">🔄 Neu ziehen</button>
    <button class="st-btn" data-act="edit-combatant" data-id="${c.id}" title="Name/Wild Card/Notiz bearbeiten">✎ Bearbeiten</button>
  </div>`;
}

// Spieler tippt seine verdeckte Großkarte an -> kurzes Aufladen, dann langsamer
// Flip. Hat die Figur eine Ziehsequenz (Talent wie „Schnell"/„Kühler Kopf"), wird
// erst die/die gezogene(n) Karte(n) gezeigt und dann sichtbar auf die behaltene
// Karte nachgezogen – das Talent enthüllt sich also beim Aufdecken.
function revealBigCard(node) {
  if (!node) return;
  const key = node.getAttribute("data-rkey");
  if (!key || App.revealed.has(key)) return;
  App.revealed.add(key);
  const cid = node.getAttribute("data-cid");
  if (cid) gmActionOrPlayer({ type: "reveal", id: cid });
  node.classList.remove("await-tap", "dealin-seal");
  node.classList.add("await-big");

  const holder = node.closest(".card-holder");
  const hint = holder && holder.querySelector(".tap-hint");
  if (hint) hint.classList.add("gone");

  const mine = myCombatant();
  const img = (mine && mine.image) || null;
  const kept = mine && mine.card;
  const front = node.querySelector(".flip-front");
  // Anzeige-Reihenfolge: gezogene Karten, behaltene ganz zuletzt.
  let seq = (mine && Array.isArray(mine.draw) && mine.draw.length > 1) ? mine.draw.slice() : null;
  if (seq && kept) { seq = seq.filter((c) => c.id !== kept.id); seq.push(kept); }

  // Begruendung je verworfener Karte – aus der ORIGINAL-Ziehreihenfolge,
  // bevor `seq` oben umsortiert wurde.
  const reasons = seq ? Cards.discardReasons(mine.draw, kept, mine.talents) : null;

  const CHARGE = 600, FLIP = 1700;
  // Jede verworfene Karte bekommt ihren eigenen Wechsel (zeigen, markieren,
  // wegwerfen) – siehe Cards.playDrawSequence. „Schnell" ist dabei knapper.
  const extra = seq ? Cards.drawSequenceDuration(seq, reasons) : 0;
  const DONE = CHARGE + FLIP + extra + 500;
  App.revealLockUntil = Date.now() + DONE;
  clearTimeout(App._revealFlush);
  App._revealFlush = setTimeout(() => {
    App.revealLockUntil = 0; App.pendingRender = false;
    render();
  }, DONE);

  if (seq && front) front.innerHTML = Cards.renderCardSVG(seq[0], img);   // erste gezogene zeigen

  setTimeout(() => {
    if (!node.isConnected) return;
    node.classList.remove("await-big");
    // „flipping" zusätzlich hart setzen (Sicherheitsnetz, falls transitionstart
    // nicht feuert) – währenddessen sind die Filter aus und die Drehung bleibt flüssig.
    node.classList.add("revealed", "reveal-big", "flipping");
    playReveal(node);
    setTimeout(() => node.classList.remove("reveal-big", "flipping"), FLIP + 400);
    if (seq) Cards.playDrawSequence(node, seq, reasons, img, FLIP);
  }, CHARGE);

  // Eigener Joker: „JOKER!" erst, wenn er sichtbar wird - nach knapp der halben
  // Drehung, bzw. nach den verworfenen Karten (ein Joker wird immer behalten und
  // kommt daher zuletzt).
  if (kept && kept.suit === "joker") {
    setTimeout(() => { if (node.isConnected) triggerJokerMoment(); }, CHARGE + FLIP * 0.35 + extra);
  }
}

function runReveals() {
  // Frisch ausgeteilte, versiegelte eigene Großkarte: einmal verdeckt hereinfliegen
  // lassen – danach bleibt sie liegen und wartet auf den Tipp des Spielers.
  document.querySelectorAll(".flip.dealin-seal").forEach((node) => {
    const key = node.getAttribute("data-rkey");
    if (key) App.seenDealt.add(key);
    node.classList.remove("dealin-seal");
    node.classList.add("dealin");
    node.addEventListener("animationend", () => node.classList.remove("dealin"), { once: true });
  });

  // Alle „neu offen" erscheinenden Karten (Order-Minis, fremde Aufdeckungen, SL,
  // und die eigene Großkarte beim Reload-nach-Aufdecken): zügiger Pop-Bogen.
  // Der langsame, dramatische Flip der EIGENEN Karte läuft separat per Tipp
  // (revealBigCard) – hier NICHT.
  const nodes = [...document.querySelectorAll(".flip[data-newreveal]")];
  if (!nodes.length) return;
  nodes.forEach((node, i) => {
    const key = node.getAttribute("data-newreveal");
    node.removeAttribute("data-newreveal");
    node.dataset.rkey = key;
    App.revealed.add(key);
    node.classList.add("dealin", "awaiting");
    node.style.animationDelay = i * 60 + "ms";
    node.addEventListener("animationend", () => {
      node.classList.remove("dealin");
      node.style.animationDelay = "";
    }, { once: true });
  });
  const flyIn = 480 + nodes.length * 60;
  let ende = 0;   // wann die LETZTE Aufdeckung wirklich fertig ist
  nodes.slice().reverse().forEach((node, i) => {
    const stil = (node.className.match(/\brv-(\w+)\b/) || [])[1] || "flip";
    ende = Math.max(ende, flyIn + i * 200 + revealDauer(stil));
    setTimeout(() => {
      if (!node.isConnected) return;
      node.classList.remove("awaiting");
      node.classList.add("revealed", "reveal-pop");
      playReveal(node);
      // Spieler: „JOKER!" genau dann, wenn ein Joker vor seinen Augen aufgedeckt
      // wird (der SL bekommt ihn schon beim Ziehen, siehe render()).
      if (App.role === "player" && node.querySelector(".card-svg.is-joker")) triggerJokerMoment();
      setTimeout(() => node.classList.remove("reveal-pop"), 650);
    }, flyIn + i * 200);
  });
  // Bis zum Ende der langsamsten Aufdeckung sperren. Vorher waren es pauschal
  // 700 ms nach dem Start der letzten Karte - Glutnebel und Splitter laufen aber
  // bis 1,5 s. Kam in der Luecke ein Update (z. B. der naechste Spieler deckt
  // auf), baute render() die Karte mitten in der Animation neu -> sie sprang.
  const lockMs = ende + 60;

  // Anti-Hakeln: die Aufdeckung gegen zwischenzeitliche Broadcasts abschirmen.
  // Der neueste Zustand wird gemerkt (App.pendingRender) und erst danach gerendert.
  // Eine laufende, laengere Sperre (die eigene Grosskarte) nie verkuerzen.
  if (lockMs > 0 && Date.now() + lockMs > (App.revealLockUntil || 0)) {
    App.revealLockUntil = Date.now() + lockMs;
    clearTimeout(App._revealFlush);
    App._revealFlush = setTimeout(() => {
      App.revealLockUntil = 0;
      if (App.pendingRender) { App.pendingRender = false; render(); }
    }, lockMs + 40);
  }
}

// --- Reorder-Slide (FLIP) ---------------------------------------------------

function captureRects() {
  const m = {};
  document.querySelectorAll(".combatant[data-cid]").forEach((e) => { m[e.dataset.cid] = e.getBoundingClientRect(); });
  return m;
}
function playFlip(prev) {
  document.querySelectorAll(".combatant[data-cid]").forEach((e) => {
    const o = prev[e.dataset.cid];
    if (!o) return;
    const n = e.getBoundingClientRect();
    const dx = o.left - n.left, dy = o.top - n.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    e.style.transition = "none";
    e.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      e.style.transition = "transform 0.42s cubic-bezier(.2,.7,.2,1)";
      e.style.transform = "";
    });
  });
}

// --- Kampfzonen: Token-Gleitanimation (FLIP, zentriert) ---------------------
function captureTokens() {
  const m = {};
  document.querySelectorAll(".zone-token[data-id]").forEach((e) => { m[e.dataset.id] = e.getBoundingClientRect(); });
  return m;
}
function playTokens(prev) {
  document.querySelectorAll(".zone-token[data-id]").forEach((e) => {
    const o = prev[e.dataset.id];
    if (!o) return;
    const n = e.getBoundingClientRect();
    const dx = o.left - n.left, dy = o.top - n.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    e.style.transition = "none";
    e.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      e.style.transition = "transform 0.42s cubic-bezier(.2,.7,.2,1)";
      e.style.transform = "";
    });
  });
}

// --- Kampfzonen: Panel + Token-Popup ----------------------------------------
function myCombatant() {
  if (!App.state || App.role !== "player") return null;
  return App.state.combatants.find((c) => c.playerId === App.myPlayerId) || null;
}
function zoneInitials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  const erst = (p[0] || "?").charAt(0).toUpperCase();
  const letzt = p.length > 1 ? p[p.length - 1] : "";
  // Durchnummerierte Gegner behalten ihre GANZE Nummer ("Ork 11" -> "O11").
  // Vorher zaehlte nur die erste Ziffer: Ork 1, 10, 11, 12 und 13 trugen
  // alle "O1" - ab zehn gleichen Gegnern waren sie nicht zu unterscheiden.
  if (/^\d+$/.test(letzt)) return erst + letzt;
  return (erst + letzt.charAt(0)).toUpperCase();
}
function zoneLabel(z) {
  const zs = App.state && App.state.zones;
  return (zs && zs[z]) ? `${zs[z].emoji} ${zs[z].label}` : String(z);
}
function zoneOptions(sel) {
  const zs = (App.state && App.state.zones) || (window.Zones && Zones.LABELS) || [];
  return zs.map((z, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${z.emoji} ${esc(z.label)}</option>`).join("");
}
// --- Gruppen ----------------------------------------------------------------
// "Die drei Orks" als eine Einheit: einmal ziehen, alle rücken nach.

// Gruppe -> Farbnummer (1..6), damit zusammengehörige Figuren im Zonen-Board
// dieselbe Umrandung tragen. Reihenfolge der Gruppenliste bestimmt die Farbe.
function gruppenFarben() {
  const m = {};
  ((App.state && App.state.groups) || []).forEach((g, i) => { m[g.id] = (i % 6) + 1; });
  return m;
}
function gruppenNamen() {
  const m = {};
  ((App.state && App.state.groups) || []).forEach((g) => { m[g.id] = g.name; });
  return m;
}

// Zielscheibe. Bewegung läuft AUSSCHLIESSLICH über das Antippen einer erreichbaren
// Bahn + Bestätigung (zweiter Tipp) – keine Sofort-Knöpfe mehr (Missclick-Schutz).
function renderZonesPanel() {
  const s = App.state;
  if (!s.combatants.length) return "";
  const mine = myCombatant();
  const mover = mine ? { id: mine.id, zone: Zones.zoneOf(mine), canMove: !mine.moved } : null;
  const isGM = App.role === "gm";
  const target = Zones.renderTarget(s.combatants, {
    zones: s.zones, activeId: s.activeId, interactive: true, mover, pending: App.pendingMove,
    draggable: isGM, groupIndex: gruppenFarben(), groupNames: gruppenNamen(),
    blurAnon: !isGM,        // der SL soll seine verdeckten Gegner lesen können
    auswahl: isGM ? App.auswahl : null,
  });
  // Rückmeldung zur Strg-Auswahl - sonst sammelt man blind.
  const auswahlHinweis = (isGM && App.auswahl.size)
    ? `<div class="auswahl-leiste">
         <b>${App.auswahl.size} ausgewählt</b>
         <span class="muted small">– einen davon auf eine Bahn ziehen, dann rücken alle</span>
         <button class="ghost small" data-act="auswahl-gruppe">Gruppe daraus machen</button>
         <button class="ghost small" data-act="auswahl-leeren">Auswahl aufheben</button>
       </div>`
    : "";
  const controls = mine
    ? `<div class="zone-hint">${mine.moved
        ? "Diesen Zug schon bewegt – warte auf die nächste Runde."
        : (App.pendingMove
            ? "Zum Bestätigen die markierte Bahn nochmal tippen (oder daneben zum Abbrechen)."
            : "Erreichbare Bahn tippen (1 = gratis · 2 = 🏃 Rennen) – dann nochmal tippen zum Bestätigen.")}</div>`
    : (isGM
        ? `<div class="zone-hint hilfe">Figur auf eine Bahn <b>ziehen</b> zum Umsetzen – gehört sie zu einer Gruppe, rückt die ganze Gruppe mit.
             Mit <b>Strg-Klick</b> mehrere sammeln und gemeinsam ziehen.</div>`
        : `<div class="zone-hint">Tippe ein Token für Infos.</div>`);
  // Am Handy ist das Board mit 20+ Figuren riesig. Es startet dort darum
  // eingeklappt (ein Tipp oeffnet es, die Wahl wird wie ueberall gemerkt);
  // beim SL bleibt es offen, er arbeitet staendig damit.
  const grossesBoard = App.role !== "gm" && s.combatants.length > 12;
  return section("zones", `Kampfzonen${grossesBoard ? ` <span class="muted small">(${s.combatants.length} Figuren)</span>` : ""}`,
    `${target}${isGM ? gruppenAblageHtml() : ""}${auswahlHinweis}${controls}`, !grossesBoard);
}

// Kleine Ablagefelder fuer Gruppen direkt unter dem Board - dort, wo Gegner und
// Verbuendete stehen. Sonst musste man fuers Gruppieren ins eigene Gruppen-Panel
// wechseln und die Figuren dort ein zweites Mal suchen. Zieht man auf
// „+ Neue Gruppe", entsteht sie gleich mit der Figur (bzw. der Strg-Auswahl).
function gruppenAblageHtml() {
  const s = App.state;
  const farben = gruppenFarben();
  const kaempfer = (s.combatants || []).filter((c) => !c.out);
  const feld = (g) => {
    const n = kaempfer.filter((c) => c.groupId === g.id).length;
    return `<div class="grp-ablage grp${farben[g.id]}${App.gruppeMenue === g.id ? " offen" : ""}" data-group="${g.id}"
      data-act="gruppe-menue" title="Klicken: umbenennen, bewegen, auflösen · Figur hierher ziehen = in „${esc(g.name)}" stecken">
      ${esc(g.name)} <span class="muted">${n}</span></div>`;
  };
  const gruppen = s.groups || [];
  return `<div class="grp-ablage-leiste">
    <span class="muted small">Gruppen:</span>
    ${gruppen.map(feld).join("")}
    ${gruppen.length ? `<div class="grp-ablage grp-frei" data-group="" title="Hierher ziehen = aus der Gruppe lösen">ohne Gruppe</div>` : ""}
    <div class="grp-ablage grp-neu" data-group-neu data-act="group-new" title="Klicken: leere Gruppe anlegen · Figur hierher ziehen: neue Gruppe mit ihr">+ Neue Gruppe</div>
  </div>${gruppenMenueHtml(kaempfer, farben)}`;
}

// Was früher das eigene Gruppen-Panel konnte (umbenennen, ganze Gruppe
// bewegen, auflösen, Mitglieder sehen), klappt jetzt unter dem angeklickten
// Gruppenfeld auf - ein Panel weniger in der linken Spalte.
function gruppenMenueHtml(kaempfer, farben) {
  const g = ((App.state && App.state.groups) || []).find((x) => x.id === App.gruppeMenue);
  if (!g) return "";
  const mitglieder = kaempfer.filter((c) => c.groupId === g.id);
  return `<div class="grp-menue grp${farben[g.id]}">
    <div class="row tight" style="align-items:center; gap:6px">
      <strong class="grow">${esc(g.name)}</strong>
      <button class="ghost small" data-act="group-rename" data-group="${g.id}">✎ Umbenennen</button>
      <select data-act="group-move" data-group="${g.id}" title="Ganze Gruppe hierhin setzen">
        <option value="">bewegen nach …</option>${zoneOptions(null)}</select>
      <button class="ghost small bad" data-act="group-delete" data-group="${g.id}" title="Gruppe auflösen (Figuren bleiben)">✕ Auflösen</button>
      <button class="ghost small" data-act="gruppe-menue" data-group="${g.id}" title="Schließen">▴</button>
    </div>
    <div class="grp-mitglieder" style="margin-top:6px">${mitglieder.map((c) => `<button type="button" class="grp-chip${App.auswahl.has(c.id) ? " ausgewaehlt" : ""}" draggable="true"
        data-drag-id="${c.id}" data-act="token-info" data-id="${c.id}" title="Auf „ohne Gruppe" ziehen = herauslösen">${esc(c.name)}</button>`).join("")
      || `<span class="muted small">Noch leer – Figuren vom Board auf das Feld „${esc(g.name)}" ziehen.</span>`}</div>
  </div>`;
}

// Info-Fenster beim Antippen eines Tokens (im #app, damit es pro Render frisch ist).
function renderTokenPopupOverlay() {
  if (!App.tokenPopupId || !App.state) return "";
  const c = App.state.combatants.find((x) => x.id === App.tokenPopupId);
  if (!c) return "";
  const mine = myCombatant();
  const isGM = App.role === "gm";
  const isOwn = !!(mine && mine.id === c.id);
  const isEnemyForPlayer = App.role === "player" && !isOwn && c.kind === "npc" && !c.ally;
  const st = c.status || {};
  const party = c.kind === "npc" ? (c.ally ? "Verbündeter" : "Gegner") : "Spieler";
  const wounds = st.out ? "ausgeschaltet" : (st.wounds ? `${st.wounds} (−${st.wounds})` : "0");
  const avatar = c.image ? `<img src="${esc(c.image)}" alt="">` : esc(zoneInitials(c.name));
  const badges = statusBadges(c);

  // Eigene Figur (Spieler): Hinweis statt Knöpfe – bewegt wird über die Bahnen.
  const moveHtml = (isOwn && !isGM)
    ? `<div class="zone-hint">${c.moved ? "Diesen Zug schon bewegt." : "Zum Bewegen eine erreichbare Bahn antippen und bestätigen."}</div>`
    : "";
  // SL: Standort direkt setzen (Aufstellung) – 5 Zonen-Knöpfe, aktuelle markiert.
  const zoneList = (App.state && App.state.zones) || (window.Zones && Zones.LABELS) || [];
  const zoneSetHtml = isGM ? `
      <div class="tp-sec">
        <div class="tp-sec-title">📍 Standort setzen</div>
        <div class="status-ctrl" style="flex-wrap:wrap; justify-content:center">
          ${zoneList.map((z, i) => `<button class="st-btn ${Zones.zoneOf(c) === i ? "on" : ""}" data-act="set-zone" data-id="${c.id}" data-zone="${i}">${z.emoji} ${esc(z.label)}</button>`).join("")}
        </div>
      </div>` : "";
  // SL: Treffer schnell setzen + entfernen. Wunden −/+ für JEDE Figur (auch zähe
  // Statisten). Statisten ohne vergebene Wunden bleiben unverändert.
  const woundBtn = `<span class="st-btn" style="pointer-events:none">🩸 ${st.wounds || 0}</span>`;
  const bq = bennyQuelle(c);
  const recoverBenny = (st.shaken && !st.out && bq && bq.n > 0)
    ? `<button class="st-btn" data-act="recover" data-id="${c.id}" data-benny="1" title="${bq.feind ? "Benny aus dem SL-Pool" : "Wild Card gibt einen Benny aus"} und ist sofort erholt">🪙➜✓ Benny</button>` : "";
  const recoverFree = (st.shaken && !st.out)
    ? `<button class="st-btn on-shaken" data-act="recover" data-id="${c.id}" data-benny="0" title="Erholungs-Probe geschafft (Willenskraft oder Konstitution)">✓ Erholt</button>` : "";
  const slHtml = isGM ? `
      <div class="tp-sec">
        <div class="tp-sec-title">Treffer anwenden</div>
        <div class="row" style="gap:8px; margin-bottom:8px">
          <button class="primary big" data-act="apply-hit" data-id="${c.id}" ${st.out ? "disabled" : ""} style="flex:1" title="Savage Worlds: nicht angeschlagen → Angeschlagen; schon angeschlagen → +1 Wunde">💥 Treffer!</button>
          <button class="good big" data-act="apply-heal" data-id="${c.id}" style="flex:1" title="Heilung: −1 Wunde (bzw. wieder wach / nicht mehr angeschlagen)">🩹 Heilung</button>
        </div>
        <div class="status-ctrl" style="flex-wrap:wrap; justify-content:center">
          <button class="st-btn ${st.shaken ? "on-shaken" : ""}" data-act="st-shaken" data-id="${c.id}">😵 Angeschlagen</button>
          ${recoverFree}${recoverBenny}
          ${woundBtn}
          <button class="st-btn ${st.out ? "on-out" : ""}" data-act="st-out" data-id="${c.id}">☠ ${st.out ? "Wieder wach" : "K.O."}</button>
        </div>
      </div>
      <button class="primary big ${c.benched ? "good" : ""}" data-act="bench" data-id="${c.id}" data-on="${c.benched ? 0 : 1}" style="width:100%;margin-top:10px">${c.benched ? "▶️ Wieder in den Kampf" : "⏸ Aus dem Kampf (pausieren)"}</button>
      <button class="ghost small bad" data-act="tp-remove" data-id="${c.id}" style="width:100%;margin-top:8px;font-size:0.78rem;padding:5px 10px;opacity:0.85">🗑 Ganz entfernen (Kick)</button>` : "";
  // Spieler greift einen Gegner an (Meldung an den SL).
  const attacked = (App.state.requests || []).some((r) => r.kind === "attack" && (r.detail || {}).targetId === c.id);
  const attackHtml = isEnemyForPlayer ? `
      <button class="primary big" data-act="attack-request" data-id="${c.id}" style="width:100%">⚔ Angreifen (Meldung an SL)</button>
      ${attacked ? `<div class="zone-hint">Angriff gemeldet ⏳</div>` : ""}` : "";

  return `<div class="token-popup">
    <div class="tp-card">
      <div class="tp-head">
        <div class="tp-avatar${c.image ? " zoomable" : ""}"${c.image ? ` data-act="open-image" data-url="${esc(c.image)}" data-name="${esc(c.name)}" title="Bild groß anzeigen"` : ""}>${avatar}</div>
        <div><strong>${esc(c.name)}</strong>${c.ran ? ` <span class="pill warn">Gerannt</span>` : ""}</div>
      </div>
      <div class="tp-rows">
        <div class="tp-row"><span>Partei</span><span>${party}</span></div>
        <div class="tp-row"><span>Zone</span><span>${esc(zoneLabel(Zones.zoneOf(c)))}</span></div>
        <div class="tp-row"><span>Wild Card</span><span>${c.isWildCard ? "Ja" : "Nein"}</span></div>
        ${c.isWildCard ? `<div class="tp-row"><span>Bennies</span><span>🪙 ${c.bennies || 0}</span></div>` : ""}
        <div class="tp-row"><span>Wunden</span><span>${esc(wounds)}</span></div>
      </div>
      ${badges ? `<div class="badges" style="margin-bottom:8px">${badges}</div>` : ""}
      ${moveHtml}${zoneSetHtml}${slHtml}${attackHtml}
      <button class="ghost" data-act="close-token-popup" style="width:100%;margin-top:10px">Schließen</button>
    </div>
  </div>`;
}

// --- Joker-Vollbild-Moment --------------------------------------------------


// Spieler: Wen greifst du an? Gegner nach Reichweite von nah nach fern, mit
// Zustand (angeschlagen/Wunden) und Standort. Verdeckte Gegner tragen ihren
// Tarnnamen (kommt so vom Server).
// Was gilt für MICH gegen dieses Ziel? Nahkampf nur, wenn beide im Getümmel
// stehen. Fernkampf nach Stefans Tischregel: Der Fernbereich ist der Platz der
// Fernkämpfer - bis dorthin (Nahkampf, Nahbereich, Fernbereich, egal auf
// welcher Seite) OHNE Abzug; steht einer von beiden im Weitbereich −2, stehen
// BEIDE im Weitbereich −4; außer Reichweite geht nichts.
function fernkampfAbzug(a, b) {
  const weiter = Math.max(a, b);
  if (weiter >= 4) return null;
  if (weiter <= 2) return 0;
  return a === 3 && b === 3 ? -4 : -2;
}
function angriffsArt(mine, ziel) {
  const ich = Zones.zoneOf(mine), er = Zones.zoneOf(ziel);
  if (ich === 0 && er === 0) return { art: "nah", text: "⚔ Nahkampf", titel: "Kämpfen gegen Parade" };
  const abzug = fernkampfAbzug(ich, er);
  if (abzug === null) return { art: "weg", text: "✗ zu weit", titel: "Außer Reichweite" };
  const t = abzug ? `−${-abzug}` : "±0";
  return { art: "fern", text: `🏹 ${t}`, titel: `Fernkampf ${abzug ? `mit ${t}` : "ohne Abzug"}` };
}
// Emoji bzw. Name einer Zone einzeln (zoneLabel liefert beides zusammen).
function zoneTeil(z, teil) {
  const zs = (App.state && App.state.zones) || (window.Zones && Zones.LABELS) || [];
  return (zs[z] && zs[z][teil]) || "";
}

// Spieler: Wen greifst du an? Gruppiert danach, wo die Gegner STEHEN (wie auf
// dem Board), von nah nach fern. An jedem Ziel steht, was für MICH gilt
// (Nahkampf, Fernkampf-Abzug oder zu weit) - vorher war nach Reichweite
// gruppiert, und aus dem Fernbereich standen Gegner im Getümmel unter
// „Fernbereich". Eigene Seite abgetrennt und zugeklappt.
function angriffWahlHtml(mine) {
  const s = App.state;
  const ich = Zones.zoneOf(mine);
  const lebt = (c) => !c.benched && !(c.status || {}).out;
  const nachOrt = (liste) => liste.slice().sort((x, y) => Zones.zoneOf(x) - Zones.zoneOf(y)
    || String(x.name).localeCompare(String(y.name), "de", { numeric: true }));
  const gegner = nachOrt(s.combatants.filter((c) => c.kind === "npc" && !c.ally && lebt(c)));
  const eigene = nachOrt(s.combatants.filter((c) => c.id !== mine.id && !(c.kind === "npc" && !c.ally) && lebt(c)));
  const chip = (c, freund) => {
    const st = c.status || {};
    const a = angriffsArt(mine, c);
    // Ins Getümmel schießen: bei einer 1 auf dem Fertigkeitswürfel trifft man
    // einen Nachbarn (Savage Worlds, „Unschuldige Umstehende").
    const getuemmel = a.art === "fern" && Zones.zoneOf(c) === 0;
    return `<button type="button" class="aw-ziel${st.shaken ? " angeschlagen" : ""}${freund ? " freund" : ""}${a.art === "weg" ? " zu-weit" : ""}"
        data-act="angriff-auf" data-id="${c.id}" title="${esc(a.titel)}">
      <span class="aw-oben"><span class="aw-name">${esc(c.name)}</span><span class="aw-art aw-${a.art}">${a.text}</span></span>
      <span class="aw-zustand">${st.shaken ? `<span title="angeschlagen">😵</span>` : ""}${st.wounds ? `<span class="aw-wunden" title="Wunden">🩸${st.wounds}</span>` : ""}${
        getuemmel ? `<span class="aw-warn" title="Bei einer 1 auf dem Fertigkeitswürfel trifft der Schuss jemanden daneben">⚠ ins Getümmel</span>` : ""}</span>
    </button>`;
  };
  const gruppen = (liste, freund) => [...new Set(liste.map((c) => Zones.zoneOf(c)))].map((z) => `<div class="aw-zone">
      <div class="aw-reichweite">${z === 4 ? `${zoneTeil(z, "emoji")} Außer Reichweite` : `${zoneTeil(z, "emoji")} Im ${esc(zoneTeil(z, "label"))}`}</div>
      <div class="aw-ziele">${liste.filter((c) => Zones.zoneOf(c) === z).map((c) => chip(c, freund)).join("")}</div></div>`).join("");
  const eigeneHtml = eigene.length ? `<div class="aw-eigene">
      <button type="button" class="aw-eigene-kopf" data-act="angriff-eigene">${App.angriffEigene ? "▾" : "▸"} Eigene Seite angreifen <span class="muted">(${eigene.length})</span></button>
      ${App.angriffEigene ? gruppen(eigene, true) : ""}</div>` : "";
  // Was geht von meinem Platz aus? (Regel siehe fernkampfAbzug)
  const moeglich = ich >= 4 ? "Von hier erreichst du niemanden – erst näher ran"
    : ich === 3 ? "Fernkampf −2, auf Gegner im Weitbereich −4 · Nahkampf erst im Getümmel"
    : `${ich === 0 ? "Nahkampf gegen alle im Getümmel · " : ""}Fernkampf ohne Abzug bis Fernbereich, Weitbereich −2${ich === 0 ? "" : " · Nahkampf erst im Getümmel"}`;
  return `<div class="angriff-wahl">
    <div class="aw-kopf">
      <strong>⚔ Wen greifst du an?</strong>
      <div class="muted small">Du stehst ${ich === 4 ? "außer Reichweite" : `im ${esc(zoneTeil(ich, "label"))}`} · ${moeglich}</div>
    </div>
    ${gruppen(gegner, false) || `<div class="muted small" style="margin-top:6px">Kein Gegner in Sicht.</div>`}
    ${eigeneHtml}
  </div>`;
}
function angriffMelden(id) {
  const tgt = findCombatant(id);
  const detail = { targetId: id };
  const label = "greift " + (tgt ? tgt.name : "?") + " an";
  // Nur das Ziel: Würfe und Schaden sagt der Spieler am Tisch an (Stefan).
  gmActionOrPlayer({ type: "request", kind: "attack", detail, label });
  return true;
}
// Ergebnis eines Angriffs (vom SL entschieden) - kurz und deutlich, blockiert nichts.
function showKampfToast(text) {
  const t = el(`<div class="kampf-toast">${esc(text)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5200);
}

function showMimiToast(text) {
  const t = el(`<div class="mimi-toast">🐈 ${esc(text || "Miau!")}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function triggerJokerMoment() {
  // Beide Joker kurz hintereinander aufgedeckt -> ein Blitz reicht.
  if (document.querySelector(".joker-moment")) return;
  const m = el(`<div class="joker-moment"><div class="jm-flash"></div><div class="jm-star">★</div><div class="jm-text">JOKER!</div></div>`);
  document.body.appendChild(m);
  setTimeout(() => m.remove(), 1900);
}

function timerRing() {
  return `<div class="ring-wrap">
    <svg class="ring" viewBox="0 0 100 100">
      <circle class="ring-bg" cx="50" cy="50" r="44"/>
      <circle class="ring-fg" id="ringfg" cx="50" cy="50" r="44"/>
    </svg>
    <div class="ring-text" id="timerval">…</div>
  </div>`;
}

// --- Talente ---------------------------------------------------------------

function talentBadges(talents) {
  const meta = (App.state && App.state.talents) || {};
  return (talents || []).map((t) => `<span class="tag">${esc(meta[t] ? meta[t].label : t)}</span>`).join("");
}

// SL: die Talente nur als ein Zeichen mit Anzahl, Namen im Tooltip. Als eigene
// Schildchen machten sie jede Zeile voll - im Kampf braucht der SL sie kaum,
// was sie an der Karte bewirkt haben, zeigt ohnehin die Karten-Spur daneben.
function talentKurz(talents) {
  const meta = (App.state && App.state.talents) || {};
  const namen = (talents || []).map((t) => (meta[t] ? meta[t].label : t));
  if (!namen.length) return "";
  return `<span class="tag talent-kurz" title="Talente: ${esc(namen.join(", "))}">✦ ${namen.length}</span>`;
}

// Die Talent-Spur selbst steckt in cards.js – SL-Ansicht (hier) und TV-Ansicht
// (tv.js) rendern sie identisch.
const talentTrail = (c) => Cards.trail(c);

// mitKarte = false: nur Hinweise, die nichts über die Karte verraten.
function activeHints(combatant, mitKarte = true) {
  const out = [];
  // (Der Hinweis „Angeschlagen: Erholungs-Probe" steht nicht mehr hier:
  // am Handy gibt es dafür einen eigenen Kasten mit Knöpfen, beim SL die
  // Zustands-Spalte und „✓ erholt" in der unteren Leiste.)
  // Hinweis-Talente, die bei passender Karte eingeblendet werden.
  const card = combatant.card;
  if (!card || !mitKarte) return out;
  const has = (t) => (combatant.talents || []).includes(t);
  const rankNum = { JOKER: 15, A: 14, K: 13, Q: 12, J: 11, "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2 }[card.rank];
  const isJoker = card.rank === "JOKER";
  if (isJoker) out.push("Joker: +2 auf alle Würfe & Schaden");
  if (has("berechnend") && rankNum <= 5) out.push("Berechnend: ignoriere 2 Abzüge");
  if (isJoker && has("maechtiger_hieb")) out.push("Mächtiger Hieb: doppelter Nahkampfschaden");
  if (isJoker && has("volltreffer")) out.push("Volltreffer: doppelter Fernkampfschaden");
  if (isJoker && has("energieschub")) out.push("Energieschub: +10 Machtpunkte");
  return out;
}

// --- Timer ------------------------------------------------------------------

function timerRemaining() {
  const s = App.state;
  if (!s || s.phase !== "running" || !s.timerEndsAt) return null;
  // Lokale Uhr um den Server-Versatz korrigieren -> überall gleiche Restzeit.
  return Math.max(0, s.timerEndsAt - (Date.now() + App.clockOffset));
}

setInterval(() => {
  const s = App.state;
  if (!s) return;
  const rem = timerRemaining();
  // Ring-Timer live aktualisieren, ohne alles neu zu rendern.
  const t = $("timerval");
  if (t && rem != null) {
    const total = s.timerSeconds * 1000;
    const sec = Math.ceil(rem / 1000);
    t.textContent = sec + "s";
    const low = rem <= total / 8;          // Warnbereich = letztes Achtel
    t.classList.toggle("low", low);
    const fg = $("ringfg");
    if (fg) {
      const frac = Math.max(0, Math.min(1, rem / total));
      fg.style.strokeDashoffset = (276.46 * (1 - frac)).toFixed(2);
      fg.classList.toggle("low", low);
    }
  }
  // Countdown in der SL-Leiste - dort steht jetzt die Zugsteuerung.
  const u = $("al-uhr");
  if (u) {
    if (rem == null) { u.textContent = ""; }
    else {
      u.textContent = Math.ceil(rem / 1000) + "s";
      u.classList.toggle("low", rem <= (s.timerSeconds * 1000) / 8);
    }
  }
  // Nur der SL-Client ist Timer-Autorität: bei Ablauf EINMAL Timeout melden
  // (Sperre pro timerEndsAt, sonst würde alle 250 ms weiter gefeuert und
  // mehrere Akteure auf einmal übersprungen).
  if (App.role === "gm" && rem === 0 && App._timedOutFor !== s.timerEndsAt) {
    App._timedOutFor = s.timerEndsAt;
    gmAction({ type: "timeout" });
  }
}, 250);

// --- Rendering --------------------------------------------------------------

function render() {
  if (!App.state || !App.role) return;
  const root = $("app");
  Cards.setJokerRunde(App.state.round);      // Joker-Stil bleibt je Runde fest

  // Joker-Moment: beim SL sofort, wenn ein Joker gezogen wurde (er sieht alle
  // Karten ohnehin offen). Beim Spieler NICHT hier - das verriet den Joker schon
  // beim Austeilen, bevor irgendwer aufgedeckt hatte. Dort feuert er erst, wenn
  // die Joker-Karte auf diesem Handy umgedreht wird (runReveals/revealBigCard).
  if (App.prevJokerFlash === null) App.prevJokerFlash = App.state.jokerFlash;
  else if (App.state.jokerFlash > App.prevJokerFlash) {
    App.prevJokerFlash = App.state.jokerFlash;
    if (App.role === "gm") triggerJokerMoment();
  }

  // Mimis Miau als kurzer, selbst-verschwindender Toast (nur Spieler).
  if (App.role === "player") {
    const mimi = (App.state.messages || []).filter((m) => m.sender === "mimi" && (m.target === "all" || m.target === App.myPlayerId));
    const latest = mimi[mimi.length - 1];
    if (App._lastMimiTs === undefined) App._lastMimiTs = latest ? latest.ts : 0;
    else if (latest && latest.ts > App._lastMimiTs) { App._lastMimiTs = latest.ts; showMimiToast(latest.text); }
    const kampf = (App.state.messages || []).filter((m) => m.sender === "kampf" && m.target === App.myPlayerId);
    const neu = kampf[kampf.length - 1];
    if (App._lastKampfTs === undefined) App._lastKampfTs = neu ? neu.ts : 0;
    else if (neu && neu.ts > App._lastKampfTs) { App._lastKampfTs = neu.ts; showKampfToast(neu.text); }
  }

  const prevRects = captureRects();
  const prevTokens = captureTokens();
  // Auswahl aufräumen: Figuren, die es nicht mehr gibt, still verwerfen.
  if (App.auswahl.size && App.state.combatants) {
    const da = new Set(App.state.combatants.map((c) => c.id));
    App.auswahl.forEach((id) => { if (!da.has(id)) App.auswahl.delete(id); });
  }
  Cards.renderStart();
  let html;
  try { html = (App.role === "gm" ? renderGM() + kontextMenueHtml() : renderPlayer()) + renderTokenPopupOverlay(); }
  finally { Cards.renderEnde(); }
  // Unveraendert? Dann den Bildschirm NICHT neu aufbauen. Jeder Neuaufbau ersetzt
  // alle Karten: laufende Animationen (Joker, Glanz, Glimmen) starten von vorn,
  // Bilder werden neu eingesetzt, und am Handy steht die Seite dafuer spuerbar
  // kurz still. Viele Server-Updates aendern an DIESER Ansicht gar nichts.
  // (Das Bild-Overlay unten haengt an <body> und wird trotzdem abgeglichen.)
  if (html !== App._letztesHtml || !root.firstChild) {
    App._letztesHtml = html;
    // Scrollbare Blätter (Zielwahl) behalten ihre Position - sonst sprang die
    // Liste bei jedem Server-Update nach oben.
    const scrollMerk = {};
    root.querySelectorAll("[data-scroll-merk]").forEach((e) => { scrollMerk[e.dataset.scrollMerk] = e.scrollTop; });
    root.innerHTML = html;
    root.querySelectorAll("[data-scroll-merk]").forEach((e) => {
      if (scrollMerk[e.dataset.scrollMerk]) e.scrollTop = scrollMerk[e.dataset.scrollMerk];
    });
    document.body.classList.toggle("blatt-offen", !!root.querySelector(".angriff-blatt"));
    // Platz für die fixierte Steuerleiste schaffen - über eine Klasse statt über
    // den CSS-Selektor :has(), damit es auch in älteren Browsern greift.
    document.body.classList.toggle("hat-leiste", !!root.querySelector(".aktionsleiste"));
    const dh = root.querySelector(".daumen-leiste .dl-haupt");
    const dSig = dh ? dh.innerHTML : "";
    if (dSig !== App._daumenSig) { App._daumenSig = dSig; App._daumenSeit = Date.now(); }
    document.body.classList.toggle("ziel-modus", App.role === "gm" && !!App.trefferWahl);
    kontextMenueEinpassen();
    runReveals();
    playFlip(prevRects);
    playTokens(prevTokens);
  }

  // Das Overlay haengt an <body> (nicht im #app-Root) und wird von render()
  // deshalb NICHT automatisch ersetzt -> vorher immer selbst aufraeumen.
  document.querySelectorAll(".overlay-img").forEach((n) => n.remove());
  if (App.overlayImage) {
    document.body.appendChild(el(
      `<div class="overlay-img" data-act="close-overlay">
         <img src="${esc(App.overlayImage)}">
         ${App.overlayName ? `<div class="overlay-name">${esc(App.overlayName)}</div>` : ""}
         <div class="overlay-hint">Tippen zum Schließen</div>
       </div>`
    ));
  }
}

// ---------- SL-Ansicht ----------

function renderGM() {
  const s = App.state;
  // Auch zeigen, wenn schon Figuren da sind: nach einem Neustart melden sich die
  // Handys sofort wieder an - frueher verschwand der Hinweis dadurch, bevor der
  // SL ihn sehen konnte, und der gespeicherte Kampf war nicht mehr erreichbar.
  const resume = s.hasSavedSession
    ? `<div class="panel"><div class="row spread">
         <div><strong>Gespeicherte Sitzung gefunden.</strong> <span class="muted">Letzten Kampf fortsetzen?</span></div>
         <div class="row tight">
           <button class="primary" data-act="resume">Fortsetzen</button>
           <button class="ghost" data-act="discard-session">Verwerfen</button>
         </div></div></div>`
    : "";
  const spalte = panelAnordnung();

  return `
    <div class="row spread sl-kopf" style="align-items:center; margin-bottom:10px">
      <h1 style="margin:0">Spielleiter · Sundered Skies Initiative</h1>
      <div class="row tight">
        ${anordnungIstStandard(spalte) ? "" : `<button class="ghost" data-act="anordnung-zuruecksetzen" title="Panels wieder in die ursprüngliche Reihenfolge bringen">↺ Anordnung zurücksetzen</button>`}
        ${kopfMenueHtml()}
        <button class="ghost" data-act="fokus" title="Alles ausser Kampf, Zonen und Reihenfolge zuklappen">
          ${App.fokus ? "▤ Alles zeigen" : "▣ Fokus auf den Kampf"}</button>
      </div>
    </div>
    ${resume}
    <div class="grid2">
      <div class="sp sp1" data-spalte="links">${spalte.links.map((k) => PANEL_BAU[k]()).join("")}</div>
      <div class="sp sp2" data-spalte="rechts">${spalte.rechts.map((k) => PANEL_BAU[k]()).join("")}</div>
    </div>
    ${renderAktionsleiste()}
    ${App.tastenHilfe ? tastenHilfeHtml() : ""}
    ${angriffPopupHtml()}
    <datalist id="effekt-vorschlaege">${EFFEKT_VORSCHLAEGE.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
}

// --- Panels selbst anordnen (nur SL) -----------------------------------------
// Jedes Panel laesst sich an seiner Ueberschrift auf einen anderen Platz ziehen,
// auch in die andere Spalte. Die Anordnung gilt pro Geraet (wie das Auf-/
// Zuklappen). Schluessel = data-sec des Panels.
const PANEL_BAU = {
  requests: () => renderRequestsPanel(),
  zones: () => renderZonesPanel(),
  message: () => renderMessagePanel(),
  bibliothek: () => renderBibliothekPanel(),
  connect: () => renderConnectPanel(),
  combat: () => renderOrderPanel(true),
};
const STANDARD_ANORDNUNG = {
  links: ["requests", "zones", "message", "bibliothek", "connect"],
  rechts: ["combat"],
};

// Gespeicherte Anordnung, bereinigt: unbekannte Panels fliegen raus, neue (aus
// einer spaeteren Version) kommen an ihren Standardplatz - sonst waere ein neues
// Panel nach einem Update bei jedem, der schon umsortiert hat, unsichtbar.
function panelAnordnung() {
  let gespeichert = null;
  try { gespeichert = JSON.parse(localStorage.getItem("panelAnordnung") || "null"); } catch { /* egal */ }
  if (!gespeichert || !Array.isArray(gespeichert.links) || !Array.isArray(gespeichert.rechts)) {
    return { links: STANDARD_ANORDNUNG.links.slice(), rechts: STANDARD_ANORDNUNG.rechts.slice() };
  }
  const gesehen = new Set();
  const sauber = (liste) => liste.filter((k) => PANEL_BAU[k] && !gesehen.has(k) && gesehen.add(k));
  const erg = { links: sauber(gespeichert.links), rechts: sauber(gespeichert.rechts) };
  ["links", "rechts"].forEach((sp) => STANDARD_ANORDNUNG[sp].forEach((k) => {
    if (!gesehen.has(k)) { erg[sp].push(k); gesehen.add(k); }
  }));
  return erg;
}
function anordnungIstStandard(a) {
  return JSON.stringify(a) === JSON.stringify(STANDARD_ANORDNUNG);
}
function panelVerschieben(key, zielSpalte, vorKey) {
  const a = panelAnordnung();
  a.links = a.links.filter((k) => k !== key);
  a.rechts = a.rechts.filter((k) => k !== key);
  const liste = a[zielSpalte];
  const i = vorKey ? liste.indexOf(vorKey) : -1;
  if (i >= 0) liste.splice(i, 0, key); else liste.push(key);
  try { localStorage.setItem("panelAnordnung", JSON.stringify(a)); } catch { /* egal */ }
  slAnsichtSichern();
  render();
}

function joinUrlHtml() {
  const info = App._info;
  if (!info) return "…";
  const urls = (info.urls && info.urls.length) ? info.urls : [info.url];
  const loopback = /127\.0\.0\.1/.test(info.ip || info.url || "");
  let html = `<code class="url">${esc(urls[0])}</code>`;
  if (urls.length > 1) {
    html += `<div class="muted small" style="margin-top:6px">Geht die nicht? Andere Adresse probieren (dieselbe muss zum WLAN des Handys passen):</div>`;
    html += urls.slice(1).map((u) => `<div style="margin-top:3px"><code class="url">${esc(u)}</code></div>`).join("");
  }
  if (info.prettyUrl) html += `<div class="muted small" style="margin-top:4px">oder <code class="url">${esc(info.prettyUrl)}</code></div>`;
  html += wlanHtml(info.wlan);
  if (loopback) {
    html += `<div class="pill bad" style="margin-top:8px">⚠ Keine WLAN-Adresse gefunden – ist der Laptop im WLAN? 127.0.0.1 erreicht keine Handys.</div>`;
  }
  return html;
}

// Womit funkt der Laptop gerade: Netzname, Band, Wi-Fi-Standard (4/5/6/6E/7),
// Rate, Signal. Anlass: Beim Gastgeber hing der Laptop im 2,4-GHz-Zusatznetz
// (Wi-Fi 4, 72 MBit/s), die iPhones je nach Empfang im 5-GHz-Hauptnetz – und
// „manchmal" kam keiner rein. Auf 2,4 GHz gelb, mit Tipp im Tooltip.
function wlanHtml(w) {
  if (!w || !w.ssid) return "";
  const teile = [w.band, w.standard, w.empfang ? `${w.empfang} Mbit/s` : "",
    w.signal != null ? `Signal ${w.signal} %` : ""].filter(Boolean).map(esc);
  const nur24 = /^2/.test(w.band || "");
  const tipp = nur24
    ? ` title="Nur 2,4 GHz – gibt es hier ein 5-GHz-Netz? Dann Laptop UND Handys dorthin, alle ins selbe WLAN."`
    : "";
  return `<div class="pill ${nur24 ? "warn" : ""}" style="margin-top:8px"${tipp}>📶 Laptop-WLAN: <b>${esc(w.ssid)}</b>${teile.length ? " · " + teile.join(" · ") : ""}</div>`;
}

function connectedPlayersHtml() {
  const players = (App.state && App.state.players) || [];
  if (!players.length) return `<div class="muted small" style="margin-top:10px">Noch niemand beigetreten.</div>`;
  const online = players.filter((p) => p.connected).length;
  const chips = players.map((p) =>
    `<span class="pill ${p.connected ? "good" : ""}" title="${p.connected ? "verbunden" : "offline"}">${p.connected ? "🟢" : "⚪"} ${esc(p.name)}</span>`
  ).join(" ");
  return `<div style="margin-top:10px">
    <div class="muted small">👥 ${online} von ${players.length} verbunden</div>
    <div class="badges" style="margin-top:4px">${chips}</div>
  </div>`;
}

// Nur Windows-SL: Warnung bei „öffentlichem" WLAN + Ein-Klick-Firewall-Freigabe.
// Sagt ehrlich, ob die Freigabe WIRKLICH steht – auf Firmen-Laptops scheitert
// sie oft an fehlenden Adminrechten, und „gestartet" wäre dann eine Lüge.
function firewallHtml() {
  const info = App._info;
  if (!info || !info.isWindows) return "";
  const pub = info.networkPublic === true;

  if (info.firewallRuleActive === true) {
    return `<div class="pill good" style="margin-top:10px">🔒 Firewall-Freigabe aktiv – gilt dauerhaft, auch in fremden WLANs.</div>`;
  }
  if (App._firewallFail) {
    return `<div class="pill bad" style="margin-top:10px">🔒 Freigabe hat nicht geklappt – vermutlich fehlen Administratorrechte.</div>
      <div class="muted small" style="margin-top:6px">Auf einem <b>Firmen-Laptop</b> ist das meist gesperrt. Dann läuft die App besser auf einem <b>anderen Laptop</b> – die Handys verbinden sich einfach dorthin. Sonst muss die IT Port 8000 eingehend freigeben.</div>
      <div class="row" style="margin-top:8px"><button class="ghost" data-act="firewall-allow">Nochmal versuchen</button></div>`;
  }
  if (App._firewallDone) {
    return `<div class="pill" style="margin-top:10px">🔒 Freigabe gestartet – bitte die Windows-Abfrage (UAC) bestätigen …</div>`;
  }

  const warn = pub
    ? `<div class="pill bad" style="margin-top:10px">⚠ Dein WLAN ist „Öffentlich" – Windows blockt evtl. eingehende Verbindungen der Handys.</div>`
    : "";
  const adminHinweis = info.isAdmin === false
    ? `<div class="muted small" style="margin-top:6px">Windows fragt dabei nach <b>Administratorrechten</b>. Auf einem Firmen-Laptop ist das oft gesperrt – dann startet die App besser jemand anderes.</div>`
    : "";
  return `${warn}
    <div class="row" style="margin-top:8px; align-items:center; gap:8px">
      <button class="${pub ? "primary" : "ghost"}" data-act="firewall-allow">🔒 Firewall für die App freigeben</button>
      <span class="muted small">Einmalig; gibt Port 8000 + Ausweich-Ports frei (Windows fragt per UAC).</span>
    </div>${adminHinweis}`;
}

// Ein Klick räumt den Bildschirm frei: alles zu, was gerade nicht am Tisch
// gebraucht wird. Nochmal klicken stellt den vorherigen Stand wieder her.
const FOKUS_BEHALTEN = new Set(["combat", "zones", "order", "requests"]);
function fokusUmschalten() {
  if (App.fokus) {
    App.collapsed = App.fokusVorher || {};
    App.fokus = false;
  } else {
    App.fokusVorher = { ...App.collapsed };
    document.querySelectorAll("details.section[data-sec]").forEach((d) => {
      if (!FOKUS_BEHALTEN.has(d.dataset.sec)) App.collapsed[d.dataset.sec] = true;
    });
    App.fokus = true;
  }
  try { localStorage.setItem("collapsed", JSON.stringify(App.collapsed)); } catch { /* egal */ }
  slAnsichtSichern();
  render();
}

// Ziehen & Ablegen (nur SL, nur Maus – auf dem Handy bleibt alles beim Tippen).
// Zwei Ziele: ein Kasten im Gruppen-Panel (Figur zuordnen) und eine Bahn im
// Zonen-Board (Figur bzw. ihre GANZE Gruppe umsetzen).
let gezogeneId = null;

// Panels verschieben. Eigene Variable, damit sich das nicht mit dem Figuren-
// Ziehen im Zonen-Board vermischt (das wertet nur gezogeneId aus).
let gezogenesPanel = null;

function panelEinfuegeStelle(e) {
  const sp = e.target.closest && e.target.closest(".grid2 .sp[data-spalte]");
  if (!sp) return null;
  // Das Panel, ueber dessen OBERER Haelfte die Maus steht, bekommt die Linie
  // ueber sich; sonst landet es dahinter (= vor dem naechsten).
  const panels = [...sp.querySelectorAll(":scope > details.section[data-sec]")]
    .filter((d) => d.dataset.sec !== gezogenesPanel);
  const vor = panels.find((d) => {
    const r = d.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  return { spalte: sp.dataset.spalte, spEl: sp, vor: vor || null };
}
function panelLinieWeg() {
  document.querySelectorAll(".einfuege-vor, .einfuege-ende").forEach((x) => x.classList.remove("einfuege-vor", "einfuege-ende"));
}

document.addEventListener("dragstart", (e) => {
  const kopf = e.target.closest && e.target.closest("[data-panel-zieh]");
  if (!kopf) return;
  gezogenesPanel = kopf.dataset.panelZieh;
  kopf.closest("details").classList.add("panel-wird-gezogen");
  // Beide Spalten sichtbar machen: eine LEERE Spalte war 0 Pixel hoch und
  // damit kein Ziel mehr - wer das letzte Panel herauszog, bekam nie wieder
  // eines hinein ("man kann nur die linke Seite anpassen").
  document.body.classList.add("panel-zieht");
  // Alle Panels auf ihre Ueberschrift zusammenklappen, damit die ganze Anordnung
  // auf einen Bildschirm passt: Mit gedrueckter Touchpad-Taste kann man nicht
  // gleichzeitig mit zwei Fingern scrollen. Erst im naechsten Takt - aendert
  // sich das Layout noch IN dragstart, bricht Chrome das Ziehen gern sofort ab.
  setTimeout(() => { if (gezogenesPanel) document.body.classList.add("panel-kompakt"); }, 0);
  try { e.dataTransfer.setData("application/x-panel", gezogenesPanel); e.dataTransfer.effectAllowed = "move"; } catch { /* egal */ }
});
document.addEventListener("dragover", (e) => {
  if (!gezogenesPanel) return;
  const stelle = panelEinfuegeStelle(e);
  if (!stelle) return;
  e.preventDefault();
  try { e.dataTransfer.dropEffect = "move"; } catch { /* egal */ }
  panelLinieWeg();
  if (stelle.vor) stelle.vor.classList.add("einfuege-vor");
  else stelle.spEl.classList.add("einfuege-ende");
});
document.addEventListener("drop", (e) => {
  if (!gezogenesPanel) return;
  e.preventDefault();
  e.stopImmediatePropagation();       // nicht als Figur ins Zonen-Board fallen lassen
  const stelle = panelEinfuegeStelle(e);
  const key = gezogenesPanel;
  gezogenesPanel = null;
  panelLinieWeg();
  panelZiehenEnde();
  if (stelle) panelVerschieben(key, stelle.spalte, stelle.vor ? stelle.vor.dataset.sec : null);
  // Nach dem Aufklappen ist die Seite wieder lang - das verschobene Panel in
  // Sicht holen und kurz aufleuchten lassen, sonst sucht man es.
  const da = document.querySelector(`details.section[data-sec="${key}"]`);
  if (da) {
    da.scrollIntoView({ block: "nearest" });
    da.classList.add("panel-abgelegt");
    setTimeout(() => da.classList.remove("panel-abgelegt"), 1200);
  }
}, true);
document.addEventListener("dragend", () => {
  if (!gezogenesPanel && !document.querySelector(".panel-wird-gezogen")) return;
  gezogenesPanel = null;
  panelLinieWeg();
  panelZiehenEnde();
  document.querySelectorAll(".panel-wird-gezogen").forEach((x) => x.classList.remove("panel-wird-gezogen"));
});
function panelZiehenEnde() {
  document.body.classList.remove("panel-zieht", "panel-kompakt");
}

// Am Bildschirmrand mitscrollen, solange etwas gezogen wird (Panel oder Figur).
// Waehrend des Ziehens scrollt weder das Touchpad noch - je nach Browser - das
// Mausrad; ohne das kommt man an ein Ziel ausserhalb des Bildes nicht heran.
// dragover feuert auch bei stillstehender Maus laufend, das reicht als Takt.
const RAND_SCROLL = 70;          // px vom Rand, ab denen gescrollt wird
document.addEventListener("dragover", (e) => {
  if (!gezogenesPanel && !gezogeneId) return;
  const h = window.innerHeight;
  let d = 0;
  if (e.clientY < RAND_SCROLL) d = -(RAND_SCROLL - e.clientY);
  else if (e.clientY > h - RAND_SCROLL) d = RAND_SCROLL - (h - e.clientY);
  if (d) window.scrollBy(0, Math.round(d / 2.5));
});

document.addEventListener("dragstart", (e) => {
  const el = e.target.closest && e.target.closest("[data-drag-id]");
  if (!el) return;
  gezogeneId = el.dataset.dragId;
  el.classList.add("wird-gezogen");
  // Gehört die Figur zur Strg-Auswahl, zeigen ALLE ausgewählten, dass sie
  // mitgehen - sonst glaubt man, nur die eine wandert.
  if (App.auswahl.has(gezogeneId)) {
    document.querySelectorAll("[data-drag-id]").forEach((x) => {
      if (App.auswahl.has(x.dataset.dragId)) x.classList.add("wird-gezogen");
    });
  }
  try { e.dataTransfer.setData("text/plain", gezogeneId); e.dataTransfer.effectAllowed = "move"; } catch { /* egal */ }
});

document.addEventListener("dragend", () => {
  gezogeneId = null;
  document.querySelectorAll(".wird-gezogen").forEach((x) => x.classList.remove("wird-gezogen"));
  document.querySelectorAll(".ablage-aktiv").forEach((x) => x.classList.remove("ablage-aktiv"));
});

function ablageZiel(e) {
  const t = e.target.closest && e.target.closest("[data-group], [data-zone], [data-group-neu]");
  return t || null;
}

document.addEventListener("dragover", (e) => {
  if (!gezogeneId) return;
  const ziel = ablageZiel(e);
  if (!ziel) return;
  e.preventDefault();                       // ohne das lehnt der Browser ab
  try { e.dataTransfer.dropEffect = "move"; } catch { /* egal */ }
  if (!ziel.classList.contains("ablage-aktiv")) {
    document.querySelectorAll(".ablage-aktiv").forEach((x) => x.classList.remove("ablage-aktiv"));
    ziel.classList.add("ablage-aktiv");
  }
});

document.addEventListener("drop", (e) => {
  const id = gezogeneId || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
  const ziel = ablageZiel(e);
  if (!id || !ziel) return;
  e.preventDefault();

  if (ziel.hasAttribute("data-group-neu")) {
    const ids = (App.auswahl.size && App.auswahl.has(id)) ? [...App.auswahl] : [id];
    gezogeneId = null;
    // Name erst nach dem Ablegen fragen - ein prompt() mitten im Ziehen blockiert.
    setTimeout(async () => {
      const name = await eingabe(`Name der neuen Gruppe? (${ids.length} ${ids.length === 1 ? "Figur" : "Figuren"})`, "Trupp", "Gruppe anlegen");
      if (!name) return;
      gmAction({ type: "group_create", name: name.trim(), ids });
      App.auswahl.clear();
    }, 0);
    return;
  }
  if (ziel.hasAttribute("data-zone")) {
    const zone = parseInt(ziel.dataset.zone, 10);
    const c = (App.state.combatants || []).find((x) => x.id === id);
    if (!c || isNaN(zone)) return;
    // Reihenfolge der Regeln: eine per Strg gesammelte Auswahl schlägt alles
    // andere - der SL hat sie ja gerade bewusst zusammengestellt.
    if (App.auswahl.size && App.auswahl.has(id)) {
      gmAction({ type: "set_zone_many", ids: [...App.auswahl], zone });
      App.auswahl.clear();
    } else if (c.groupId) {
      gmAction({ type: "group_move", group: c.groupId, zone });
    } else {
      gmAction({ type: "set_zone", id, zone });
    }
  } else {
    // In einem Gruppenkasten abgelegt (leerer Wert = herauslösen). Gehört die
    // gezogene Figur zur Strg-Auswahl, wandert die GANZE Auswahl mit.
    if (App.auswahl.size && App.auswahl.has(id)) {
      gmAction({ type: "group_assign_many", ids: [...App.auswahl], group: ziel.dataset.group || null });
      toast(`${App.auswahl.size} Figuren ${ziel.dataset.group ? "in die Gruppe gesteckt" : "aus ihren Gruppen gelöst"}`);
      App.auswahl.clear();
    } else {
      gmAction({ type: "group_assign", id, group: ziel.dataset.group || null });
    }
  }
  gezogeneId = null;
});

// ☰-Menü der Kopfleiste: Klick daneben schließt es, ebenso ein gewählter Punkt
// (außer „importieren" - dort öffnet der Klick erst den Dateidialog).
document.addEventListener("click", (e) => {
  const m = document.querySelector("details.kopf-menue[open]");
  if (!m) return;
  const drin = m.contains(e.target);
  if (!drin || (e.target.closest(".kopf-menue-inhalt button") && !e.target.closest("label"))) {
    setTimeout(() => { m.open = false; }, 0);
  }
});

// Kurze Rückmeldung, die von selbst verschwindet - für Kleinigkeiten wie
// "kopiert" ist ein alert() zu aufdringlich (muss weggeklickt werden).
let toastTimer = null;
function toast(text) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("sichtbar");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("sichtbar"), 2600);
}

// Adresse per WhatsApp/Teilen-Dialog verschicken. Der Text nennt bewusst das
// WLAN mit - ein Link auf 192.168.x.x nützt nichts, wenn das Handy woanders ist.
// Einladung für WhatsApp & Co. Der Link steht ALLEIN in einer Zeile und mit
// „http://" davor - nur so machen WhatsApp (Android wie iPhone) ihn zuverlässig
// antippbar; Text direkt daneben oder ohne http:// blieb es oft reiner Text.
// Vorweg der wichtigste Tipp gegen „plötzlich weg": mobile Daten aus.
function einladungstext() {
  const url = (App._info && App._info.url) || location.origin + "/";
  // Kein Emoji am Anfang: WhatsApp am PC zeigte den Würfel als „�".
  return `Sundered Skies – Initiative

So kommst du rein:
1) Mobile Daten AUSSCHALTEN (WLAN bleibt an) – sonst springt das Handy mitten im Spiel vom Tisch weg.
2) Ins gleiche WLAN wie mein Laptop.
3) Diesen Link antippen:

${url}

Lässt sich der Link nicht antippen? Lange drücken → Kopieren → in Chrome oder Safari oben einfügen.`;
}

// Einladung als BILD mit QR-Code. Warum: WhatsApp macht Links auf reine
// Zahlen-Adressen (192.168.…) nicht antippbar - es hielt die Adresse für eine
// Telefonnummer. Einen QR-Code im Bild erkennt dagegen jede Handy-Kamera am
// Tisch, und auf dem eigenen Handy die Fotos-App (iPhone) bzw. Google Lens
// (Android) - alles ohne Internet.
async function einladungsBild() {
  const url = (App._info && App._info.url) || location.origin + "/";
  const qr = new Image();
  qr.src = "/qr.png?t=" + Date.now();
  await new Promise((ok, fehler) => { qr.onload = ok; qr.onerror = fehler; });
  const B = 640, H = 900;
  const c = document.createElement("canvas");
  c.width = B; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#f4ead3"; g.fillRect(0, 0, B, H);
  g.fillStyle = "#3a2a18"; g.textAlign = "center";
  g.font = "bold 34px Georgia, serif";
  g.fillText("Sundered Skies – Initiative", B / 2, 62);
  g.font = "20px sans-serif";
  g.fillText("QR-Code scannen oder im Bild antippen", B / 2, 98);
  g.fillStyle = "#ffffff"; g.fillRect(B / 2 - 230, 120, 460, 460);
  g.imageSmoothingEnabled = false;          // QR scharf halten
  g.drawImage(qr, B / 2 - 220, 130, 440, 440);
  g.fillStyle = "#3a2a18";
  g.font = "bold 26px monospace";
  g.fillText(url, B / 2, 622);
  g.font = "20px sans-serif";
  g.textAlign = "left";
  [
    "1) Mobile Daten AUS (WLAN bleibt an)",
    "2) Ins gleiche WLAN wie der Laptop",
    "3) Am Tisch: Kamera auf den Code halten",
    "    Auf dem eigenen Handy: Bild öffnen –",
    "    iPhone: lange auf den Code drücken",
    "    Android: Google Lens im Bild",
  ].forEach((z, i) => g.fillText(z, 60, 680 + i * 32));
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

async function einladungsBildKopieren() {
  try {
    const bild = await einladungsBild();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": bild })]);
    toast("QR-Bild kopiert – in WhatsApp mit Strg+V einfügen.");
  } catch {
    // Kein Bild-Kopieren (älterer Browser): als Datei herunterladen.
    const bild = await einladungsBild();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(bild);
    a.download = "sundered-skies-einladung.png";
    document.body.appendChild(a); a.click(); a.remove();
    toast("QR-Bild gespeichert – in WhatsApp als Bild anhängen.");
  }
}

function qrGrossZeigen() {
  App.overlayImage = "/qr.png?t=" + Date.now();
  // Beim Spieler ist die eigene Adresse genau die richtige (er ist ja drin).
  App.overlayName = (App.role === "gm" && App._info && App._info.url) || location.origin + "/";
  const bar = $("skinbar");
  if (bar) bar.classList.remove("open");      // Menü zu, damit der Code frei liegt
  if (App.state) render(); else zeigeOverlayOhneStand();
}
// Vor dem ersten Server-Stand (z. B. auf der Beitrittsseite) läuft render()
// noch nicht - das Overlay dann direkt anhängen.
function zeigeOverlayOhneStand() {
  document.querySelectorAll(".overlay-img").forEach((n) => n.remove());
  document.body.appendChild(el(`<div class="overlay-img" data-act="close-overlay">
      <img src="${esc(App.overlayImage)}"><div class="overlay-name">${esc(App.overlayName)}</div>
      <div class="overlay-hint">Tippen zum Schließen</div></div>`));
}

async function einladungTeilen() {
  const text = einladungstext();
  // Mit Bild teilen, wenn der Browser das kann (Windows-Teilen-Dialog in
  // Edge/Chrome - dort ist WhatsApp dabei). Sonst nur der Text.
  try {
    const bild = await einladungsBild();
    const datei = new File([bild], "sundered-skies-einladung.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [datei] })) {
      await navigator.share({ files: [datei], text, title: "Sundered Skies – Initiative" });
      return;
    }
  } catch { /* abgebrochen oder nicht möglich -> Text-Weg */ }
  if (navigator.share) {
    try { await navigator.share({ title: "Sundered Skies – Initiative", text }); return; }
    catch { /* abgebrochen oder nicht erlaubt -> WhatsApp-Weg */ }
  }
  einladungWhatsApp();
}

function einladungWhatsApp() {
  window.open("https://wa.me/?text=" + encodeURIComponent(einladungstext()), "_blank", "noopener");
}

async function einladungKopieren() {
  const text = einladungstext();
  try {
    await navigator.clipboard.writeText(text);
    toast("Einladung kopiert – jetzt irgendwo einfügen.");
  } catch {
    // Ältere Browser / kein sicherer Kontext: Auswahl-Umweg.
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Einladung kopiert."); }
    catch { toast("Kopieren ging nicht – Adresse bitte abtippen."); }
    ta.remove();
  }
}

// Warnung, wenn der Laptop im laufenden Betrieb eine neue Adresse bekommen hat.
function adresswechselHtml() {
  if (!App._info || !App._info.addressChanged) return "";
  return `<div class="pill bad" style="margin-top:10px; display:block; line-height:1.5">
    ⚠ Die Netzwerk-Adresse dieses Laptops hat sich geändert (WLAN-Aussetzer oder
    Router-Neustart). Handys, die noch die alte Adresse offen haben, kommen nicht
    mehr durch – <b>QR-Code unten neu scannen lassen</b>.</div>`;
}

// Checkliste gegen Verbindungsabbrüche. Steht eingeklappt in der SL-Ansicht,
// damit man sie vor dem Spielabend einmal durchgeht statt mittendrin zu suchen.
// Die Checkliste „Damit die Verbindung hält" war ein eigenes Panel - fast nur
// Wissen, das man einmal liest. Jetzt zugeklappt unten im Beitritts-Panel, wo
// man bei Problemen ohnehin hinschaut. Offen/zu wird gemerkt (App.offeneUnter),
// sonst klappt sie beim naechsten Neuzeichnen (Spieler tritt bei) wieder zu.
function verbindungsHilfeHtml() {
  return `<details class="unter-klapp" data-merk="verbindung"${App.offeneUnter.has("verbindung") ? " open" : ""}>
    <summary>🛠 Verbindung klappt nicht? – Checkliste</summary>
    <div class="muted small" style="margin:6px 0 8px">Sofort prüfen: alle im <b>selben WLAN</b> (nicht Gast, nicht 2,4/5 GHz getrennt) ·
      Windows-Firewall erlaubt den Zugriff (Privat) · Router-Client-Trennung aus.</div>
    <ol class="stabil-liste">
      <li><b>Feste Adresse im Router vergeben.</b> Diesem Laptop eine feste IP zuweisen
        (Fritzbox: Netzwerk → Gerät → „Immer die gleiche IP-Adresse zuweisen"). Sonst kann er
        nach einem WLAN-Aussetzer eine neue Adresse bekommen, und die Handys finden ihn nicht mehr.</li>
      <li><b>WLAN-Stromsparen abschalten:</b> im App-Ordner <code>WLAN-Stromsparen-aus.bat</code>
        per Rechtsklick als Administrator ausführen. Sonst schaltet Windows die WLAN-Karte im Akkubetrieb ab.</li>
      <li><b>Handys: mobile Daten aus</b> (Flugmodus an, dann nur WLAN an). Hat das WLAN kein
        Internet, springen Handys still auf Mobilfunk – dann ist der Laptop unerreichbar.</li>
      <li><b>Bei Verbindungsverlust nicht neu laden</b> – die App kommt von selbst zurück.</li>
      <li><b>Handy-Display anlassen</b> bzw. Bildschirmsperre hochsetzen.</li>
      <li><b>Die App nicht aus OneDrive starten</b> und während des Spiels nicht neu starten.</li>
    </ol>
    <div class="muted small">Läuft trotzdem etwas schief: <code>data\\log.txt</code> neben der App
      verrät, ob die Anfragen der Handys überhaupt ankommen.</div>
  </details>`;
}

// Selten gebrauchte Werkzeuge (TV, Sicherung, Bilder aufräumen) im Menü der
// Kopfleiste statt im Beitritts-Panel - dort standen sie jeden Abend im Weg.
function kopfMenueHtml() {
  return `<details class="kopf-menue" data-merk="kopfmenue"${App.offeneUnter.has("kopfmenue") ? " open" : ""}>
    <summary title="Werkzeuge: TV-Modus, Sicherung, Bilder aufräumen">☰ Mehr</summary>
    <div class="kopf-menue-inhalt">
      <a href="/tv" target="_blank" rel="noopener"><button class="ghost">📺 TV-/Beamer-Modus öffnen</button></a>
      <a href="/api/export"><button class="ghost" title="Charaktere + Bibliotheken + Begegnungen, mit allen Bildern (Zip)">💾 Sicherung exportieren</button></a>
      <label class="ghost knopf-label" title="Zip-Sicherung (oder alte .json) einspielen">⤵ Sicherung importieren
        <input type="file" accept=".zip,application/zip,application/json,.json" data-act="pick-import" style="display:none"></label>
      <button class="ghost" data-act="bilder-aufraeumen" title="Löscht hochgeladene Bilder, die von keiner Figur mehr benutzt werden">🧹 Alte Bilder aufräumen</button>
      <button class="ghost" data-act="tasten-hilfe" title="Alle Tastenkürzel (Taste ?)">⌨ Tastenkürzel</button>
      ${versionLine()}
    </div>
  </details>`;
}

function renderConnectPanel() {
  return section("connect", "Beitritt für Spieler", `
    ${adresswechselHtml()}
    <div class="qrbox">
      <img src="/qr.png" alt="QR-Code" onerror="this.style.display='none'">
      <div>
        <div class="muted small">Handy-Kamera auf den QR-Code halten, oder im Browser öffnen:</div>
        <div class="small" style="margin-top:6px">${joinUrlHtml()}</div>
        <div class="muted small hilfe" style="margin-top:6px">Der Laptop hier ist automatisch Spielleiter.</div>
        <div class="row" style="margin-top:10px; flex-wrap:wrap; gap:6px">
          <button class="primary" data-act="einladung-bild" title="Bild mit QR-Code kopieren – in WhatsApp mit Strg+V einfügen">🖼 QR-Bild kopieren</button>
          <button class="ghost" data-act="einladung-teilen" title="Bild mit QR-Code über den Teilen-Dialog verschicken">📤 Teilen…</button>
          <button class="ghost" data-act="qr-gross" title="QR-Code bildschirmfüllend zum Scannen am Tisch">🔍 QR groß zeigen</button>
          <button class="ghost" data-act="einladung-whatsapp" title="Nur Text – WhatsApp macht die Adresse leider nicht antippbar">💬 Text per WhatsApp</button>
        </div>
        <div class="muted small hilfe" style="margin-top:6px">WhatsApp macht Zahlen-Adressen nicht antippbar – darum lieber das <b>QR-Bild</b> schicken.</div>
      </div>
    </div>
    ${connectedPlayersHtml()}
    ${firewallHtml()}
    ${verbindungsHilfeHtml()}`);
}

// Kampf-Steuerung (Body, ohne eigenes Panel) – wird oben in die Kampf&Initiative-Box gesetzt.
function renderControlBody() {
  const s = App.state;
  // Die Phase steht schon in der Leiste unten („Freigeben"/„Zug läuft") - hier
  // nur noch zeigen, solange es die Leiste nicht gibt (vor dem Austeilen).
  const anyCards = s.combatants.some((c) => c.card);
  const phasePill = anyCards ? "" : {
    idle: `<span class="pill">Bereit</span>`,
    running: `<span class="pill warn">Zug läuft</span>`,
    gate: `<span class="pill good">Freigabe ausstehend</span>`,
  }[s.phase] || "";
  // Austeilen ist nur am Rundenende (oder vor der ersten Runde) der Haupt-Knopf.
  // Mitten in der Runde stand er trotzdem gross an der besten Stelle - jetzt
  // rueckt er dann zur Seite und macht Platz für die Reihenfolge.
  const rundeDran = !s.round || !s.activeId;
  // Aufräum-Knopf nur zeigen, wenn es ausgeschaltete Gegner gibt (kein Dauer-Clutter).
  const defeated = s.combatants.filter((c) => c.kind === "npc" && !c.ally && (c.status || {}).out);
  const cleanupRow = defeated.length
    ? `<div class="row" style="margin-bottom:8px"><button class="ghost bad" data-act="clear-defeated" data-n="${defeated.length}" title="Sofort entfernen – spätestens bei der nächsten Runde verschwinden sie von selbst (keine Karte mehr)">🧹 ${defeated.length} ausgeschaltete${defeated.length === 1 ? "n Gegner" : " Gegner"} entfernen</button></div>`
    : "";
  // Alles in EINER Zeile: Austeilen (am Rundenende gross), dahinter kleine
  // Symbol-Knoepfe. Vorher zwei Zeilen mit breiten Text-Knoepfen - rund 80 px,
  // die in der Reihenfolge darunter fehlten. Was sie tun, steht im Tooltip.
  const zeigeAbraeumen = s.combatants.some((c) => c.kind === "npc" || !c.benched);
  return `
    ${cleanupRow}
    <div class="kampf-knoepfe">
      <button class="${rundeDran ? "primary" : "ghost small"}" data-act="new-round" ${rundeDran ? "" : 'title="Allen eine neue Karte austeilen"'}>🃏 ${s.round === 0 ? "Karten an ALLE austeilen" : rundeDran ? "Neue Runde – an ALLE austeilen" : "Neue Runde"}</button>
      ${phasePill}
      <span class="kampf-knoepfe-rest">
        <button class="ghost small symbol" data-act="undo" ${s.canUndo ? "" : "disabled"} title="Letzte Aktion rückgängig">↶</button>
        <button class="ghost small symbol bad" data-act="reset" title="Alles zurücksetzen (Karten einsammeln, Runde 0)">⟲</button>
        ${zeigeAbraeumen ? `<button class="ghost small symbol bad" data-act="clear-all" title="Kampf abräumen: Gegner und Verbündete entfernen, Spieler pausieren – die Zonen sind danach leer">🧹</button>` : ""}
      </span>
    </div>
    ${rundeDran ? `<div class="muted small hilfe">Teilt allen Teilnehmern (Spieler & Gegner) gleichzeitig eine neue Karte aus. Einzeln nachziehen geht mit 🔄 in der Liste.</div>` : ""}
    ${renderRundenHinweis()}`;
  // Aktueller Akteur, Freigeben/Weiter, Timer und die Schalter sind BEWUSST
  // nicht mehr hier: sie saßen mitten im Panel und wanderten bei jeder
  // Zustandsänderung auf und ab. Jetzt stehen sie in der fixierten Leiste
  // unten - immer an derselben Stelle.
}

// Nur noch der Sonderfall „Runde vorbei" bzw. „noch nichts ausgeteilt".
function renderRundenHinweis() {
  const s = App.state;
  const active = s.combatants.find((c) => c.id === s.activeId);
  const anyCards = s.combatants.some((c) => c.card);
  if (!anyCards) {
    return `<div class="muted small hilfe" style="margin-top:10px">Oben austeilen – danach steuerst du den Kampf über die Leiste am unteren Rand.</div>`;
  }
  if (!active && s.round > 0) {
    return `<div class="pill good" style="margin-top:10px; display:inline-block">✓ Runde ${s.round} beendet – alle waren dran</div>`;
  }
  return "";
}

// Mitlaufende Steuerleiste für den SL.
// Bei 20 Gegnern und 5 Spielern ist die Reihenfolge mehrere Bildschirme lang.
// Ohne diese Leiste müsste der SL für JEDE Figur runterscrollen (Treffer setzen)
// und wieder hoch (freigeben). Deshalb klebt hier alles, was pro Zug gebraucht
// wird, am unteren Rand - der aktuelle Akteur und seine Knöpfe.
function renderAktionsleiste() {
  const s = App.state;
  if (App.role !== "gm" || !s || !s.combatants.length) return "";
  const anyCards = s.combatants.some((c) => c.card);
  if (!anyCards) return "";                     // vor dem Austeilen nur Ballast

  const active = s.combatants.find((c) => c.id === s.activeId);

  // Runde durch: hier gehört der Austeilen-Knopf hin. Sonst müsste der SL nach
  // der letzten Figur wieder ganz nach oben scrollen, nur um weiterzumachen.
  if (!active) {
    if (!s.round) return "";
    return `<div class="aktionsleiste">
      <div class="al-wer">${rundenZaehler(s)}<span class="pill good">✓ Runde ${s.round} beendet – alle waren dran</span></div>
      <div class="al-haupt">
        <button class="primary big" data-act="new-round">🃏 Neue Runde – an ALLE austeilen</button>
      </div>
    </div>`;
  }

  const platz = s.combatants.findIndex((c) => c.id === active.id) + 1;
  const st = active.status || {};
  const gruppe = kartenGruppeVon(active);
  const anzeigeName = gruppe.length > 1 ? `${grundname(active.name)} ×${gruppe.length}` : active.name;
  // Angeschlagen? Dann gehört die Erholung JEDEN Zug an den Anfang - direkt hier.
  const bq = bennyQuelle(active);
  const erholen = st.shaken && !st.out && gruppe.length === 1 ? `
      <button class="st-btn erholt-knopf" data-act="recover" data-id="${active.id}" data-benny="0" title="Probe geschafft (Willenskraft oder Konstitution): nicht mehr angeschlagen">✓ erholt</button>
      ${bq ? `<button class="st-btn" data-act="recover" data-id="${active.id}" data-benny="1" ${bq.n > 0 ? "" : "disabled"}
        title="${bq.feind ? `Benny aus dem SL-Pool (${bq.n})` : `Eigenen Benny ausgeben (${bq.n})`} – sofort erholt">🪙</button>` : ""}` : "";
  const istNsc = active.kind === "npc";
  // Wer kommt danach? Der SL soll nicht suchen müssen, wen er als Nächstes
  // ansagen muss - pausierte und ausgeschiedene Figuren überspringen wir.
  const naechster = naechsterAkteur(s);

  const haupt = s.phase === "running"
    ? `<button class="good big" data-act="confirm-turn">Zug bestätigen ✓</button>`
    : (istNsc
        ? `<button class="primary big" data-act="skip-turn" title="Ohne Timer sofort zum nächsten">Weiter ⏭</button>
           <button class="ghost" data-act="release">Freigeben ▶</button>`
        : `<button class="primary big" data-act="release">Freigeben ▶</button>
           <button class="ghost" data-act="skip-turn" title="Ohne Timer sofort zum nächsten">Weiter ⏭</button>`);

  // Countdown kompakt in der Leiste - er saß vorher im Panel, das jetzt schlank ist.
  const uhr = s.phase === "running" && s.timerEndsAt
    ? `<span class="al-uhr" id="al-uhr">–</span>`
    // Angehalten (Spieler greift an/erholt sich und würfelt): zeigen, warum
    // nichts mehr herunterzählt. Ohne id - die Uhr-Schleife leert sonst den Text.
    : s.phase === "running" ? `<span class="al-uhr" title="Uhr angehalten – der Spieler würfelt. Weiter mit „Weiter“.">⏸</span>`
    : "";

  return `<div class="aktionsleiste">
    ${App.leisteEinstellungen ? leisteEinstellungenHtml() : ""}
    ${App.trefferWahl ? trefferWahlHtml(active) : ""}
    <div class="al-wer">
      ${rundenZaehler(s)}
      <span class="al-platz">${platz}</span>
      <button class="al-name${istNsc && !active.ally ? " feind" : ""}" data-act="zur-aktiven-zeile" title="Zur Zeile springen">${esc(anzeigeName)}</button>
      <span class="al-zustand">${st.shaken ? `<span class="tag" style="color:var(--warn);border-color:var(--warn)">😵</span>` : ""}${st.wounds ? `<span class="tag" style="color:var(--bad);border-color:var(--bad)">${st.wounds} 🩸</span>` : ""}</span>
      ${uhr}
      ${naechster
        ? `<span class="al-naechster" title="Kommt als Nächstes dran">danach: <b>${esc(naechster.name)}</b></span>`
        : `<span class="al-naechster">danach: <b>Rundenende</b></span>`}
    </div>
    <div class="al-knoepfe">
      ${erholen}
      <button class="st-btn treffer-knopf${App.trefferWahl ? " on" : ""}" data-act="treffer-wahl" title="${esc(active.name)} trifft jemanden: Ziel auswählen (Taste Z)">🎯<span class="tk-text"> Treffer</span></button>
      <button class="st-btn" data-act="apply-hit" data-id="${active.id}" title="${esc(active.name)} selbst getroffen: angeschlagen bzw. +1 Wunde (Taste T)">💥</button>
      <button class="st-btn" data-act="apply-heal" data-id="${active.id}" title="Heilung (Taste H)">🩹</button>
      <button class="st-btn ${st.shaken ? "on-shaken" : ""}" data-act="st-shaken" data-id="${active.id}" title="Angeschlagen">😵</button>
      <button class="st-btn ${st.out ? "on-out" : ""}" data-act="st-out" data-id="${active.id}" title="K.O.">☠</button>
      <button class="st-btn" data-act="redraw" data-id="${active.id}" title="Neue Karte">🔄</button>
      <button class="st-btn ${App.leisteEinstellungen ? "on" : ""}" data-act="leiste-einstellungen" title="Kampf-Einstellungen">⚙</button>
    </div>
    <div class="al-haupt">${haupt}</div>
  </div>`;
}

// „🎯 Treffer": Wer gerade dran ist, greift an - der SL tippt nur noch das Ziel
// an, statt die Figur in Liste oder Board zu suchen. Gegner stehen vorn, wenn
// ein Spieler dran ist (und umgekehrt). Ein vom Spieler gemeldetes Ziel ist
// hervorgehoben. Nach dem Treffer schließt die Wahl; mit Shift bleibt sie offen
// (Flächenschaden, mehrere Ziele).
function trefferWahlHtml(active) {
  const s = App.state;
  const gemeldet = new Set((s.requests || []).filter((r) => r.kind === "attack")
    .map((r) => (r.detail || {}).targetId));
  const ziele = s.combatants.filter((c) => !c.benched && !(c.status || {}).out && c.id !== active.id);
  const feind = (c) => c.kind === "npc" && !c.ally;
  const gegner = ziele.filter(feind);
  const freunde = ziele.filter((c) => !feind(c));
  const chip = (c) => {
    const st = c.status || {};
    const werte = kampfwerteText(c);
    return `<button type="button" class="treffer-ziel${feind(c) ? " feind" : ""}${gemeldet.has(c.id) ? " gemeldet" : ""}"
        data-act="treffer-auf" data-id="${c.id}" title="${gemeldet.has(c.id) ? "Vom Spieler als Ziel gemeldet · " : ""}Treffer mit der oben gewählten Stärke (Shift: Auswahl bleibt offen)">
        ${esc(c.name)}${st.shaken ? " 😵" : ""}${st.wounds ? ` <span class="treffer-wunden">${st.wounds}🩸</span>` : ""}${werte ? ` <span class="treffer-werte">${werte}</span>` : ""}</button>`;
  };
  const gruppe = (titel, liste) => liste.length
    ? `<div class="treffer-gruppe"><div class="muted small">${titel}</div><div class="treffer-chips">${liste.map(chip).join("")}</div></div>` : "";
  const angreiferIstFeind = feind(active);
  // Schaden mit Steigerung: angeschlagen PLUS je Steigerung eine Wunde. Erst
  // die Stärke wählen (Standard: einfacher Erfolg), dann das Ziel antippen.
  const stg = App.trefferSteigerung || 0;
  const staerke = [0, 1, 2, 3].map((n) => `<button type="button" class="treffer-stufe${n === stg ? " aktiv" : ""}"
      data-act="treffer-stufe" data-n="${n}" title="Taste ${n}">${n === 0 ? "Erfolg <small>😵</small>" : `+${n} Steigerung <small>😵+${n}🩸</small>`}</button>`).join("");
  return `<div class="al-treffer">
    <div class="row spread" style="align-items:center; margin-bottom:8px">
      <strong>🎯 ${esc(active.name)} trifft …</strong>
      <button class="ghost small" data-act="treffer-wahl">Schließen</button>
    </div>
    <div class="treffer-staerke">${staerke}${s.schadenRechnen ? `
      <label class="treffer-schaden" title="Schadenswurf eintippen: die App vergleicht mit der Robustheit des Ziels und rechnet die Steigerungen selbst aus">
        oder Schaden <input id="treffer-schaden" type="number" min="0" max="99" inputmode="numeric" value="${esc(App.trefferSchaden || "")}" placeholder="z. B. 14"></label>` : ""}</div>
    <div class="muted small" style="margin:-4px 0 8px">Ziel antippen – hier oder direkt im Kampfzonen-Board.</div>
    ${angreiferIstFeind
      ? gruppe("Spielerseite", freunde) + gruppe("Gegner", gegner)
      : gruppe("Gegner", gegner) + gruppe("Spielerseite", freunde)}
    ${ziele.length ? "" : `<div class="muted small">Niemand da, der getroffen werden kann.</div>`}
  </div>`;
}

function trefferAuf(id, offenLassen) {
  const S = App.state;
  const c = (S.combatants || []).find((x) => x.id === id);
  if (!c) return;
  const st = c.status || {};
  let stg = App.trefferSteigerung || 0;
  let zusatz = "";
  // Optional: Schaden eingetippt -> gegen die Robustheit rechnen (SWADE:
  // Schaden >= Robustheit = angeschlagen, je volle 4 darüber eine Steigerung).
  const schaden = S.schadenRechnen ? parseInt(App.trefferSchaden, 10) : NaN;
  const wiederZu = () => {
    App.trefferSteigerung = 0;
    App.trefferSchaden = "";
    if (!offenLassen) App.trefferWahl = false;
  };
  const meldungAbhaken = () => (S.requests || [])
    .filter((r) => r.kind === "attack" && (r.detail || {}).targetId === id)
    .forEach((r) => gmAction({ type: "resolve_request", id: r.id, apply: false }));
  if (!isNaN(schaden)) {
    const r = kampfwerte(c).r;
    if (r == null) {
      zusatz = ` (Robustheit unbekannt – Stärke „${stg ? `+${stg}` : "Erfolg"}" genommen)`;
    } else if (schaden < r) {
      toast(`🛡 ${c.name}: ${schaden} gegen Robustheit ${r} – kein Schaden`);
      meldungAbhaken();
      wiederZu();
      render();
      return;
    } else {
      stg = Math.floor((schaden - r) / 4);
      zusatz = ` (${schaden} gegen R ${r})`;
    }
  }
  gmAction({ type: "apply_hit", id, steigerungen: stg });
  // Gemeldeten Angriff auf dieses Ziel gleich als erledigt abhaken.
  meldungAbhaken();
  const wunden = (st.wounds || 0) + (stg || (st.shaken ? 1 : 0));
  // Gleiche Grenze wie am Server (max_wounds): Statisten nach Hausregel,
  // Wild Cards bei der 4. Wunde - dann sagt die Meldung „raus" statt Zahl.
  const grenze = c.isWildCard ? 4 : (S.statistenKo || 3);
  const raus = S.autoIncap !== false && wunden >= grenze;
  toast(`💥 ${c.name}: ${raus ? "ausgeschaltet ☠"
    : stg ? `angeschlagen + ${stg} ${stg === 1 ? "Wunde" : "Wunden"} (jetzt ${wunden})`
    : (st.shaken ? `${wunden}. Wunde` : "angeschlagen")}${zusatz} – rückgängig mit ↶`);
  wiederZu();
  render();
}

// Ein Spieler hat angegriffen: Fenster mit allem, was der SL zum Entscheiden
// braucht (Ziel, Werte, gemeldeter Schaden, Vorschlag). Ein Klick trägt das
// Ergebnis ein; der Spieler bekommt nur die Ergebnis-Meldung.
function angriffPopupHtml() {
  const s = App.state;
  const r = (s.requests || []).find((x) => x.kind === "attack" && !App.angriffSpaeter.has(x.id));
  if (!r) return "";
  const angreifer = s.combatants.find((c) => c.id === r.combatantId);
  const ziel = s.combatants.find((c) => c.id === (r.detail || {}).targetId);
  // Schaden sagt der Spieler am Tisch an; mit der Kampfhilfe tippt der SL ihn
  // hier ein und bekommt den Vorschlag (Feld überlebt das Neuzeichnen).
  const schadenRoh = s.schadenRechnen ? parseInt(App.angriffSchaden, 10) : NaN;
  const schaden = isNaN(schadenRoh) ? null : schadenRoh;
  // Parade/Robustheit groß, damit der SL den Wurf sofort vergleichen kann
  // (vorher nur ein kleines „P 6 · R 8(2)"). Nur was eingetragen ist.
  const kw = ziel ? kampfwerte(ziel) : {};
  const wertKasten = (titel, zahl, zusatz) => zahl == null ? ""
    : `<div class="ap-wert"><span class="ap-wert-titel">${titel}</span><b>${zahl}</b>${zusatz ? `<small>${zusatz}</small>` : ""}</div>`;
  const werte = wertKasten("🛡 Parade", kw.p, "")
    + wertKasten("💪 Robustheit", kw.r, kw.panzer ? `davon ${kw.panzer} Panzer` : "");
  const zst = ziel ? (ziel.status || {}) : {};
  // Vorschlag aus gemeldetem Schaden gegen die Robustheit (nur mit Kampfhilfe)
  let vorschlag = null, vorschlagText = "";
  const rob = ziel ? kampfwerte(ziel).r : null;
  if (s.schadenRechnen && schaden != null && rob != null) {
    if (schaden < rob) { vorschlag = "kein"; vorschlagText = `${schaden} gegen Robustheit ${rob} → kein Schaden`; }
    else {
      vorschlag = Math.floor((schaden - rob) / 4);
      vorschlagText = `${schaden} gegen Robustheit ${rob} → ${vorschlag ? `+${vorschlag} Steigerung${vorschlag > 1 ? "en" : ""}` : "Erfolg (angeschlagen)"}`;
    }
  }
  const knopf = (ergebnis, stg, text, extra = "") => {
    const vorgeschlagen = (ergebnis === "kein_schaden" && vorschlag === "kein") || (ergebnis === "treffer" && vorschlag === stg);
    return `<button class="ap-knopf ${extra}${vorgeschlagen ? " vorschlag" : ""}" data-act="angriff-ergebnis" data-id="${r.id}"
      data-ergebnis="${ergebnis}" data-stg="${stg}">${text}</button>`;
  };
  const aktiv = angreifer && s.activeId === angreifer.id;
  const weitere = (s.requests || []).filter((x) => x.kind === "attack").length - 1;
  return `<div class="angriff-popup-hg">
    <div class="angriff-popup panel">
      <div class="ap-titel">⚔ Angriff${weitere > 0 ? ` <span class="muted small">(+${weitere} weitere)</span>` : ""}</div>
      <div class="ap-wer"><b>${esc(angreifer ? angreifer.name : r.name)}</b> greift <b class="ap-ziel">${esc(ziel ? ziel.name : "?")}</b> an</div>
      ${werte ? `<div class="ap-werte">${werte}</div>` : ""}
      <div class="ap-infos">
        ${zst.shaken ? `<span class="tag" style="color:var(--warn);border-color:var(--warn)">😵 angeschlagen</span>` : ""}
        ${zst.wounds ? `<span class="tag" style="color:var(--bad);border-color:var(--bad)">${zst.wounds} 🩸</span>` : ""}
      </div>
      ${s.schadenRechnen ? `<label class="treffer-schaden ap-schadenfeld" title="Angesagten Schaden eintippen – die App vergleicht mit der Robustheit">
        Angesagter Schaden <input id="angriff-schaden" type="number" min="0" max="99" inputmode="numeric" value="${esc(App.angriffSchaden || "")}" placeholder="z. B. 14"></label>` : ""}
      ${vorschlagText ? `<div class="ap-vorschlag">Vorschlag: ${vorschlagText}</div>` : ""}
      <div class="ap-knoepfe">
        ${knopf("daneben", 0, "✗ Daneben", "ghost")}
        ${knopf("kein_schaden", 0, "🛡 Kein Schaden", "ghost")}
        ${knopf("treffer", 0, "💥 Erfolg <small>😵</small>")}
        ${knopf("treffer", 1, "+1 <small>😵+1🩸</small>")}
        ${knopf("treffer", 2, "+2 <small>😵+2🩸</small>")}
        ${knopf("treffer", 3, "+3 <small>😵+3🩸</small>")}
      </div>
      <div class="row spread" style="align-items:center; margin-top:10px">
        ${aktiv ? `<label class="row tight" style="align-items:center; cursor:pointer; gap:6px">
          <input type="checkbox" id="angriff-zugende" data-act="angriff-zugende" ${App.angriffZugEnde ? "checked" : ""} style="width:auto">
          <span class="small">Zug von ${esc(angreifer.name)} danach beenden</span></label>` : "<span></span>"}
        <button class="ghost small" data-act="angriff-spaeter" data-id="${r.id}" title="Fenster schließen – die Meldung bleibt unter „Anfragen" stehen">Später</button>
      </div>
    </div>
  </div>`;
}

// Übersicht aller Tastenkürzel (Taste ? oder ☰ Mehr). Viele Kürzel kannte
// man sonst nur aus dem Kleingedruckten in den Kampf-Einstellungen.
function tastenHilfeHtml() {
  const zeile = (tasten, text) => `<tr><td>${tasten.map((t) => `<kbd>${t}</kbd>`).join(" ")}</td><td>${text}</td></tr>`;
  return `<div class="tasten-hilfe-hg" data-act="tasten-hilfe">
    <div class="tasten-hilfe panel" data-act="">
      <div class="row spread" style="align-items:center; margin-bottom:8px">
        <strong>⌨ Tastenkürzel</strong>
        <button class="ghost small" data-act="tasten-hilfe">Schließen</button>
      </div>
      <table>
        ${zeile(["Leertaste"], "Zug freigeben bzw. bestätigen · am Rundenende: neue Runde austeilen")}
        ${zeile(["Enter"], "wie Leertaste")}
        ${zeile(["W"], "Weiter: Zug beenden ohne Timer")}
        ${zeile(["Z"], "🎯 Treffer: Ziel wählen – wen trifft der Aktive?")}
        ${zeile(["0", "1", "2", "3"], "in der Zielwahl: Erfolg / +1 / +2 / +3 Steigerungen")}
        ${zeile(["T"], "Der Aktive selbst wird getroffen (angeschlagen bzw. +1 Wunde)")}
        ${zeile(["H"], "Der Aktive wird geheilt")}
        ${zeile(["Strg", "Klick"], "Figuren sammeln (Board oder Liste), dann gemeinsam ziehen")}
        ${zeile(["Rechtsklick"], "auf Figur (Liste oder Board): Treffer, Heilen, Zustand, Bennies … direkt an der Maus")}
        ${zeile(["Esc"], "Zielwahl schließen · Strg-Auswahl aufheben · dieses Fenster schließen")}
        ${zeile(["?"], "Diese Übersicht")}
      </table>
    </div>
  </div>`;
}

// Die Schalter saßen mitten im Kampf-Panel und haben dort bei jeder Änderung
// alles darunter verschoben. Hier stören sie nicht und sind trotzdem in Reichweite.
function leisteEinstellungenHtml() {
  const s = App.state;
  const hilfe = (name, an, text, titel) => `<label class="row tight" style="align-items:center; margin-top:6px; cursor:pointer" title="${titel}">
      <input type="checkbox" data-act="toggle-kampfhilfe" data-name="${name}" ${an ? "checked" : ""} style="width:auto">
      <span class="small">${text}</span></label>`;
  return `<div class="al-einstellungen">
    <div class="row spread" style="align-items:center; margin-bottom:8px">
      <strong>Kampf-Einstellungen</strong>
      <button class="ghost small" data-act="leiste-einstellungen">Schließen</button>
    </div>
    <label class="field" style="width:170px; margin-bottom:10px">
      <span>Zeit pro Zug (Sek.)</span>
      <input type="number" min="1" max="600" value="${s.timerSeconds}" data-act="set-timer">
    </label>
    <label class="field" style="width:170px; margin-bottom:10px" title="Gilt beim Auffrischen und für neue Charaktere; Glück/Großes Glück kommen dazu">
      <span>Bennies je Wildcard (Start)</span>
      <input type="number" min="0" max="20" value="${s.bennyStart}" data-act="set-benny-start">
    </label>
    <label class="row tight" style="align-items:center; cursor:pointer">
      <input type="checkbox" data-act="toggle-auto-incap" ${s.autoIncap ? "checked" : ""} style="width:auto">
      <span class="small">Zu viele Wunden → automatisch „Ausgeschaltet"</span>
    </label>
    <label class="row tight" style="align-items:center; margin-top:6px; gap:6px"
           title="Wild Cards (Spieler, Bosse) sind immer bei der 4. Wunde raus">
      <span class="small">Statisten raus bei der</span>
      <select data-act="set-statisten-ko" style="width:auto">${[1, 2, 3].map((n) =>
        `<option value="${n}"${(s.statistenKo || 3) === n ? " selected" : ""}>${n}.</option>`).join("")}</select>
      <span class="small">Wunde (Wild Cards bei der 4.)</span>
    </label>
    <label class="row tight" style="align-items:center; margin-top:6px; cursor:pointer"
           title="Spart bei vielen Gegnern einen Klick pro Figur">
      <input type="checkbox" data-act="toggle-auto-release" ${s.autoRelease ? "checked" : ""} style="width:auto">
      <span class="small">Nächsten Zug automatisch freigeben</span>
    </label>
    <label class="row tight" style="align-items:center; margin-top:6px; cursor:pointer">
      <input type="checkbox" data-act="toggle-conditions" ${s.conditionsEnabled !== false ? "checked" : ""} style="width:auto">
      <span class="small">Zustände verwenden (Verwundbar, Abgelenkt, Am Boden, Betäubt)</span>
    </label>
    <label class="row tight" style="align-items:center; margin-top:6px; cursor:pointer">
      <input type="checkbox" data-act="toggle-requests" ${s.requestsEnabled !== false ? "checked" : ""} style="width:auto">
      <span class="small">Spieler dürfen anfragen (Benny, Angeschlagen, Wunden …)</span>
    </label>
    <label class="row tight" style="align-items:center; margin-top:6px; cursor:pointer">
      <input type="checkbox" data-act="toggle-benny-to-gm" ${s.bennyToGm !== false ? "checked" : ""} style="width:auto">
      <span class="small">Ausgegebener Spieler-Benny wandert in den SL-Pool</span>
    </label>
    <div class="kampfhilfen" style="margin-top:12px">
      <div class="muted small" style="margin-bottom:2px">Optionale Kampfhilfen</div>
      ${hilfe("schadenRechnen", s.schadenRechnen, "🎯 Schaden eintippen – App rechnet mit der Robustheit",
        "In der Treffer-Auswahl und im Angriffs-Fenster gibt es ein Schadensfeld; Steigerungen rechnet die App aus der Robustheit der Vorlage bzw. dem Charakterbogen")}
      ${hilfe("spielerAngriff", s.spielerAngriff !== false, "⚔ Spieler greifen am Handy selbst an (Ziel wählen, SL entscheidet)",
        "Der Spieler tippt „Angreifen“ und wählt das Ziel; beim SL öffnet sich das Angriffs-Fenster. Aus: Handy zeigt nur „Zug bestätigen“")}
      ${hilfe("gruppenKarte", s.gruppenKarte, "🃏 Gleiche Statisten teilen sich eine Karte",
        "Savage Worlds: z. B. alle Orks handeln gemeinsam auf einer Karte (ab der nächsten Runde). Wild Cards bekommen immer eine eigene")}
    </div>
    <div class="muted small" style="margin-top:10px">Alle Tastenkürzel: Taste <kbd>?</kbd></div>
  </div>`;
}

// Wechselt der aktive Akteur, die passende Zeile ins Bild holen - sonst sucht
// der SL sie bei 25 Figuren jedes Mal von Hand. Erst NACH dem Neuzeichnen.
function pruefeAktivenWechsel() {
  if (App.role !== "gm" || !App.state) return;
  const jetzt = App.state.activeId;
  if (jetzt === App._letzterAktiver) return;
  App._letzterAktiver = jetzt;
  if (!jetzt) return;
  setTimeout(() => zurAktivenZeile(true, true), 80);
}

// Die aktive Zeile von selbst ins Bild holen - sonst sucht der SL sie bei
// 25 Figuren jedes Mal von Hand.
function zurAktivenZeile(sanft, nurWennNoetig) {
  const id = App.state && App.state.activeId;
  if (!id) return;
  const zeile = document.querySelector(`.order .combatant[data-cid="${id}"]`);
  if (!zeile) return;
  // Beim Durchklicken NICHT jedes Mal die Seite verschieben: steht die Zeile
  // schon sichtbar zwischen Kopfleiste und unterer Leiste, bleibt alles ruhig.
  if (nurWennNoetig) {
    const r = zeile.getBoundingClientRect();
    const leiste = document.querySelector(".aktionsleiste");
    const unten = leiste ? leiste.getBoundingClientRect().top : window.innerHeight;
    if (r.top >= 56 && r.bottom <= unten - 6) return;
  }
  const vorher = window.scrollY;
  try { zeile.scrollIntoView({ block: "center", behavior: sanft ? "smooth" : "auto" }); }
  catch { zeile.scrollIntoView(); }
  // Nachfassen: manche Browser ignorieren "smooth" KOMMENTARLOS - kein Fehler,
  // es passiert nur nichts. Hat sich nichts bewegt, obwohl die Zeile außerhalb
  // liegt, dann hart springen. Lieber ruckartig als gar nicht.
  setTimeout(() => {
    const r = zeile.getBoundingClientRect();
    const drin = r.top > 0 && r.bottom < window.innerHeight;
    if (!drin && Math.abs(window.scrollY - vorher) < 4) {
      try { zeile.scrollIntoView({ block: "center" }); } catch { zeile.scrollIntoView(); }
    }
  }, 500);
}

// Eine Zeile für alle Statisten auf derselben Gruppenkarte. Zustand als
// Zusammenfassung (😵 angeschlagen / 🩸 Wunden / ☠ raus), aufklappbar zu den
// einzelnen Figuren - dort gehen Treffer, Zustände usw. wie gewohnt.
function gruppenZeile(gruppe, nr, auf) {
  const s = App.state;
  const erster = gruppe[0];
  const st = (x) => x.status || {};
  const aktiv = gruppe.some((x) => x.id === s.activeId);
  const fertig = gruppe.every((x) => x.done || st(x).out);
  const raus = gruppe.filter((x) => st(x).out).length;
  const angeschl = gruppe.filter((x) => st(x).shaken && !st(x).out).length;
  const wunden = gruppe.reduce((n, x) => n + (st(x).out ? 0 : (st(x).wounds || 0)), 0);
  const zonen = [...new Set(gruppe.map((x) => Zones.zoneOf(x)))];
  const joker = erster.card && erster.card.suit === "joker";
  const naechster = !aktiv && gruppe.some((x) => x.id === App._naechsterId);
  const cls = ["combatant", "kartengruppe", erster.ally ? "ally" : "enemy", aktiv ? "active" : "",
    fertig ? "done" : "", joker ? "joker-holder" : "", naechster ? "naechster" : ""].filter(Boolean).join(" ");
  const name = grundname(erster.name);
  const zustand = [angeschl ? `<span title="angeschlagen">😵${angeschl}</span>` : "",
    wunden ? `<span class="gk-wunden" title="Wunden zusammen">🩸${wunden}</span>` : "",
    raus ? `<span class="z-raus" title="ausgeschaltet">☠${raus}</span>` : ""].join("");
  const kopf = `<div class="${cls}" data-cid="${erster.id}" data-gruppe="${esc(erster.card.id)}">
    <div class="idx">${nr}</div>
    <div class="mini">${cardSlot(erster.id, erster.card, {}, "", { open: true, tappable: false })}</div>
    <span class="avatar"><span class="av-init">${esc(zoneInitials(name))}</span></span>
    <div class="who">
      <div class="name">${esc(name)} <span class="gk-anzahl">×${gruppe.length}</span></div>
      <div class="badges">
        ${zonen.length === 1 ? `<span class="tag zone-chip z${zonen[0]}">${esc(zoneLabel(zonen[0]))}</span>`
          : `<span class="tag" title="Die Figuren stehen in verschiedenen Zonen">${zonen.length} Zonen</span>`}
        ${naechster ? `<span class="tag naechster-tag">↓ danach</span>` : ""}
        ${joker ? `<span class="tag joker-badge">★ JOKER</span>` : ""}
        <span class="tag" title="Handeln gemeinsam auf einer Karte (Kampf-Einstellungen)">🃏 Gruppenkarte</span>
      </div>
    </div>
    <button type="button" class="zustand-zelle gk-zustand" data-act="gruppe-aufklappen" data-key="${esc(erster.card.id)}"
      title="Zustand der Gruppe – Klick zeigt die einzelnen Figuren">${zustand}</button>
    <div class="actions"><button class="ghost small${auf ? " on" : ""}" data-act="gruppe-aufklappen" data-key="${esc(erster.card.id)}"
      title="${auf ? "Einzelne Figuren zuklappen" : "Einzelne Figuren zeigen"}">${auf ? "▴" : "▾"}</button></div>
  </div>`;
  const mitglieder = auf ? gruppe.map((x) => combatantRow(x, "", true, true)
    .replace('<div class="combatant', '<div class="combatant gk-mitglied')).join("") : "";
  return kopf + mitglieder;
}

function renderRequestsPanel() {
  const s = App.state;
  if (!s.requests || !s.requests.length) return "";
  const rows = s.requests.map((r) => {
    const attack = r.kind === "attack";
    const actions = attack
      // Angriff ist reine Meldung: würfeln am Tisch, Ergebnis über das Ziel-Token setzen.
      ? `${(r.detail || {}).targetId ? `<button class="st-btn" data-act="angriff-oeffnen" data-id="${r.id}" title="Angriffs-Fenster öffnen: Daneben, Kein Schaden, Erfolg oder Steigerungen">⚔ Entscheiden</button>` : ""}
         <button class="st-btn on" data-act="req-dismiss" data-id="${r.id}" title="Daneben / erledigt">Erledigt ✓</button>`
      : `<button class="st-btn on" data-act="req-apply" data-id="${r.id}" title="Anwenden">✓</button>
         <button class="st-btn" data-act="req-dismiss" data-id="${r.id}" title="Ablehnen">✕</button>`;
    return `
    <div class="req-item">
      <div class="grow">
        <strong>${esc(r.playerName || r.name)}</strong> <span class="muted small">${esc(r.name)}</span>
        <div>${attack ? "⚔ " : ""}${esc(r.label || r.kind)}</div>
      </div>
      ${actions}
    </div>`;
  }).join("");
  return section("requests", `✋ Anfragen (${s.requests.length})`, rows);
}

function renderOrderPanel(isGM) {
  const s = App.state;
  if (s.combatants.length === 0) {
    // SL: Kampf-Steuerung trotzdem zeigen (Austeilen etc.), Initiative noch leer.
    if (isGM) {
      return section("combat", `Kampf & Initiative · Runde ${s.round}`,
        `${renderControlBody()}<hr class="combat-sep"><div class="muted">Noch keine Teilnehmer. Spieler treten per QR-Code bei (links unter „Beitritt für Spieler"), Gegner und Verbündete kommen links aus den Bibliotheken.</div>`);
    }
    return section("order", "Reihenfolge", `<div class="muted">Noch keine Teilnehmer. Spieler treten per QR-Code bei.</div>`);
  }
  const active = s.combatants.filter((c) => !c.benched);
  const benched = s.combatants.filter((c) => c.benched);
  // Pausierte („Nicht im Kampf") unten, ausgegraut, ohne Position.
  const benchRows = benched.length
    ? `<div class="order-divider">⏸ Nicht im Kampf${isGM && benched.length > 1
        ? ` <button class="ghost small" data-act="alle-wieder-rein" style="margin-left:8px" title="Alle pausierten Figuren zurück in den Kampf (z. B. nach „Kampf abräumen“)">▶️ Alle wieder rein</button>`
        : ""}</div>` + benched.map((c) => combatantRow(c, null, isGM, isGM)).join("")
    : "";
  // SL sieht Kampf-Steuerung + volle Reihenfolge in EINER Box.
  if (isGM) {
    // „Wer kommt danach" stand bisher nur in der Leiste unten - in der Liste
    // musste man es suchen. Jetzt traegt die Zeile selbst die Markierung.
    App._naechsterId = (naechsterAkteur(s) || {}).id || null;
    // Lange Listen (viele Gegner): auf Wunsch nur zeigen, wer noch dran ist.
    const fertig = active.filter((c) => c.done || (c.status || {}).out);
    const sichtbar = App.nurOffene ? active.filter((c) => !c.done && !(c.status || {}).out) : active;
    const filter = (active.length > 8 || App.nurOffene) && fertig.length
      ? `<button class="ghost small" data-act="nur-offene" title="Erledigte und ausgeschaltete Figuren ausblenden">${App.nurOffene ? `▦ alle zeigen (${fertig.length} versteckt)` : `▣ nur Offene (${fertig.length} erledigt)`}</button>`
      : "";
    // Gruppenkarte (optional): Mitglieder als EINE aufklappbare Zeile „Ork ×11".
    const eintraege = [];
    const erledigt = new Set();
    active.forEach((c) => {
      if (erledigt.has(c.id)) return;
      const gruppe = kartenGruppeVon(c);
      gruppe.forEach((x) => erledigt.add(x.id));
      eintraege.push(gruppe.length > 1 ? { gruppe } : { c });
    });
    let zeilenZahl = 0;
    const rows = eintraege.map((e, i) => {
      if (e.gruppe) {
        const offen = !e.gruppe.every((x) => x.done || (x.status || {}).out);
        if (App.nurOffene && !offen) return "";
        const auf = App.gruppeOffen.has(e.gruppe[0].card.id);
        zeilenZahl += 1 + (auf ? e.gruppe.length : 0);
        return gruppenZeile(e.gruppe, i + 1, auf);
      }
      if (!sichtbar.includes(e.c)) return "";
      zeilenZahl += 1;
      return combatantRow(e.c, i + 1, true, true);
    }).join("");
    return section("combat", `Kampf & Initiative · Runde ${s.round}`,
      `${renderControlBody()}<hr class="combat-sep">
       <div class="order-heading row spread"><span>Initiative-Reihenfolge</span>${filter}</div>
       <div class="order"><div class="order-raster" style="--zeilen:${Math.max(1, Math.ceil(zeilenZahl / 2))}">${rows}</div>${benchRows}</div>`);
  }
  // Spieler: Position nur für tischweit AUFGEDECKTE Karten. Verdeckte kommen ohne
  // Nummer in neutraler Reihenfolge nach unten -> verraten die Reihenfolge nicht.
  const openC = active.filter((c) => c.revealed);
  const hiddenC = active.filter((c) => !c.revealed)
    .slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  // Bei 20+ Figuren war die Liste am Handy zwei Bildschirme lang, und der
  // Spieler scrollte an allem vorbei. Darum standardmaessig nur der Ausschnitt
  // um das Geschehen: der Aktive, ein paar danach - und IMMER die eigene Figur.
  const mineId = (myCombatant() || {}).id;
  const aktivPos = openC.findIndex((c) => c.id === s.activeId);
  const kurz = (openC.length + hiddenC.length) > 8 && !App.alleZeigen;
  const von = kurz ? Math.max(0, (aktivPos < 0 ? 0 : aktivPos) - 1) : 0;
  const bis = kurz ? von + 6 : openC.length;
  const zeigen = (c, i) => !kurz || (i >= von && i < bis) || c.id === mineId;
  // „Du bist 6. von 25 - noch 3 vor dir": die Frage, die am Tisch am haeufigsten
  // kommt, ohne die ganze Liste durchzuzaehlen.
  const meinPlatz = openC.findIndex((c) => c.id === mineId);
  const vorMir = meinPlatz >= 0 ? openC.slice(0, meinPlatz).filter((c) => !c.done && !(c.status || {}).out).length : 0;
  const positionsZeile = meinPlatz >= 0
    ? `<div class="mein-platz">Du bist <b>${meinPlatz + 1}.</b> von ${openC.length + hiddenC.length}${
        s.activeId === mineId ? " – <b>du bist dran!</b>"
          : vorMir ? ` · noch <b>${vorMir}</b> vor dir` : " · du kommst als Nächstes"}</div>`
    : "";
  let body = positionsZeile + openC.map((c, i) => (zeigen(c, i) ? combatantRow(c, i + 1, false, true) : "")).join("");
  const versteckt = openC.filter((c, i) => !zeigen(c, i)).length;
  // Noch verdeckte Figuren sagen nichts über die Reihenfolge - davon reichen
  // im Kurzmodus ein paar, sonst füllen 20 Gegner den halben Bildschirm.
  let verdecktGekuerzt = 0;
  if (hiddenC.length) {
    const zeigenH = kurz ? hiddenC.filter((c, i) => i < 4 || c.id === mineId) : hiddenC;
    verdecktGekuerzt = hiddenC.length - zeigenH.length;
    body += `<div class="order-divider">${openC.length ? "Noch verdeckt" : "Noch niemand aufgedeckt – tippt eure Karte an!"}</div>`;
    body += zeigenH.map((c) => combatantRow(c, null, false, false)).join("");
  }
  const restlich = versteckt + verdecktGekuerzt;
  if (kurz && restlich) {
    body += `<button class="ghost small order-mehr" data-act="alle-zeigen">▾ Alle ${openC.length + hiddenC.length} zeigen (${restlich} weitere)</button>`;
  } else if (App.alleZeigen && (openC.length + hiddenC.length) > 8) {
    body += `<button class="ghost small order-mehr" data-act="alle-zeigen">▴ Weniger zeigen</button>`;
  }
  return section("order", "Initiative-Reihenfolge", `<div class="order">${body}${benchRows}</div>`);
}

// num: Positionsnummer (oder null = verdeckt, keine Position). isOpen: Karte offen?
function combatantRow(c, num, isGM, isOpen) {
  const s = App.state;
  const isActive = c.id === s.activeId;
  // Eigene Figur (nur Spieler): in einer langen Liste soll man sie sofort finden.
  const isOwn = !isGM && c.playerId && c.playerId === App.myPlayerId;
  const showCard = isGM || isOpen;                 // Karte offen sichtbar?
  // Karten-abgeleitete Infos (Joker/hält/Hinweise) NUR zeigen, wenn aufgedeckt.
  const hasJoker = showCard && c.card && c.card.suit === "joker";
  const cls = ["combatant",
    c.kind === "npc" ? (c.ally ? "ally" : "enemy") : "", isActive ? "active" : "",
    c.done ? "done" : "", (showCard && c.held) ? "held" : "", hasJoker ? "joker-holder" : "",
    (isGM && !isActive && App._naechsterId === c.id) ? "naechster" : "",
    (!isGM && isOwn) ? "eigene" : "",
    (isGM && App.auswahl.has(c.id)) ? "ausgewaehlt" : "",
    c.benched ? "benched" : "", showCard ? "" : "facedown"].filter(Boolean).join(" ");
  // In der Zeile knapp: "★ JOKER" steht schon daneben, der ausgeschriebene Satz
  // brach um und machte die Zeile doppelt so hoch. Voller Text im Tooltip.
  const hints = showCard ? activeHints(c).map((h) =>
    `<span class="tag" style="color:var(--gold);border-color:var(--gold)" title="${esc(h)}">${esc(h.replace(/^Joker: \+2 auf alle /, "+2 "))}</span>`).join("") : "";
  const jokerBadge = hasJoker ? `<span class="tag joker-badge">★ JOKER</span>` : "";
  const heldPill = (showCard && c.held) ? `<span class="pill warn">hält</span>` : "";
  // In der Zeile nur der Zustand (fest rechts) und "⋯" für den Rest. Früher
  // standen hier bis zu sieben Knöpfe, zuletzt noch Treffer/Heilung - zwei
  // bunte Knöpfe mal 25 Figuren. Treffer laufen jetzt über „🎯 Treffer" unten
  // bzw. Taste T; Treffer und Heilung stehen zusätzlich im ⋯-Feld.
  const gmActions = isGM ? `${zustandZelle(c)}<div class="actions">
      <button class="ghost small${App.rowStatusOpen.has(c.id) ? " on" : ""}" data-act="zustand-umschalten" data-id="${c.id}" title="Mehr: Treffer, Heilung, Zustände, Bennies, aktiv setzen, verdecken, pausieren, entfernen">⋯</button>
    </div>` : "";
  // Die seltenen Knöpfe - jetzt im "⋯"-Feld statt dauerhaft in der Zeile.
  const selteneKnoepfe = isGM ? `<div class="row tight" style="margin-bottom:8px; gap:6px">
      <button class="ghost small" data-act="set-active" data-id="${c.id}" title="Als aktiv setzen">▶ Aktiv setzen</button>
      ${c.kind === "npc" && !c.ally
        ? `<button class="ghost small${c.anon ? " on" : ""}" data-act="set-anon" data-id="${c.id}" data-on="${c.anon ? 0 : 1}" title="${c.anon ? "Aufdecken: Spieler sehen den echten Namen" : "Verdecken: Spieler sehen nur einen unlesbaren Namen"}">${c.anon ? "🫥 Aufdecken" : "👁 Verdecken"}</button>`
        : ""}
      <button class="ghost small" data-act="bench" data-id="${c.id}" data-on="${c.benched ? 0 : 1}" title="${c.benched ? "Wieder in den Kampf" : "Aus dem Kampf (pausieren)"}">${c.benched ? "▶️ Wieder rein" : "⏸ Pausieren"}</button>
      <button class="ghost small bad" data-act="remove-combatant" data-id="${c.id}" title="${c.playerId ? "Spieler entfernen (Kick)" : "Entfernen"}">✕ Entfernen</button>
    </div>` : "";
  const duTag = (!isGM && isOwn) ? `<span class="tag du-tag">Du</span>` : "";
  const naechsterTag = (isGM && !isActive && App._naechsterId === c.id)
    ? `<span class="tag naechster-tag" title="Kommt als Nächstes dran">↓ danach</span>` : "";
  const idxLabel = num != null ? num : `<span class="idx-hidden">?</span>`;
  const kuerzel = zoneInitials(c.name);
  const avImg = c.image ? `<img src="${esc(c.image)}" alt="">`
    : `<span class="av-init${kuerzel.length > 2 ? " eng" : ""}">${esc(kuerzel)}</span>`;
  const avatarEl = isGM
    ? `<label class="avatar" title="Bild wählen/ändern" style="cursor:pointer">${avImg}<input type="file" accept="image/*" data-act="pick-char-image" data-id="${c.id}" style="display:none"></label>`
    : (c.image ? `<span class="avatar${c.anon ? " verdeckt" : " zoomable"}"${c.anon ? "" : ` data-act="open-image" data-url="${esc(c.image)}" title="Bild groß anzeigen"`}><img src="${esc(c.image)}" alt=""></span>` : "");
  return `<div class="${cls}" data-cid="${c.id}">
    <div class="idx">${idxLabel}</div>
    <div class="mini">${cardSlot(c.id, c.card, c.status, "", { open: showCard, tappable: false })}</div>
    ${avatarEl}
    <div class="who">
      <div class="name">${c.anon && !isGM ? `<span class="verdeckt" title="Der Spielleiter hält verborgen, wer das ist">${esc(c.name)}</span>` : esc(c.name)}${isGM && c.playerName && c.playerName !== c.name ? ` <span class="spieler-name" title="Gespielt von">🎲 ${esc(c.playerName)}</span>` : ""} ${heldPill}</div>
      ${c.playerName && c.playerName !== c.name && !isGM ? `<div class="muted" style="font-size:0.72rem">🎲 ${esc(c.playerName)}</div>` : ""}
      ${isGM && c.note ? `<div class="combatant-note" title="SL-Notiz">📝 ${esc(c.note)}</div>` : ""}
      <div class="badges">
        ${c.benched
          ? `<span class="tag" style="color:var(--muted);border-color:var(--muted)">⏸ Nicht im Kampf</span>`
          : `<span class="tag zone-chip z${Zones.zoneOf(c)}">${esc(zoneLabel(Zones.zoneOf(c)))}</span>`}
        ${c.ally ? `<span class="tag" style="color:var(--good);border-color:var(--good)">🤝 Verbündet</span>` : ""}
        ${/* "verdeckt" hier statt direkt am Namen - dort nahm es dem Namen den
             Platz weg, und lange Namen brachen mitten im Wort um. */ ""}
        ${c.anon && isGM ? `<span class="tag" style="color:var(--muted);border-color:var(--muted)" title="Die Spieler sehen statt des Namens nur Unlesbares">🫥 verdeckt</span>` : ""}
        ${duTag}${naechsterTag}${jokerBadge}
        ${c.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)" title="Wild Card">WC</span>' : ""}
        ${showCard ? (isGM ? talentKurz(c.talents) : talentBadges(c.talents)) : ""}${showCard ? talentTrail(c) : ""} ${hints}
        ${bennyBadge(c)}
      </div>
      <div class="status-badges">${statusBadges(c, isGM)}${
        (isGM && isActive && (c.status || {}).shaken && !(c.status || {}).out)
          ? ` <button class="st-btn on-shaken" data-act="recover" data-id="${c.id}" data-benny="0" title="Angeschlagen aufheben (Willenskraft- oder Konstitutions-Probe geschafft)">✓ erholt</button>` +
            (c.isWildCard && (c.bennies || 0) > 0
              ? ` <button class="st-btn" data-act="recover" data-id="${c.id}" data-benny="1" title="Benny ausgeben & sofort erholt">🪙</button>` : "")
          : ""}</div>
    </div>
    ${gmActions}
    ${/* Zustände & Bennies nur, wenn per "⋯" geöffnet. Vorher stand der
          zugeklappte "Zustand"-Knopf in einer eigenen Zeile unter JEDER Figur
          und machte jede Zeile 32 px höher. */ ""}
    ${isGM && App.rowStatusOpen.has(c.id) ? `<div class="row-status" style="flex-basis:100%">
      <div class="panel-body">${selteneKnoepfe}${statusControls(c)} ${bennyControls(c)}${effektSteuerung(c)}</div>
    </div>` : ""}
    ${isGM && App.editCombatantId === c.id ? `<div style="flex-basis:100%">${combatantEditor(c)}</div>` : ""}
  </div>`;
}

// --- SL: Rechtsklick-Menü auf eine Figur -----------------------------------
// Rechtsklick auf Zeile oder Token: alles, was man mit der Figur tun kann, an
// der Maus - statt erst „⋯" aufklappen und in der Zeile suchen. Die Knöpfe
// sind dieselben (data-act) wie im ⋯-Feld; nach einem Klick geht das Menü zu,
// außer bei Dingen, die man oft mehrfach klickt (Bennies, Zustände).
function kontextMenueHtml() {
  const k = App.kontextMenue;
  const c = k && findCombatant(k.id);
  if (!c) { App.kontextMenue = null; return ""; }
  const st = c.status || {};
  const conds = (App.state && App.state.conditions) || {};
  const b = (act, text, extra = "", titel = "") =>
    `<button class="km-btn${extra ? " " + extra : ""}" data-act="${act}" data-id="${c.id}"${titel ? ` title="${esc(titel)}"` : ""}>${text}</button>`;
  const treffer = st.out ? "" : `<div class="km-zeile"><span class="km-label">💥 Treffer</span>
      ${[0, 1, 2, 3].map((n) => `<button class="km-btn km-treffer" data-act="km-treffer" data-id="${c.id}" data-n="${n}"
        title="${n ? `Angeschlagen + ${n} Wunde${n > 1 ? "n" : ""}` : "Angeschlagen (bzw. +1 Wunde, wenn schon angeschlagen)"}">${n ? `+${n}` : "Erfolg"}</button>`).join("")}</div>`;
  const zustand = `<div class="km-zeile">
      ${b("apply-heal", "🩹 Heilen")}
      ${b("st-shaken", "😵 Angeschlagen", (st.shaken ? "on " : "") + "km-bleibt")}
      ${b("st-out", st.out ? "☠ Wieder wach" : "☠ K.O.", st.out ? "on" : "")}
    </div>`;
  const zustaende = Object.keys(conds).length ? `<div class="km-zeile km-klein">${Object.keys(conds).map((key) =>
      `<button class="km-btn km-bleibt${st[key] ? " on" : ""}" data-act="st-cond" data-id="${c.id}" data-cond="${key}">${esc(conds[key])}</button>`).join("")}</div>` : "";
  const bennies = c.isWildCard ? `<div class="km-zeile"><span class="km-label">🪙 Bennies</span>
      ${b("benny-minus", "–", "km-bleibt")}<span class="km-zahl">${c.bennies || 0}</span>${b("benny-plus", "+", "km-bleibt")}</div>` : "";
  const zug = `<div class="km-zeile">
      ${c.id === App.state.activeId ? "" : b("set-active", "▶ Aktiv setzen")}
      ${c.card && !st.out ? b(c.held ? "intervene" : "hold", c.held ? "⚡ Eingreifen" : "⏸ Abwarten") : ""}
      ${b("redraw", "🔄 Neu ziehen")}
    </div>`;
  const verwalten = `<div class="km-zeile km-klein">
      ${b("edit-combatant", "✎ Bearbeiten")}
      ${c.kind === "npc" && !c.ally ? `<button class="km-btn${c.anon ? " on" : ""}" data-act="set-anon" data-id="${c.id}" data-on="${c.anon ? 0 : 1}">${c.anon ? "🫥 Aufdecken" : "👁 Verdecken"}</button>` : ""}
      <button class="km-btn" data-act="bench" data-id="${c.id}" data-on="${c.benched ? 0 : 1}">${c.benched ? "▶️ Wieder rein" : "⏸ Pausieren"}</button>
      ${b("remove-combatant", "✕ Entfernen", "bad")}
    </div>`;
  const werte = kampfwerteText(c);
  return `<div class="kontext-menue" style="left:${k.x}px; top:${k.y}px" role="menu">
    <div class="km-kopf"><b class="${c.kind === "npc" && !c.ally ? "km-feind" : ""}">${esc(c.name)}</b>${
      werte ? `<span class="km-werte">${esc(werte)}</span>` : ""}${
      st.wounds ? `<span class="km-werte">🩸 ${st.wounds}</span>` : ""}</div>
    ${treffer}${zustand}${zustaende}${bennies}${zug}${verwalten}
  </div>`;
}
// Am Bildschirmrand nach innen schieben (Rechtsklick ganz unten/rechts).
function kontextMenueEinpassen() {
  const m = document.querySelector(".kontext-menue");
  if (!m) return;
  const r = m.getBoundingClientRect();
  const x = Math.max(6, Math.min(r.left, window.innerWidth - r.width - 6));
  const y = Math.max(6, Math.min(r.top, window.innerHeight - r.height - 6));
  if (x !== r.left) m.style.left = x + "px";
  if (y !== r.top) m.style.top = y + "px";
}
function kontextMenueZu() {
  if (!App.kontextMenue) return false;
  App.kontextMenue = null; render();
  return true;
}
document.addEventListener("contextmenu", (e) => {
  if (App.role !== "gm" || !App.state || e.shiftKey) return;   // Shift: Browser-Menü wie gewohnt
  if (e.target.closest("input, textarea, select, .kontext-menue")) return;
  const zeile = e.target.closest(".combatant[data-cid], .zone-token[data-drag-id]");
  if (!zeile) { kontextMenueZu(); return; }
  e.preventDefault();
  // Gruppenkarten-Zeile („Ork ×10"): sie trägt die ID des ERSTEN Orks - ein
  // Menü hier hätte still nur ihn getroffen (oder entfernt). Stattdessen die
  // Gruppe aufklappen, dann den gewünschten Ork anklicken.
  const gruppe = zeile.getAttribute("data-gruppe");
  if (gruppe) {
    App.kontextMenue = null;
    App.gruppeOffen.add(gruppe);
    render();
    toast("Gruppe aufgeklappt – Rechtsklick auf den gewünschten Ork");
    return;
  }
  App.kontextMenue = { id: zeile.getAttribute("data-cid") || zeile.getAttribute("data-drag-id"), x: e.clientX, y: e.clientY };
  render();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && App.kontextMenue) { e.stopImmediatePropagation(); kontextMenueZu(); } }, true);
// Scrollen löst das Menü von seiner Figur - dann lieber zu.
window.addEventListener("scroll", () => { if (App.kontextMenue) kontextMenueZu(); }, { passive: true });

function combatantEditor(c) {
  return `<div class="panel" style="margin:6px 0 0">
    <div class="row">
      <input id="edit-name-${c.id}" class="grow" value="${esc(c.name)}">
      <label class="row tight" style="align-items:center"><input type="checkbox" id="edit-wc-${c.id}" ${c.isWildCard ? "checked" : ""} style="width:auto"> <span class="small">Wild Card</span></label>
    </div>
    <div class="checks" style="margin-top:6px">
      <label><input type="checkbox" id="edit-gluck-${c.id}" ${c.gluck ? "checked" : ""}> Glück (+1)</label>
      <label><input type="checkbox" id="edit-ggluck-${c.id}" ${c.grosses_gluck ? "checked" : ""}> Großes Glück (+2)</label>
    </div>
    ${c.kind === "npc" ? kampfwerteFelder(`edit-${c.id}`, c) : ""}
    <label class="field" style="margin-top:8px"><span>📝 Notiz (nur SL)</span>
      <input id="edit-note-${c.id}" value="${esc(c.note || "")}" placeholder="z. B. flieht bei 2 Wunden"></label>
    <div class="row" style="margin-top:8px">
      <button class="primary" data-act="save-combatant" data-id="${c.id}">Speichern</button>
      <button class="ghost" data-act="cancel-edit-combatant">Abbrechen</button>
      ${c.image
        ? `<button class="ghost bad" data-act="bild-entfernen" data-id="${c.id}"
             title="Porträt löschen – das Bild ließ sich bisher nur ersetzen">🖼 Bild entfernen</button>`
        : ""}
    </div>
  </div>`;
}

function saveCombatant(id) {
  const name = $(`edit-name-${id}`).value;
  const isWildCard = $(`edit-wc-${id}`).checked;
  const gluck = $(`edit-gluck-${id}`).checked;
  const grosses_gluck = $(`edit-ggluck-${id}`).checked;
  const note = ($(`edit-note-${id}`) || {}).value || "";
  const werte = $(`edit-${id}-robustheit`) ? kampfwerteLesen(`edit-${id}`) : {};
  gmAction({ type: "edit_combatant", id, name, isWildCard, gluck, grosses_gluck, note, ...werte });
  App.editCombatantId = null;
}

// Die vier Bibliotheken waren vier Panels untereinander - jetzt EIN Panel mit
// Reitern. Man braucht ohnehin immer nur eine davon auf einmal. Der gewählte
// Reiter wird pro Gerät gemerkt.
const BIB_REITER = [
  { key: "roster", name: "Charaktere", n: (s) => s.roster.length, inhalt: () => rosterInhalt() },
  { key: "bestiary", name: "Gegner", n: (s) => (s.bestiary || []).length, inhalt: () => bestiaryInhalt() },
  { key: "allies", name: "Verbündete", n: (s) => (s.allies || []).length, inhalt: () => allyInhalt() },
  { key: "encounters", name: "Begegnungen", n: (s) => (s.encounters || []).length, inhalt: () => encounterInhalt() },
];
function bibReiter() {
  let r = null;
  try { r = localStorage.getItem("bibReiter"); } catch { /* egal */ }
  return BIB_REITER.some((x) => x.key === r) ? r : "bestiary";
}
function renderBibliothekPanel() {
  const s = App.state;
  const aktiv = bibReiter();
  const reiter = BIB_REITER.map((x) => `<button type="button" class="bib-reiter${x.key === aktiv ? " aktiv" : ""}"
      data-act="bib-reiter" data-reiter="${x.key}">${x.name} <span class="muted">${x.n(s)}</span></button>`).join("");
  const inhalt = BIB_REITER.find((x) => x.key === aktiv).inhalt();
  return section("bibliothek", "Bibliothek", `<div class="bib-reiterleiste">${reiter}</div>${inhalt}`);
}

function rosterInhalt() {
  const s = App.state;
  const items = s.roster.map((r) => `
    <div class="roster-item">
      <div class="grow"><strong>${esc(r.name)}</strong>
        <div class="badges">${r.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)">WC</span>' : ""}${talentBadges(r.talents)}</div>
      </div>
      <button class="small primary" data-act="roster-to-combat" data-id="${r.id}" title="Diesen Charakter in den Kampf setzen (SL-gesteuert)">+ Kampf</button>
      <button class="ghost small" data-act="edit-char" data-id="${r.id}">Bearbeiten</button>
      <button class="ghost small bad" data-act="delete-char" data-id="${r.id}">✕</button>
    </div>`).join("") || `<div class="muted small">Noch keine Charaktere gespeichert.</div>`;

  return `
    <div class="row" style="margin-bottom:6px; align-items:flex-end; gap:10px">
      <button data-act="new-char">+ Neuer Charakter</button>
      <label class="field" style="max-width:200px; margin:0"><span>Startzone für „+ Kampf"</span>
        <select id="rosterzone" data-act="remember-player-zone">${zoneOptions(lastPlayerZone())}</select></label>
    </div>
    <div class="muted small hilfe">Bleibt gespeichert. Spieler wählen ihren Charakter beim Beitritt.</div>
    <div style="margin-top:8px">${items}</div>
    <div id="charform"></div>`;
}

function talentChecklist(selected, prefix) {
  const meta = App.state.talents;
  return Object.keys(meta).map((k) => `
    <label><input type="checkbox" data-talent="${prefix}" value="${k}" ${selected.includes(k) ? "checked" : ""}> ${esc(meta[k].label)}</label>
  `).join("");
}

// Gegner-Bibliothek: Standard-Gegner mit Bild, schnell in den Kampf (wie Roster).
function bestiaryInhalt() {
  const list = (App.state && App.state.bestiary) || [];
  const items = list.map((r) => `
    <div class="roster-item">
      <span class="avatar${r.image ? " zoomable" : ""}"${r.image ? ` data-act="open-image" data-url="${esc(r.image)}" data-name="${esc(r.name)}" title="Bild groß anzeigen"` : ""}>${r.image ? `<img src="${esc(r.image)}" alt="">` : esc(zoneInitials(r.name))}</span>
      <div class="grow"><strong>${esc(r.name)}</strong>
        <div class="badges">${r.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)">WC</span>' : ""}${kampfwerteText(r) ? `<span class="tag kampfwert-tag">${kampfwerteText(r)}</span>` : ""}${talentBadges(r.talents)}</div>
      </div>
      <button class="small primary" data-act="bestiary-to-combat" data-id="${r.id}" title="In den Kampf (in gewählter Startzone)">+ Kampf</button>
      <button class="ghost small" data-act="bestiary-edit" data-id="${r.id}">Bearbeiten</button>
      <button class="ghost small bad" data-act="bestiary-delete" data-id="${r.id}">✕</button>
    </div>`).join("") || `<div class="muted small">Noch keine Gegner-Vorlagen.</div>`;
  return `
    <div class="row" style="margin-bottom:6px; align-items:flex-end; gap:10px">
      <button data-act="bestiary-new">+ Neuer Gegner-Typ</button>
      <label class="field" style="max-width:200px; margin:0"><span>Startzone für „+ Kampf"</span>
        <select id="bestzone" data-act="remember-zone">${zoneOptions(lastNpcZone())}</select></label>
      <label class="field" style="max-width:90px; margin:0"><span>Anzahl</span>
        <input id="bestcount" type="number" min="1" max="20" value="1"></label>
      <label class="feld-kasten" title="Spieler sehen dann nur einen unlesbaren Namen – du weiterhin den echten">
        <input type="checkbox" id="bestanon"> 🫥 verdeckt
      </label>
    </div>
    <div class="muted small hilfe">Standard-Gegner (mit Bild) – bleiben gespeichert, per „+ Kampf" in der gewählten Zone rein.
      Mehrere gleiche werden automatisch durchnummeriert (Ork 1, Ork 2 …).</div>
    <div style="margin-top:8px">${items}</div>
    <div id="bestiaryform"></div>`;
}

// Verbündeten-Bibliothek – wie das Bestiarium, aber Figuren landen auf Spielerseite.
function allyInhalt() {
  const list = (App.state && App.state.allies) || [];
  const items = list.map((r) => `
    <div class="roster-item">
      <span class="avatar${r.image ? " zoomable" : ""}"${r.image ? ` data-act="open-image" data-url="${esc(r.image)}" data-name="${esc(r.name)}" title="Bild groß anzeigen"` : ""}>${r.image ? `<img src="${esc(r.image)}" alt="">` : esc(zoneInitials(r.name))}</span>
      <div class="grow"><strong>${esc(r.name)}</strong>
        <div class="badges">${r.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)">WC</span>' : ""}${kampfwerteText(r) ? `<span class="tag kampfwert-tag">${kampfwerteText(r)}</span>` : ""}${talentBadges(r.talents)}</div>
      </div>
      <button class="small primary" data-act="ally-to-combat" data-id="${r.id}" title="In den Kampf (Spielerseite, gewählte Startzone)">+ Kampf</button>
      <button class="ghost small" data-act="ally-edit" data-id="${r.id}">Bearbeiten</button>
      <button class="ghost small bad" data-act="ally-delete" data-id="${r.id}">✕</button>
    </div>`).join("") || `<div class="muted small">Noch keine Verbündeten-Vorlagen.</div>`;
  return `
    <div class="row" style="margin-bottom:6px; align-items:flex-end; gap:10px">
      <button data-act="ally-new">+ Neuer Verbündeter</button>
      <label class="field" style="max-width:200px; margin:0"><span>Startzone für „+ Kampf"</span>
        <select id="allyzone" data-act="remember-ally-zone">${zoneOptions(lastAllyZone())}</select></label>
    </div>
    <div class="muted small hilfe">NPCs auf Spielerseite (grün). Bleiben gespeichert, per „+ Kampf" in der gewählten Zone rein.</div>
    <div style="margin-top:8px">${items}</div>
    <div id="allyform"></div>`;
}

// Begegnungen: gespeicherte Gegner-/Verbündeten-Gruppen, auf einen Schlag einsetzbar.
function encounterInhalt() {
  const list = (App.state && App.state.encounters) || [];
  const hasNpcs = ((App.state && App.state.combatants) || []).some((c) => c.kind === "npc");
  const items = list.map((e) => {
    const names = (e.members || []).map((m) => m.name).join(", ");
    return `<div class="roster-item">
      <div class="grow"><strong>${esc(e.name)}</strong>
        <div class="muted small">${(e.members || []).length} Figur(en): ${esc(names).slice(0, 90)}</div>
      </div>
      <button class="small primary" data-act="encounter-start" data-id="${e.id}" title="Einsetzen, pausierte Spieler zurückholen und sofort austeilen">▶ Starten</button>
      <button class="ghost small" data-act="encounter-to-combat" data-id="${e.id}" title="Nur einsetzen, ohne auszuteilen">+ Kampf</button>
      <button class="ghost small bad" data-act="encounter-delete" data-id="${e.id}">✕</button>
    </div>`;
  }).join("") || `<div class="muted small">Noch keine Begegnungen gespeichert.</div>`;
  return `
    <div class="muted small hilfe">Eine Gegner-/Verbündeten-Gruppe speichern und später mit EINEM Klick komplett einsetzen (in den gespeicherten Zonen).</div>
    <div class="row" style="margin:6px 0">
      <button data-act="encounter-save" ${hasNpcs ? "" : "disabled"} title="${hasNpcs ? "Aktuelle Gegner/Verbündete als Begegnung speichern" : "Erst Gegner/Verbündete in den Kampf setzen"}">💾 Aktuelle Aufstellung speichern</button>
    </div>
    <div style="margin-top:8px">${items}</div>`;
}

function renderAllyForm(existing) {
  const c = existing || { id: "", name: "", isWildCard: false, talents: [], image: null };
  const host = $("allyform");
  if (!host) return;
  host.innerHTML = `<div class="panel" style="margin-top:10px">
    <h3>${existing ? "Verbündeten-Typ bearbeiten" : "Neuer Verbündeter"}</h3>
    <input type="hidden" id="allyid" value="${esc(c.id)}">
    <input type="hidden" id="allyimg" value="${esc(c.image || "")}">
    <div class="row tight" style="align-items:center; margin-bottom:6px">
      <label class="avatar big" title="Bild wählen" style="cursor:pointer">
        <span id="allyavatar">${c.image ? `<img src="${esc(c.image)}" alt="">` : "🖼"}</span>
        <input type="file" accept="image/*" data-act="pick-ally-image" style="display:none">
      </label>
      <label class="field grow" style="margin:0"><span>Name</span><input id="allyname" value="${esc(c.name)}"></label>
    </div>
    <label class="field row tight" style="align-items:center"><input type="checkbox" id="allywc" ${c.isWildCard ? "checked" : ""} style="width:auto"> <span style="margin:0">Wild Card</span></label>
    ${kampfwerteFelder("ally", c)}
    <div class="muted small">Karten-Talente:</div>
    <div class="checks">${talentChecklist(c.talents, "ally")}</div>
    <div class="muted small" style="margin-top:8px">Bennie-Talente:</div>
    <div class="checks">
      <label><input type="checkbox" id="allyGluck" ${c.gluck ? "checked" : ""}> Glück (+1)</label>
      <label><input type="checkbox" id="allyGrossesGluck" ${c.grosses_gluck ? "checked" : ""}> Großes Glück (+2)</label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="primary" data-act="ally-save">Speichern</button>
      <button class="ghost" data-act="ally-cancel">Abbrechen</button>
    </div>
  </div>`;
}

function renderBestiaryForm(existing) {
  const c = existing || { id: "", name: "", isWildCard: false, talents: [], image: null };
  const host = $("bestiaryform");
  if (!host) return;
  host.innerHTML = `<div class="panel" style="margin-top:10px">
    <h3>${existing ? "Gegner-Typ bearbeiten" : "Neuer Gegner-Typ"}</h3>
    <input type="hidden" id="bestid" value="${esc(c.id)}">
    <input type="hidden" id="bestimg" value="${esc(c.image || "")}">
    <div class="row tight" style="align-items:center; margin-bottom:6px">
      <label class="avatar big" title="Bild wählen" style="cursor:pointer">
        <span id="bestavatar">${c.image ? `<img src="${esc(c.image)}" alt="">` : "🖼"}</span>
        <input type="file" accept="image/*" data-act="pick-bestiary-image" style="display:none">
      </label>
      <label class="field grow" style="margin:0"><span>Name</span><input id="bestname" value="${esc(c.name)}"></label>
    </div>
    <label class="field row tight" style="align-items:center"><input type="checkbox" id="bestwc" ${c.isWildCard ? "checked" : ""} style="width:auto"> <span style="margin:0">Wild Card</span></label>
    ${kampfwerteFelder("best", c)}
    <div class="muted small">Karten-Talente:</div>
    <div class="checks">${talentChecklist(c.talents, "best")}</div>
    <div class="muted small" style="margin-top:8px">Bennie-Talente:</div>
    <div class="checks">
      <label><input type="checkbox" id="bestGluck" ${c.gluck ? "checked" : ""}> Glück (+1)</label>
      <label><input type="checkbox" id="bestGrossesGluck" ${c.grosses_gluck ? "checked" : ""}> Großes Glück (+2)</label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="primary" data-act="bestiary-save">Speichern</button>
      <button class="ghost" data-act="bestiary-cancel">Abbrechen</button>
    </div>
  </div>`;
}

function renderCharForm(existing) {
  const c = existing || { id: "", name: "", isWildCard: true, talents: [] };
  const host = $("charform");
  if (!host) return;
  host.innerHTML = `<div class="panel" style="margin-top:10px">
    <h3>${existing ? "Charakter bearbeiten" : "Neuer Charakter"}</h3>
    <input type="hidden" id="charid" value="${esc(c.id)}">
    <label class="field"><span>Name</span><input id="charname" value="${esc(c.name)}"></label>
    <label class="field row tight" style="align-items:center"><input type="checkbox" id="charwc" ${c.isWildCard ? "checked" : ""} style="width:auto"> <span style="margin:0">Wild Card</span></label>
    <div class="muted small">Karten-Talente:</div>
    <div class="checks">${talentChecklist(c.talents, "char")}</div>
    <div class="muted small" style="margin-top:8px">Bennie-Talente:</div>
    <div class="checks">
      <label><input type="checkbox" id="charGluck" ${c.gluck ? "checked" : ""}> Glück (+1)</label>
      <label><input type="checkbox" id="charGrossesGluck" ${c.grosses_gluck ? "checked" : ""}> Großes Glück (+2)</label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="primary" data-act="save-char">Speichern</button>
      <button class="ghost" data-act="cancel-char">Abbrechen</button>
    </div>
  </div>`;
}

// Gemerkte Startzonen: Gegner (Default „Außer Reichweite"), Verbündete (Default „Nahbereich").
function lastNpcZone() {
  const v = parseInt(localStorage.getItem("lastZone"), 10);
  return isNaN(v) ? 4 : Math.max(0, Math.min(4, v));
}
function lastAllyZone() {
  const v = parseInt(localStorage.getItem("lastZoneAlly"), 10);
  return isNaN(v) ? 1 : Math.max(0, Math.min(4, v));
}
function lastPlayerZone() {
  const v = parseInt(localStorage.getItem("lastZonePlayer"), 10);
  return isNaN(v) ? 1 : Math.max(0, Math.min(4, v));
}

// Nachrichtentext mit Zeilenumbruechen (z. B. die mitgeschickte Benny-Zeile).
const mehrzeilig = (t) => esc(t).replace(/\n/g, "<br>");

// Spieler mit Figurname: am Tisch denkt man in Charakteren („Tessa"), nicht in
// dem, was jemand beim Beitreten als Namen eingetippt hat.
function spielerAnzeige(p) {
  if (!p) return "?";
  const fig = App.state.combatants.find((c) => c.playerId === p.id);
  return fig && fig.name !== p.name ? `${fig.name} (${p.name})` : p.name;
}

function renderMessagePanel() {
  const s = App.state;
  const opts = [`<option value="all">Alle Spieler</option>`, `<option value="beamer">📺 Beamer / TV (Bild groß)</option>`]
    .concat(s.players.map((p) =>
      `<option value="${p.id}">${esc(spielerAnzeige(p))}${p.connected ? "" : " (offline)"}</option>`))
    .join("");
  const preview = App.pendingImageUrl
    ? `<div class="msg"><img src="${esc(App.pendingImageUrl)}"><button class="ghost small" data-act="clear-image" style="margin-top:6px">Bild entfernen</button></div>`
    : "";
  // Das Panel ist jetzt dauerhaft offen -> nur die letzten drei Nachrichten,
  // sonst waechst die linke Spalte mit jedem verschickten Benny.
  const log = s.messages.filter((m) => m.sender !== "kampf").slice(-3).reverse().map((m) => `
    <div class="msg"><div class="to">an ${m.target === "all" ? "alle" : esc(spielerAnzeige(s.players.find((p) => p.id === m.target)))}
        <button class="st-btn" data-act="nochmal-senden" data-msg="${m.id}" title="Nochmal senden – an den oben gewählten Empfänger">🔁</button>
        ${m.imageUrl ? `<button class="st-btn" data-act="auf-tv" data-url="${esc(m.imageUrl)}" title="Bild groß auf den TV/Beamer">📺</button>` : ""}
      </div>
      ${m.text ? mehrzeilig(m.text) : ""}${m.imageUrl ? `<img src="${esc(m.imageUrl)}" data-act="open-image" data-url="${esc(m.imageUrl)}" title="Groß ansehen">` : ""}</div>`).join("");

  // Bild-Archiv: jedes schon einmal verschickte Bild bleibt als Miniatur da -
  // Karten, Handouts und Porträts lassen sich so ohne Suchen erneut zeigen.
  const archiv = [...new Map(s.messages.filter((m) => m.imageUrl)
    .map((m) => [m.imageUrl, m])).values()].reverse().slice(0, 24);
  const archivHtml = archiv.length ? `
    <details class="section" data-sec="bildarchiv" ${App.collapsed.bildarchiv === false ? "open" : ""} style="margin-top:10px">
      <summary class="sec-head"><span class="sec-title">🖼 Bild-Archiv (${archiv.length})</span><span class="sec-caret">▸</span></summary>
      <div class="panel-body bild-archiv">${archiv.map((m) => `
        <div class="archiv-bild">
          <img src="${esc(m.imageUrl)}" alt="" data-act="open-image" data-url="${esc(m.imageUrl)}" title="Groß ansehen">
          <div class="row tight">
            <button class="st-btn" data-act="nochmal-senden" data-msg="${m.id}" title="Nochmal an den gewählten Empfänger senden">🔁</button>
            <button class="st-btn" data-act="auf-tv" data-url="${esc(m.imageUrl)}" title="Groß auf den TV/Beamer">📺</button>
          </div>
        </div>`).join("")}</div>
    </details>` : "";

  return section("message", "Nachricht / Bild / Bennies", `
    <div class="nachricht-zeile">
      <select id="msgtarget" title="Empfänger">${opts}</select>
      <button data-act="benny-geben" title="Der gewählte Empfänger (bei „Alle Spieler“ jeder) bekommt einen Benny – mit kurzem Hinweis aufs Handy">🪙 +1 Benny</button>
    </div>
    <div class="nachricht-zeile">
      <input id="msgtext" placeholder="Nachricht…">
      <label class="ghost knopf-label${App.pendingImageUrl ? " on" : ""}" title="Bild anhängen">🖼<input type="file" id="msgimage" accept="image/*" data-act="pick-image" style="display:none"></label>
      <button class="primary" data-act="send-message">Senden</button>
    </div>
    ${preview}
    <div class="row" style="align-items:center; gap:6px; margin-top:8px">
      <span class="muted small">SL-Pool</span>
      <button class="st-btn" data-act="sl-benny-minus">–</button>
      <span style="min-width:40px; text-align:center; font-weight:700">🪙 ${s.slBennies}</span>
      <button class="st-btn" data-act="sl-benny-plus">+</button>
      <button class="ghost small" data-act="benny-refresh" style="margin-left:auto" title="Jede Wildcard auf den Startwert (+ Glück-Bonus) setzen – z. B. zu Beginn des Abends. Startwert: ⚙ unten in der Leiste">↻ Bennies auffrischen</button>
    </div>
    ${s.tvImage ? `<div class="row" style="margin-top:8px"><span class="pill good">📺 TV zeigt gerade ein Bild</span><button class="ghost small" data-act="clear-tv">TV-Bild entfernen</button></div>` : ""}
    ${log ? `<details class="unter-klapp" data-merk="verlauf"${App.offeneUnter.has("verlauf") ? " open" : ""}>
      <summary>Verlauf (letzte ${Math.min(3, s.messages.length)})</summary>${log}
      <button class="ghost small" data-act="clear-messages" style="margin-top:6px">Verlauf leeren</button></details>` : ""}
    ${archivHtml}`);
}

// ---------- Charakterbogen (Spickzettel) ----------
// Der Spieler pflegt ihn selbst (Stefan: „nur die Spieler tragen es ein").
// Vier Reiter wie ein kleiner Bogen. Bearbeitet wird ein Entwurf
// (App.bogenEntwurf); erst „Speichern" schickt ihn an den Server.
// Vorschläge fürs Eingabefeld - frei tippbar bleibt es trotzdem, damit auch
// „W6+2" oder „W8-1" gehen (der Server prüft und schreibt es einheitlich).
const WUERFEL = ["W4", "W6", "W8", "W10", "W12", "W12+1", "W12+2"];
const ATTRIBUTE = [["ge", "GE", "Geschicklichkeit"], ["ve", "VE", "Verstand"], ["wi", "WI", "Willenskraft"],
  ["st", "ST", "Stärke"], ["ko", "KO", "Konstitution"]];
const BOGEN_REITER = [["kampf", "Kampf"], ["werte", "Werte"], ["talente", "Talente"], ["zeug", "Ausrüstung"]];

function leererBogen() {
  return { parade: "", robustheit: "", panzer: "", tempo: "", rennen: "",
    attribute: { ge: "", ve: "", wi: "", st: "", ko: "" },
    fertigkeiten: [], waffen: [], talente: [], handicaps: [], ausruestung: [] };
}
function bogenVon(c) {
  const b = c && c.bogen;
  return b ? { ...leererBogen(), ...JSON.parse(JSON.stringify(b)) } : leererBogen();
}
function bogenIstLeer(b) {
  return !b.parade && !b.robustheit && !b.tempo && !b.waffen.length && !b.fertigkeiten.length
    && !Object.values(b.attribute).some(Boolean) && !b.talente.length && !b.handicaps.length && !b.ausruestung.length;
}
const wuerfelWahl = (pfad, wert, breite) =>
  `<input class="wuerfel-feld" list="wuerfel-vorschlaege" data-bogen="${pfad}" value="${esc(wert || "")}" placeholder="6 oder 6+2" inputmode="text"${breite ? ` style="width:${breite}"` : ""}>`;
const bogenFeld = (pfad, wert, platz, breite) =>
  `<input data-bogen="${pfad}" value="${esc(wert || "")}" placeholder="${esc(platz || "")}"${breite ? ` style="width:${breite}"` : ""}>`;

function renderBogen(mine) {
  if (!mine) return "";
  const reiter = App.bogenReiter || "kampf";
  const edit = !!App.bogenEntwurf;
  const b = edit ? App.bogenEntwurf : bogenVon(mine);
  const leiste = `<div class="reiter">${BOGEN_REITER.map(([k, n]) =>
    `<button class="${k === reiter ? "an" : ""}" data-act="bogen-reiter" data-reiter="${k}">${n}</button>`).join("")}</div>`;
  let inhalt;
  if (!edit && bogenIstLeer(b) && reiter !== "talente") {
    inhalt = `<div class="muted small" style="padding:6px 0">Noch leer. Tippe auf <b>✎ Bearbeiten</b> und trag deine Werte ein – dann hast du sie im Kampf immer griffbereit.</div>`;
    if (reiter === "kampf") inhalt += regelTipp(b);
    return section("bogen", "📜 Mein Charakter", `<div class="bogen">${leiste}${inhalt}<div class="row" style="margin-top:8px"><button class="ghost small" data-act="bogen-bearbeiten">✎ Bearbeiten</button></div></div>`);
  } else if (reiter === "kampf") {
    inhalt = edit
      ? `<div class="bogen-raster">
           <label title="Leer lassen: 2 + halbes Kämpfen">Parade ${bogenFeld("parade", b.parade, autoParade(b) !== null ? `auto ${autoParade(b)}` : "z. B. 7", "4.5em")}</label>
           <label title="Leer lassen: 2 + halbe Konstitution + Panzer">Robustheit ${bogenFeld("robustheit", b.robustheit, autoRobustheit(b) !== null ? `auto ${autoRobustheit(b)}` : "z. B. 8", "4.5em")}</label>
           <label>davon Panzer ${bogenFeld("panzer", b.panzer, "z. B. 2", "4.5em")}</label>
           <label>Tempo ${bogenFeld("tempo", b.tempo, "z. B. 6", "4.5em")}</label>
           <label>Rennen ${wuerfelWahl("rennen", b.rennen)}</label>
         </div>
         <div class="muted small">Parade und Robustheit rechnet die App aus Kämpfen bzw. Konstitution + Panzer, solange du die Felder leer lässt.</div>
         <div class="bogen-titel">Waffen</div>
         ${b.waffen.map((w, i) => `<div class="waffe-block">
           <div class="bogen-reihe">
             <select data-bogen="waffen.${i}.art" title="Nahkampf oder Fernkampf">
               <option value="nah"${w.art !== "fern" ? " selected" : ""}>⚔ Nahkampf</option>
               <option value="fern"${w.art === "fern" ? " selected" : ""}>🏹 Fernkampf</option>
             </select>
             ${bogenFeld(`waffen.${i}.name`, w.name, "Name")}
             <button class="st-btn" data-act="bogen-weg" data-liste="waffen" data-i="${i}" title="Entfernen">✕</button>
           </div>
           <div class="bogen-reihe">
             ${bogenFeld(`waffen.${i}.fertigkeit`, w.fertigkeit, w.art === "fern" ? "Schießen" : "Kämpfen", "8em")}
             ${bogenFeld(`waffen.${i}.schaden`, w.schaden, w.art === "fern" ? "z. B. 2W6" : "z. B. St+W6", "7em")}
             ${bogenFeld(`waffen.${i}.info`, w.info, w.art === "fern" ? "Reichweite 12/24/48" : "Notiz, z. B. Parade +1")}
           </div>
         </div>`).join("")}
         <button class="ghost small" data-act="bogen-dazu" data-liste="waffen">+ Waffe</button>`
      : `<div class="zeile2"><span>Parade</span><b>${b.parade ? esc(b.parade) : (autoParade(b) !== null ? `${autoParade(b)} <span class="auto-wert">automatisch</span>` : "–")}</b></div>
         <div class="zeile2"><span>Robustheit</span><b>${b.robustheit ? esc(b.robustheit) : (autoRobustheit(b) !== null ? `${autoRobustheit(b)} <span class="auto-wert">automatisch</span>` : "–")}${b.panzer ? ` (${esc(b.panzer)})` : ""}</b></div>
         <div class="zeile2"><span>Tempo</span><b>${esc(b.tempo || "–")}${b.rennen ? ` · Rennen ${esc(b.rennen)}` : ""}</b></div>
         ${b.waffen.map((w) => `<div class="zeile2"><span>${w.art === "fern" ? "🏹" : "⚔"} ${esc(w.name)}</span><b>${esc([w.schaden, w.info].filter(Boolean).join(" · "))}</b></div>
           <div class="wuerfel-tipp">${wuerfelTipp(w, b)}</div>`).join("")}`;
  } else if (reiter === "werte") {
    // Fruehere Kuerzel (GE/VE/WI/ST/KO) waren nicht eindeutig - jetzt
    // ausgeschrieben, untereinander statt in fuenf schmalen Kaestchen.
    inhalt = `<div class="attr-liste">${ATTRIBUTE.map(([k, kurz, lang]) =>
        `<div class="attr-zeile"><span>${lang} <span class="muted small">(${kurz})</span></span>
          ${edit ? wuerfelWahl(`attribute.${k}`, b.attribute[k]) : `<b>${esc(b.attribute[k] || "–")}</b>`}</div>`).join("")}</div>
      ${edit ? `<div class="muted small">Nur die Zahl reicht: <b>6</b> wird zu W6, <b>6+2</b> zu W6+2.</div>` : ""}
      <div class="bogen-titel">Fertigkeiten</div>
      ${edit
        ? b.fertigkeiten.map((f, i) => `<div class="bogen-reihe">${bogenFeld(`fertigkeiten.${i}.name`, f.name, "z. B. Kämpfen")}${wuerfelWahl(`fertigkeiten.${i}.wert`, f.wert)}
            <button class="st-btn" data-act="bogen-weg" data-liste="fertigkeiten" data-i="${i}" title="Entfernen">✕</button></div>`).join("")
          + `<button class="ghost small" data-act="bogen-dazu" data-liste="fertigkeiten">+ Fertigkeit</button>`
        : (b.fertigkeiten.length
            ? `<div class="fert">${b.fertigkeiten.map((f) => `<span>${esc(f.name)}</span><span class="w">${esc(f.wert || "–")}</span>`).join("")}</div>`
            : `<div class="muted small">–</div>`)}`;
  } else if (reiter === "talente") {
    // Initiative-Talente (Schnell, Kühler Kopf …) und Glück: wirken direkt aufs
    // Kartenziehen bzw. die Bennies - der Spieler hakt sie hier selbst an.
    const alle = App.state.talents || {};
    const te = App.talentEntwurf;
    const hat = (k) => (edit ? te.talents : (mine.talents || [])).includes(k);
    const glueck = edit ? te : mine;
    const initAnzeige = [
      ...(mine.talents || []).map((t) => (alle[t] || {}).label || t),
      ...(mine.gluck ? ["Glück"] : []), ...(mine.grosses_gluck ? ["Großes Glück"] : []),
    ].map((n) => `<span class="tag">${esc(n)}</span>`).join("");
    const initEdit = Object.keys(alle).map((k) =>
        `<label class="talent-wahl"><input type="checkbox" data-talent="${k}"${hat(k) ? " checked" : ""}> ${esc(alle[k].label)}</label>`).join("")
      + `<label class="talent-wahl"><input type="checkbox" data-talent="gluck"${glueck.gluck ? " checked" : ""}> Glück (+1 Benny)</label>`
      + `<label class="talent-wahl"><input type="checkbox" data-talent="grosses_gluck"${glueck.grosses_gluck ? " checked" : ""}> Großes Glück (+2)</label>`;
    inhalt = `<div class="bogen-titel">Initiative &amp; Glück</div>
      ${edit ? `<div class="talent-raster">${initEdit}</div>`
        : `<div class="chips">${initAnzeige || `<span class="muted small">–</span>`}</div>`}
      <div class="bogen-titel">Talente</div>
      ${edit ? `<textarea data-bogen="talente" rows="4" placeholder="Ein Talent pro Zeile">${esc(b.talente.join("\n"))}</textarea>`
        : `<div class="chips">${b.talente.map((t) => `<span class="tag">${esc(t)}</span>`).join("") || `<span class="muted small">–</span>`}</div>`}
      <div class="bogen-titel">Handicaps</div>
      ${edit ? `<textarea data-bogen="handicaps" rows="3" placeholder="Ein Handicap pro Zeile">${esc(b.handicaps.join("\n"))}</textarea>`
        : `<div class="chips">${b.handicaps.map((t) => `<span class="tag handicap">${esc(t)}</span>`).join("") || `<span class="muted small">–</span>`}</div>`}`;
  } else {
    inhalt = edit
      ? `<textarea data-bogen="ausruestung" rows="6" placeholder="Ein Gegenstand pro Zeile, z. B. Heiltrank ×3">${esc(b.ausruestung.join("\n"))}</textarea>`
      : (b.ausruestung.map((z) => `<div class="zeile2"><span>${esc(z)}</span></div>`).join("") || `<div class="muted small">–</div>`);
  }
  // Regel-Spickzettel nur im Kampf-Reiter und nicht beim Bearbeiten.
  if (reiter === "kampf" && !edit) inhalt += regelTipp(b);
  const knoepfe = edit
    ? `<div class="row" style="margin-top:10px; gap:8px"><button class="primary" data-act="bogen-speichern">✓ Speichern</button>
         <button class="ghost" data-act="bogen-abbrechen">Abbrechen</button></div>`
    : `<div class="row" style="margin-top:8px"><button class="ghost small" data-act="bogen-bearbeiten">✎ Bearbeiten</button></div>`;
  return section("bogen", "📜 Mein Charakter", `<div class="bogen${edit ? " bogen-form" : ""}">${leiste}${inhalt}${knoepfe}</div>`);
}

// „Womit würfle ich?" - aus den eigenen Werten für GENAU diese Waffe.
// Beispiel: „Kämpfen W8+1 + Wild-Würfel W6 gegen Parade · Schaden W6+W6".
function wuerfelTipp(w, b) {
  const fern = w.art === "fern";
  const fert = (name) => (b.fertigkeiten.find((f) => f.name.trim().toLowerCase() === String(name).trim().toLowerCase()) || {}).wert;
  // Eigene Angabe an der Waffe hat Vorrang, sonst die uebliche Fertigkeit.
  const wert = fert(w.fertigkeit) || fert(fern ? "schießen" : "kämpfen") || fert(fern ? "schiessen" : "kaempfen") || "";
  const fertName = w.fertigkeit || (fern ? "Schießen" : "Kämpfen");
  // „St+W6" heisst: Stärke-Würfel plus Waffenwürfel - hier gleich einsetzen.
  const st = b.attribute.st;
  const schaden = (w.schaden || "").replace(/\b(St|ST|Stärke|Staerke)\b/g, st || "Stärke");
  const angriff = `${esc(fertName)}${wert ? ` <b>${esc(wert)}</b>` : ""} + Wild-Würfel W6 ${fern ? "gegen <b>4</b>" : "gegen die <b>Parade</b>"}`;
  return `🎲 ${angriff}${schaden ? ` · Schaden <b>${esc(schaden)}</b>` : ""}${
    fern && w.info ? ` · ${esc(w.info)} (mittel −2, weit −4)` : ""}`;
}

// Kurzregeln zu Angriff und Schaden (Savage Worlds, wie in Sundered Skies).
// Setzt die eigenen Werte ein, wo der Bogen sie kennt - sonst allgemein.
function regelTipp(b) {
  const fert = (name) => (b.fertigkeiten.find((f) => f.name.trim().toLowerCase() === name) || {}).wert;
  const kaempfen = fert("kämpfen") || fert("kaempfen");
  const schiessen = fert("schießen") || fert("schiessen");
  const st = b.attribute.st;
  const w = (x, allg) => (x ? `<b>${esc(x)}</b>` : allg);
  const parade = b.parade || autoParade(b);
  const robust = b.robustheit || autoRobustheit(b);
  return `<details class="regel-tipp"${App.regelOffen ? " open" : ""}>
    <summary>❔ So geht Angriff &amp; Schaden</summary>
    <div class="regel-block"><b>1 · Treffen</b>
      <ul>
        <li><b>Nahkampf:</b> ${w(kaempfen && `Kämpfen ${kaempfen}`, "Kämpfen")} würfeln – erreichen oder übertreffen der <b>Parade</b> des Gegners = Treffer.</li>
        <li><b>Fernkampf:</b> ${w(schiessen && `Schießen ${schiessen}`, "Schießen")} gegen <b>4</b>. Mittlere Reichweite −2, weite −4, Deckung zieht ab.</li>
        <li>Als Wild Card würfelst du den <b>Wild-Würfel (W6)</b> mit, der höhere zählt. Jede gewürfelte Höchstzahl darf nochmal (<b>Ass</b>).</li>
        <li><b>4 oder mehr darüber</b> (Steigerung) = <b>+1W6 Schaden</b>.</li>
      </ul></div>
    <div class="regel-block"><b>2 · Schaden</b>
      <ul>
        <li><b>Nahkampf:</b> ${w(st && `Stärke ${st}`, "Stärke")} + Waffenwürfel (z. B. St+W6). <b>Fernkampf:</b> fester Waffenschaden (z. B. 2W6). Kein Wild-Würfel beim Schaden.</li>
        <li>Verglichen wird mit der <b>Robustheit</b> des Ziels:
          erreicht = <b>Angeschlagen</b>, je 4 darüber = <b>1 Wunde</b>.
          Ist das Ziel schon angeschlagen, wird aus „Angeschlagen" eine Wunde.</li>
        <li>Normale Gegner (Statisten) sind bei der <b>${App.state.statistenKo || 3}. Wunde</b> draußen, Wild Cards (Spieler, Bosse) bei der <b>4.</b></li>
      </ul></div>
    ${parade || robust ? `<div class="regel-block"><b>Deine Werte</b>
      <ul>${parade ? `<li><b>Parade ${esc(String(parade))}</b> – so schwer ist es, dich im Nahkampf zu treffen.</li>` : ""}
        ${robust ? `<li><b>Robustheit ${esc(String(robust))}</b> – so viel Schaden steckst du weg, bevor du angeschlagen bist.</li>` : ""}</ul></div>` : ""}
    <div class="regel-block"><b>Gut zu wissen</b>
      <ul>
        <li><b>Joker:</b> +2 auf alle Würfe <i>und</i> den Schaden.</li>
        <li>Jede eigene Wunde: <b>−1</b> auf alle Würfe.</li>
        <li><b>Mehrere gegen einen:</b> +1 pro zusätzlichem Angreifer (höchstens +4).</li>
        <li><b>Wilder Angriff:</b> +2 aufs Treffen und den Schaden, dafür −2 Parade bis zum nächsten Zug.</li>
        <li><b>Benny für Wunden:</b> sofort nach dem Treffer Konstitution würfeln – Erfolg und jede Steigerung heben je eine Wunde auf.</li>
      </ul></div>
    <div class="muted small">Im Zweifel entscheidet der Spielleiter.</div>
  </details>`;
}

// Auf-/Zugeklappt merken - sonst klappte ihn jedes Update vom Tisch wieder zu.
document.addEventListener("toggle", (e) => {
  if (e.target.classList && e.target.classList.contains("regel-tipp")) App.regelOffen = e.target.open;
}, true);

// Wie der Server (wuerfel_wert): W4-W12, optional mit Zuschlag; beim Schaden
// auch mehrere Wuerfel. Rot markieren statt stillschweigend verwerfen.
const WUERFEL_PRUEFUNG = /^(\d{0,2})[wWdD]?(4|6|8|10|12)\s*([+-]\s*\d{1,2})?$/;
// Aus „W8" bzw. „W12+1" die Bestandteile holen (fuer Parade/Robustheit).
function wuerfelTeile(wert) {
  const m = WUERFEL_PRUEFUNG.exec(String(wert || "").trim().replace(/\s+/g, ""));
  if (!m) return null;
  return { seiten: parseInt(m[2], 10), plus: parseInt((m[3] || "0").replace(/\s+/g, ""), 10) || 0 };
}

// Savage Worlds: Parade = 2 + halbes Kaempfen, Robustheit = 2 + halbe
// Konstitution + Panzerung. Ein Plus zaehlt nur oberhalb von W12 mit (W12+1).
// Die App rechnet das nur, wenn der Spieler das Feld LEER laesst - wer eigene
// Werte eintraegt (Talente, Ausruestung), behaelt sie.
function halberWuerfel(wert) {
  const t = wuerfelTeile(wert);
  if (!t) return null;
  return t.seiten / 2 + (t.seiten === 12 ? t.plus : 0);
}
function autoParade(b) {
  const h = halberWuerfel((b.fertigkeiten.find((f) => /^k(ä|ae)mpfen$/i.test(f.name.trim())) || {}).wert);
  return h === null ? null : 2 + h;
}
function autoRobustheit(b) {
  const h = halberWuerfel(b.attribute.ko);
  if (h === null) return null;
  const panzer = parseInt(b.panzer, 10);
  return 2 + h + (isNaN(panzer) ? 0 : panzer);
}

function wuerfelNorm(text, mehrere) {
  const roh = String(text || "").trim().replace(/\s+/g, "");
  if (!roh) return "";
  const m = WUERFEL_PRUEFUNG.exec(roh);
  if (!m) return null;                       // null = unbrauchbar
  let anzahl = m[1];
  if (["", "0", "1"].includes(anzahl)) anzahl = "";
  else if (!mehrere) return null;            // mehrere Würfel nur beim Schaden
  return `${anzahl}W${m[2]}${(m[3] || "").replace(/\s+/g, "")}`;
}

function wuerfelFeldPruefen(t) {
  const pfad = t.getAttribute("data-bogen") || "";
  if (!t.classList.contains("wuerfel-feld")) return;
  const wert = wuerfelNorm(t.value, /schaden/.test(pfad));
  t.classList.toggle("ungueltig", wert === null);
}

// Beim Verlassen des Felds sauber schreiben: aus „6" wird sichtbar „W6", aus
// „w8 +1" wird „W8+1". Der Spieler soll das „W" nicht tippen müssen.
function wuerfelFeldAufraeumen(t) {
  if (!t.classList || !t.classList.contains("wuerfel-feld")) return;
  const wert = wuerfelNorm(t.value, /schaden/.test(t.getAttribute("data-bogen") || ""));
  if (wert !== null && wert !== t.value) {
    t.value = wert;
    bogenEingabe(t);
    t.classList.remove("ungueltig");
  }
}
document.addEventListener("focusout", (e) => {
  if (e.target.closest && e.target.closest(".bogen-form")) wuerfelFeldAufraeumen(e.target);
}, true);

// Eingabe im Entwurf mitschreiben (Pfad wie „waffen.0.name").
function bogenEingabe(t) {
  const pfad = t.getAttribute("data-bogen");
  if (!pfad || !App.bogenEntwurf) return;
  const teile = pfad.split(".");
  if (["talente", "handicaps", "ausruestung"].includes(pfad)) {
    App.bogenEntwurf[pfad] = t.value.split("\n").map((z) => z.trim()).filter(Boolean);
    return;
  }
  let ziel = App.bogenEntwurf;
  for (let i = 0; i < teile.length - 1; i++) ziel = ziel[teile[i]];
  ziel[teile[teile.length - 1]] = t.value;
}
document.addEventListener("input", (e) => {
  if (!e.target.closest || !e.target.closest(".bogen-form")) return;
  bogenEingabe(e.target);
  wuerfelFeldPruefen(e.target);
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.closest || !t.closest(".bogen-form")) return;
  const k = t.getAttribute("data-talent");
  if (k && App.talentEntwurf) {
    if (k === "gluck" || k === "grosses_gluck") App.talentEntwurf[k] = t.checked;
    else {
      const l = App.talentEntwurf.talents.filter((x) => x !== k);
      if (t.checked) l.push(k);
      App.talentEntwurf.talents = l;
    }
    return;
  }
  bogenEingabe(t);
});
// Solange im Bogen getippt wird, NICHT neu aufbauen (sonst waeren Fokus und
// Cursor weg, sobald irgendwer am Tisch etwas tut). Nach dem Verlassen des
// Felds den zurueckgehaltenen Stand nachholen.
function tipptImBogen() {
  const a = document.activeElement;
  // Auch das Schadensfeld der Treffer-Auswahl (SL): sonst wäre die Eingabe
  // bei jedem Server-Update weg.
  // Und die Beitrittsseite: kam dort ein Update (jemand anderes trat bei),
  // verlor man mitten im Tippen Fokus und Tastatur.
  return !!(a && a.closest && a.closest(".bogen-form, .al-treffer, .angriff-popup, .join-form") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "treffer-schaden") App.trefferSchaden = e.target.value;
  if (e.target && e.target.id === "joinneu") App.joinEntwurf.neuName = e.target.value;
  if (e.target && e.target.id === "joinname") App.joinEntwurf.spielerName = e.target.value;
  // Angriffs-Fenster: Vorschlag sofort neu rechnen (einmal neu zeichnen, Fokus
  // und Cursor danach wiederherstellen).
  if (e.target && e.target.id === "angriff-schaden") {
    App.angriffSchaden = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const neu = $("angriff-schaden");
    if (neu) { neu.focus(); try { neu.setSelectionRange(pos, pos); } catch { /* type=number */ } }
  }
});
// ABER nicht, solange Finger/Maus noch unten sind: Tippt man vom Feld direkt
// auf einen Knopf (Reiter, Speichern), verliert das Feld den Fokus schon beim
// Herunterdruecken. Ein Neuaufbau in diesem Moment tauschte den Knopf unter
// dem Finger aus - der Klick ging ins Leere. Darum erst nach dem Loslassen.
let zeigerUnten = false;
function bogenNachholen() {
  if (App.bogenWartet && !tipptImBogen() && !zeigerUnten && !blattScrollt()) { App.bogenWartet = false; render(); }
}
// Scrollt der Spieler gerade in der Zielwahl? Dann nicht neu aufbauen - ein
// Neuaufbau mitten im Schwung stoppt das Scrollen (das „Hängen").
function blattScrollt() {
  return !!(App._blattScrollZeit && Date.now() - App._blattScrollZeit < 700);
}
document.addEventListener("scroll", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("angriff-blatt")) App._blattScrollZeit = Date.now();
}, true);
document.addEventListener("pointerdown", () => { zeigerUnten = true; }, true);
// Beitritt: „Los" auf der Handy-Tastatur tritt direkt bei.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.id === "joinneu") { e.preventDefault(); e.target.blur(); doJoin(null, true); }
});
const zeigerOben = () => { zeigerUnten = false; setTimeout(bogenNachholen, 60); };
document.addEventListener("pointerup", zeigerOben, true);
document.addEventListener("pointercancel", zeigerOben, true);
document.addEventListener("focusout", () => setTimeout(bogenNachholen, 0));

// ---------- Spieler-Ansicht ----------

function renderPlayer() {
  const s = App.state;
  const mine = s.combatants.find((c) => c.playerId === App.myPlayerId);

  if (!App.joined || !mine) return renderJoin();
  // Für „Weiter als …" beim nächsten Beitritt (auch nach „Verlassen").
  if (mine.characterId && App._gemerkterChar !== mine.characterId) {
    App._gemerkterChar = mine.characterId;
    merkeLetztenCharakter(mine.characterId, mine.name);
  }

  const isMyTurn = s.activeId === mine.id && s.phase === "running";
  const banner = isMyTurn ? `<div class="myturn-banner">Du bist dran!</div>` : "";
  // Der Sekunden-Ring nur bei dem, der WIRKLICH dran ist - bei allen anderen
  // tickte er mit und machte unnoetig Druck. Wer als Naechster kommt, bekommt
  // stattdessen eine Vorwarnung, alle anderen sehen nur, wer gerade dran ist.
  const aktiv = s.combatants.find((c) => c.id === s.activeId);
  const binNaechster = !isMyTurn && !mine.benched && (naechsterAkteur(s) || {}).id === mine.id;
  const werDran = aktiv
    ? (aktiv.kind === "npc" && !aktiv.ally ? "Ein Gegner ist dran" : `${esc(aktiv.name)} ist dran`)
    : "";
  const vorwarnung = binNaechster && s.phase !== "idle"
    ? `<div class="gleich-dran">⏳ Gleich bist du dran – mach dich bereit!</div>` : "";
  const timer = s.phase === "running"
    ? (isMyTurn ? (s.timerEndsAt ? timerRing() : `<div class="timer-halt">⏸ Uhr angehalten – würfle in Ruhe</div>`)
      : `${vorwarnung}<div class="center muted small">${werDran}</div>`)
    : (s.phase === "gate" ? `${vorwarnung}<div class="center muted small">Warte auf Freigabe durch den Spielleiter…</div>` : "");

  // Karten-Hinweise („Joker: +2 …", „Berechnend" bei niedriger Karte) erst,
  // wenn die eigene Karte aufgedeckt ist - sonst stand unter der verdeckten
  // Karte schon, was drunter liegt.
  const hints = activeHints(mine, !mine.card || !!mine.revealed).map((h) => `<div class="pill warn" style="margin:4px 2px">${esc(h)}</div>`).join("");

  // Abwarten darf JEDE Figur (SW-Regel) – sinnvoll ansagen kann man es, wenn
  // man gerade dran ist.
  let holdBtn = "";
  if (!mine.held && isMyTurn) holdBtn = `<button data-act="hold" data-id="${mine.id}">Abwarten ⏸</button>`;
  if (mine.held) holdBtn = `<button class="primary big" data-act="intervene" data-id="${mine.id}">Jetzt eingreifen! ⚡</button>`;

  // Dran: der Hauptknopf ist „⚔ Angreifen" (Ziel wählen, der SL entscheidet,
  // man sieht nur das Ergebnis). „Zug beenden" bleibt klein daneben - für Züge
  // ohne Angriff. Ohne Anfragen-System (SL hat es abgeschaltet) wie früher.
  const meinAngriff = (s.requests || []).find((r) => r.kind === "attack" && r.combatantId === mine.id);
  // Eigener Schalter (Kampf-Einstellungen), unabhängig vom Anfragen-System.
  const angriffMoeglich = isMyTurn && s.spielerAngriff !== false;
  const angriffZiel = meinAngriff && s.combatants.find((c) => c.id === (meinAngriff.detail || {}).targetId);
  const angriffBtn = !angriffMoeglich ? ""
    : meinAngriff
      ? `<div class="angriff-wartet">⚔ Angriff auf <b>${esc(angriffZiel ? angriffZiel.name : "?")}</b> gemeldet – der Spielleiter entscheidet ⏳</div>`
      : `<button class="primary big angriff-knopf" data-act="angriff-waehlen">⚔ Angreifen</button>`;
  const confirmBtn = isMyTurn
    ? (angriffMoeglich
        ? `<button class="ghost" data-act="confirm-turn" title="Zug ohne (weiteren) Angriff beenden">Zug beenden ✓</button>`
        : `<button class="good big" data-act="confirm-turn">Zug bestätigen ✓</button>`)
    : "";
  // Angeschlagen + man ist dran: ein deutlicher Knopf, um sich (nach bestandener
  // Willenskraft- oder Konstitutions-Probe) zu erholen – meldet es dem SL, statt es im Zustand-Menü zu suchen.
  const mySt = mine.status || {};
  // Schon sobald man an der Reihe ist (auch vor der Freigabe durch den SL):
  // Angeschlagen heißt, der Zug beginnt mit der Erholungs-Probe (Willenskraft
  // oder Konstitution - Stefan: am Tisch geht beides).
  const binDran = s.activeId === mine.id;
  // Erholen ist keine Anfrage mehr (gilt sofort) - geht auch ohne Anfragen.
  const canRecover = binDran && mySt.shaken && !mySt.out;
  const recoverFreeBtn = canRecover
    ? `<button class="primary big" data-act="player-request" data-kind="status" data-detail='{"shaken":false}' data-label="ist nicht mehr angeschlagen">😵➜✓ Erholt (Probe geschafft)</button>`
    : "";
  const recoverBennyBtn = (canRecover && mine.isWildCard && (mine.bennies || 0) > 0)
    ? `<button class="good big" data-act="player-request" data-kind="recover" data-detail='{"benny":true}' data-label="gibt einen Benny aus und ist erholt">🪙➜✓ Benny ausgeben</button>`
    : "";
  const recoverGemeldet = (s.requests || []).some((r) => r.combatantId === mine.id && (r.kind === "recover" || (r.kind === "status" && (r.detail || {}).shaken === false)));
  const angeschlagenHinweis = binDran && mySt.shaken && !mySt.out ? `<div class="angeschlagen-hinweis">
      <div class="ah-titel">😵 Du bist angeschlagen</div>
      <div>Würfle zuerst <b>Willenskraft</b> oder <b>Konstitution</b>. Geschafft? Dann bist du erholt und kannst normal handeln.${
        mine.isWildCard ? " Oder gib einen <b>Benny</b> aus – dann sofort." : ""}</div>
      ${recoverGemeldet ? `<div class="zone-hint">An den Spielleiter geschickt ⏳</div>` : ""}
    </div>` : "";

  const myMsgs = s.messages.filter((m) => m.target === "all" || m.target === App.myPlayerId);
  const msgs = myMsgs.slice().reverse().slice(0, 8)
    .map((m) => `<div class="msg"><div class="to">${m.sender === "mimi" ? "🐈 Mimi" : m.sender === "kampf" ? "⚔ Kampf" : "Spielleiter"}</div>${m.text ? mehrzeilig(m.text) : ""}${m.imageUrl ? `<img src="${esc(m.imageUrl)}" data-act="open-image" data-url="${esc(m.imageUrl)}">` : ""}</div>`).join("");

  // Blockierendes Banner NUR für echte SL-Nachrichten (Mimis Miau ist ein Toast).
  const gmMsgs = myMsgs.filter((m) => m.sender !== "mimi" && m.sender !== "kampf");
  const newest = gmMsgs[gmMsgs.length - 1];
  const msgBanner = newest && newest.ts > App.lastSeenMsgTs
    ? `<div class="msg-overlay">
         <div class="msg-card">
           <div class="muted small">${newest.sender === "mimi" ? "🐈 Nachricht von Mimi" : "✉ Nachricht vom Spielleiter"}</div>
           ${newest.text ? `<div class="msg-text">${mehrzeilig(newest.text)}</div>` : ""}
           ${newest.imageUrl ? `<img src="${esc(newest.imageUrl)}">` : ""}
           <button class="primary big" data-act="dismiss-msg" data-ts="${newest.ts}" style="margin-top:14px;width:100%">Verstanden</button>
         </div>
       </div>`
    : "";

  const playerTag = mine.playerName && mine.playerName !== mine.name
    ? `<div class="muted small">Spieler: ${esc(mine.playerName)}</div>` : "";

  // Pausiert („Aus dem Kampf") – keine Karte, klarer Hinweis statt Kartenbereich.
  const cardPanel = mine.benched
    ? `<div class="panel benched-note" style="padding:16px; text-align:center">
         <div style="font-size:1.6rem">⏸</div>
         <div style="font-weight:600; margin-top:4px">Du bist gerade nicht im Kampf.</div>
         <div class="muted small" style="margin-top:4px">Der Spielleiter nimmt dich wieder rein (z. B. zum Rundenende). Solange bekommst du keine Karten.</div>
         ${bigStatusDisplay(mine)}
       </div>`
    : `<div class="panel" style="padding:12px">
      <div class="big-card tilt3d" id="bigcard" style="max-width:250px">${cardSlot(mine.id, mine.card, mine.status, "", { open: !!mine.revealed, tappable: !mine.revealed })}</div>
      ${bigStatusDisplay(mine)}
      ${hints ? `<div class="center" style="margin-top:6px">${hints}</div>` : ""}
      ${s.phase !== "idle" ? `<div style="margin-top:8px">${timer}</div>` : ""}
      ${angeschlagenHinweis}
      ${playerQuickControls(mine)}
    </div>`;

  // Die Initiative-Reihenfolge erst zeigen, wenn die EIGENE Karte offen ist.
  // Sonst sieht man vor dem Antippen schon die Plaetze der Gegner (deren Karten
  // gelten beim Austeilen sofort als aufgedeckt) und der eigene Aufdeck-Moment
  // verpufft. Ohne Karte (vor dem Austeilen) oder pausiert gibt es nichts zu
  // verraten -> normal anzeigen. Waehrend der Aufdeck-Animation ist das Rendern
  // gesperrt; die Liste erscheint also erst, wenn die Karte fertig liegt.
  const reihenfolgeGesperrt = !mine.benched && !!mine.card && !mine.revealed;
  const orderPanel = reihenfolgeGesperrt
    ? section("order", "Initiative-Reihenfolge",
      `<div class="order-locked">🂠 Deck erst deine Karte auf –<br>dann siehst du die Reihenfolge.</div>`)
    : renderOrderPanel(false);

  // Reihenfolge: Eigene Karte → Reihenfolge → Kampfzonen → Aktionen → Zustände.
  // Schmale Leiste, die beim Scrollen oben stehen bleibt: „wer ist dran" war
  // sonst nur ganz oben zu sehen - bei langer Seite scrollt man daran vorbei.
  const dranLeiste = s.round && werDran
    ? `<div class="dran-leiste${isMyTurn ? " ich" : ""}">${isMyTurn ? "▶ Du bist dran!" : esc(werDran)}${
        binNaechster && !isMyTurn ? " · du kommst als Nächstes" : ""}</div>`
    : "";

  // Der Daumen-Knopf: EIN großer Knopf unten, immer an derselben Stelle, der
  // das anbietet, was gerade dran ist - Karte aufdecken, erholen, angreifen,
  // eingreifen. Vorher standen bis zu fünf Knöpfe in der Karte verteilt, und
  // wer weiter unten im Bogen war, musste erst zurückscrollen.
  const daumen = daumenKnopf({ mine, isMyTurn, angriffMoeglich, meinAngriff, angriffZiel,
    canRecover: canRecover && !recoverGemeldet, recoverFreeBtn, recoverBennyBtn, confirmBtn, holdBtn, angriffBtn });

  const wuerfelListe = `<datalist id="wuerfel-vorschlaege">${WUERFEL.map((w) => `<option value="${w}">`).join("")}</datalist>`;

  return `
    ${wuerfelListe}
    ${msgBanner}
    ${dranLeiste}
    <div class="row spread" style="margin-bottom:6px">
      <div class="row tight" style="align-items:center">
        <label class="avatar big" title="Eigenes Bild wählen/ändern" style="cursor:pointer">
          ${mine.image ? `<img src="${esc(mine.image)}" alt="">` : esc(zoneInitials(mine.name))}
          <input type="file" accept="image/*" data-act="pick-char-image" data-id="${mine.id}" style="display:none">
        </label>
        <div><h1 style="margin:0; font-size:1.25rem">${esc(mine.name)}</h1>${playerTag}</div>
      </div>
      <div class="row tight" style="align-items:center">
        ${rundenZaehler(s)}
        <button class="ghost small" data-act="leave">Verlassen</button>
      </div>
    </div>
    ${banner}
    ${cardPanel}
    ${renderBogen(mine)}
    ${orderPanel}
    ${mine.benched ? "" : renderZonesPanel()}
    <label class="row tight" style="align-items:center; justify-content:center; margin-top:10px; cursor:pointer">
      <input type="checkbox" data-act="toggle-notify" ${localStorage.getItem("notifyTurn") !== "off" ? "checked" : ""} style="width:auto">
      <span class="small muted">🔔 ${kannVibrieren ? "Vibration/Ton" : "Ton"}, wenn ich dran bin</span>
      <button class="ghost small" data-act="ton-testen" title="Lautstärke prüfen – am iPhone muss der Lautlos-Schalter aus sein">▶ Test</button>
    </label>
    ${msgs ? `<div class="panel"><h2>Nachrichten vom Spielleiter</h2>${msgs}</div>` : ""}
    ${daumen}
  `;
}

// Was der große Knopf unten gerade anbietet - in dieser Reihenfolge: wer
// abwartet, will eingreifen; angeschlagen heißt erst erholen; dann der Zug
// selbst; ansonsten die eigene Karte aufdecken. Nichts zu tun: keine Leiste.
function daumenKnopf(o) {
  const { mine, isMyTurn, angriffMoeglich, meinAngriff, angriffZiel } = o;
  let haupt = "", neben = "", blatt = "";
  // Sofort zeigen, dass „Erholt" angekommen ist - nicht erst, wenn der Server
  // antwortet. Vorher blieb der Knopf kurz unverändert, dann stand an GENAU
  // der Stelle „Angreifen": wer nochmal tippte, griff ungewollt an.
  const erholWartet = App.erholGetippt && App.erholGetippt.id === mine.id && Date.now() - App.erholGetippt.t < 4000;
  if (mine.held) {
    haupt = o.holdBtn;                                  // „Jetzt eingreifen! ⚡"
  } else if (o.canRecover && erholWartet) {
    haupt = `<div class="angriff-wartet">✓ Erholung gemeldet ⏳</div>`;
  } else if (o.canRecover) {
    haupt = o.recoverFreeBtn; neben = o.recoverBennyBtn;
  } else if (isMyTurn && meinAngriff) {
    // Kein „Zug beenden" daneben: sonst endet der Zug, bevor der SL entschieden hat.
    haupt = `<div class="angriff-wartet">⚔ Angriff auf <b>${esc(angriffZiel ? angriffZiel.name : "?")}</b> – der Spielleiter entscheidet ⏳</div>`;
  } else if (isMyTurn && angriffMoeglich) {
    haupt = App.angriffWahl
      ? `<button class="ghost big" data-act="angriff-waehlen">✕ Angriff abbrechen</button>`
      : o.angriffBtn;
    neben = App.angriffWahl ? "" : o.confirmBtn + o.holdBtn;
    // Die Ziele direkt über dem Daumen - vorher standen sie oben in der Karte,
    // und das Hinscrollen klappte am Handy nicht immer.
    // Beim Angreifen gehört der ganze Bildschirm der Zielwahl (Stefan): im
    // halbhohen Streifen über dem Daumen scrollte bei vielen Figuren die Seite
    // mit den Zonen dahinter mit, und es hakte.
    if (App.angriffWahl) blatt = `<div class="angriff-blatt" data-scroll-merk="angriff">${angriffWahlHtml(mine)}</div>`;
  } else if (isMyTurn) {
    haupt = o.confirmBtn; neben = o.holdBtn;
  } else if (mine.card && !mine.revealed && !mine.benched) {
    haupt = `<button class="primary big" data-act="daumen-aufdecken">🂠 Karte aufdecken</button>`;
  }
  if (!haupt) return "";
  return `${blatt}<div class="aktionsleiste daumen-leiste">
    <div class="dl-haupt">${haupt}</div>${neben ? `<div class="dl-neben">${neben}</div>` : ""}
  </div>`;
}

// Beitritt in EINEM Tippen. Wer hier schon mal gespielt hat, bekommt seinen
// Charakter groß vorgeschlagen; sonst eine Liste großer Knöpfe (antippen =
// beigetreten). Früher: Auswahlliste + zwei Namensfelder - der Name des neuen
// Charakters landete gern im falschen Feld, dann kam nur ein alert() und
// nichts beim Server an („konnte keinen neuen Char erstellen", 1.1). Was
// getippt ist, steht in App.joinEntwurf und übersteht jedes Neuzeichnen.
function letzterCharakter() {
  const roster = (App.state && App.state.roster) || [];
  let m = null;
  try { m = JSON.parse(localStorage.getItem("letzterCharakter") || "null"); } catch { /* egal */ }
  const id = (m && m.id) || App.myCharacterId;
  return roster.find((r) => r.id === id)
    // ID weg (Sicherung eingespielt, Charakter neu angelegt): am Namen erkennen.
    || (m && m.name && roster.find((r) => (r.name || "").trim().toLowerCase() === m.name.trim().toLowerCase()))
    || null;
}
// Spielt diesen Charakter gerade jemand anderes (verbundenes Gerät)? Dann nicht
// anbieten - der Server lehnt den Beitritt sonst ab (wie charakter_aktiv_belegt).
function charakterBelegt(charId) {
  const s = App.state || {};
  const c = (s.combatants || []).find((x) => x.characterId === charId && x.playerId && x.playerId !== App.myPlayerId);
  const p = c && (s.players || []).find((x) => x.id === c.playerId);
  return !!(p && p.connected);
}
function merkeLetztenCharakter(id, name) {
  try { localStorage.setItem("letzterCharakter", JSON.stringify({ id: id || null, name: name || "" })); } catch { /* egal */ }
}
function joinAvatar(r) {
  const k = zoneInitials(r.name);
  return `<span class="avatar join-av">${r.image ? `<img src="${esc(r.image)}" alt="">`
    : `<span class="av-init${k.length > 2 ? " eng" : ""}">${esc(k)}</span>`}</span>`;
}

function renderJoin() {
  const s = App.state;
  const E = App.joinEntwurf;
  const fehler = App.joinFehler
    ? `<div class="pill bad" style="display:block; line-height:1.5; margin-bottom:10px">${esc(App.joinFehler)}</div>`
    : "";
  let letzter = letzterCharakter();
  if (letzter && charakterBelegt(letzter.id)) letzter = null;   // gerade woanders im Spiel
  // Ohne Charakterliste (erster Abend) gleich das Namensfeld.
  let modus = !s.roster.length ? "neu" : (E.modus || (letzter ? "weiter" : "liste"));
  if (modus === "weiter" && !letzter) modus = "liste";
  const spielerFeld = `<label class="field join-spieler"><span>Dein Name <small class="muted">(optional)</small></span>
      <input id="joinname" value="${esc(E.spielerName)}" placeholder="z. B. Stefan" maxlength="40" autocomplete="off"></label>`;

  // Neuen Charakter erstellen: ein eigener, großer Knopf unter der Auswahl -
  // als kleiner Link bzw. gestrichelte Kachel wurde er übersehen (Stefan).
  const neuKnopf = `<div class="join-oder"><span>oder</span></div>
      <button class="big join-erstellen" data-act="join-modus" data-modus="neu">
        <span class="join-plus">＋</span><span>Neuen Charakter erstellen</span></button>`;
  let inhalt;
  if (modus === "weiter") {
    inhalt = `
      <button class="primary big join-weiter" data-act="join-als" data-id="${letzter.id}">
        ${joinAvatar(letzter)}<span>Weiter als <b>${esc(letzter.name)}</b></span></button>
      <div class="join-links"><button class="ghost small" data-act="join-modus" data-modus="liste">Anderen Charakter wählen …</button></div>
      ${neuKnopf}`;
  } else if (modus === "liste") {
    const knoepfe = s.roster.map((r) => charakterBelegt(r.id)
      ? `<div class="join-char belegt" title="Spielt gerade jemand anderes">${joinAvatar(r)}<span class="join-char-name">${esc(r.name)}<small>wird gespielt</small></span></div>`
      : `<button class="join-char${letzter && letzter.id === r.id ? " zuletzt" : ""}" data-act="join-als" data-id="${r.id}">
        ${joinAvatar(r)}<span class="join-char-name">${esc(r.name)}</span></button>`).join("");
    const frei = s.roster.some((r) => !charakterBelegt(r.id));
    inhalt = `
      <div class="join-titel">Charakter wählen</div>
      <div class="muted small" style="margin-bottom:8px">${frei ? "Antippen – schon bist du drin." : "Alle Charaktere sind vergeben – erstell dir einen neuen."}</div>
      <div class="join-liste">${knoepfe}</div>
      ${neuKnopf}
      ${spielerFeld}
      <div class="join-links">
        ${letzter ? `<button class="ghost small" data-act="join-modus" data-modus="weiter">← zurück</button>` : ""}
        <button class="ghost small" data-act="join-als" data-id="" title="Ohne eigene Figur mitschauen">👁 Nur zuschauen</button>
      </div>`;
  } else {
    // Klar sagen, dass hier ein Charakter ENTSTEHT - „Beitreten" allein las
    // sich beim ersten Start, als fehle die Charakterwahl (Stefan).
    inhalt = `
      <div class="join-titel">➕ Neuen Charakter erstellen</div>
      ${s.roster.length ? "" : `<div class="muted small" style="margin-bottom:8px">Noch keine Charaktere da – leg deinen an. Werte trägst du danach im Charakterbogen ein.</div>`}
      <label class="field"><span>Name des Charakters</span>
        <input id="joinneu" value="${esc(E.neuName)}" placeholder="z. B. Tessa" maxlength="40" autocomplete="off" enterkeyhint="go"></label>
      ${spielerFeld}
      <button class="primary big" data-act="join-neu" style="width:100%">Charakter erstellen &amp; beitreten</button>
      ${s.roster.length ? `<div class="join-links"><button class="ghost small" data-act="join-modus" data-modus="liste">← zur Liste</button></div>` : ""}`;
  }
  return `
    <h1 class="center">Sundered Skies · Beitreten</h1>
    <div class="panel join-form">
      ${fehler}
      ${inhalt}
    </div>
    ${handyTipp()}
    <div class="center muted small">Nichts zu installieren – läuft direkt im Browser.</div>
    <div class="center muted small" style="margin-top:4px; opacity:0.75">Inoffizielles Fanprojekt für Savage Worlds: Sundered Skies.</div>
  `;
}

// Vorbeugen statt mitten im Kampf suchen: faellt beim Gastgeber das Internet
// aus, springen Handys still auf Mobilfunk und verlieren den Spieltisch. Nur auf
// Touch-Geraeten zeigen – am Laptop waere „Flugmodus" verwirrend.
function handyTipp() {
  let touch = false;
  try { touch = window.matchMedia("(pointer: coarse)").matches; } catch { /* egal */ }
  if (!touch) return "";
  return `<div class="panel verbindungs-tipp">
      <div class="verbindungs-tipp-titel">📶 Tipp für ein stabiles Spiel</div>
      <div><b>Flugmodus an</b> und danach nur <b>WLAN</b> wieder einschalten – oder
      mobile Daten aus.</div>
      <div class="muted small">Sonst springt das Handy bei Internet-Aussetzern im WLAN
      still auf Mobilfunk und verliert den Spieltisch.</div>
    </div>`;
}

// --- Ereignisse (Delegation) ------------------------------------------------

document.addEventListener("click", (e) => {
  // Klick auf den abgedunkelten Hintergrund des Token-Popups schließt es.
  if (App.tokenPopupId && e.target.classList && e.target.classList.contains("token-popup")) {
    App.tokenPopupId = null; render(); return;
  }
  const target = e.target.closest("[data-act]");
  if (!target) return;
  // Daumen-Knopf gerade gewechselt? Dann galt der Tipp noch dem alten Knopf
  // (Doppeltipp, weil der erste scheinbar nicht ankam) - nicht auslösen.
  if (target.closest(".daumen-leiste .dl-haupt, .daumen-leiste .dl-neben") && Date.now() - (App._daumenSeit || 0) < 700) {
    e.preventDefault(); return;
  }
  const act = target.getAttribute("data-act");
  const id = target.getAttribute("data-id");
  const S = App.state;

  const handlers = {
    // SL – Kampf
    "new-round": () => gmAction({ type: "new_round" }),
    "alle-wieder-rein": () => gmAction({ type: "unbench_all" }),
    "clear-all": async () => {
      if (await frage("Kampf abräumen?\n\nAlle Gegner und Verbündeten werden entfernt, die Spieler pausiert (sie bleiben verbunden und behalten ihren Charakter). Die Zonen sind danach leer.\n\nRückgängig geht mit ↶.", "Abräumen", true)) gmAction({ type: "clear_all" });
    },
    "reset": async () => { if (await frage("Initiative komplett zurücksetzen?", "Zurücksetzen", true)) gmAction({ type: "reset" }); },
    "release": () => gmAction({ type: "release" }),
    "confirm-turn": () => gmActionOrPlayer({ type: "confirm_turn" }),
    "skip-turn": () => gmAction({ type: "confirm_turn" }),   // ohne Timer zum nächsten
    "redraw": () => gmAction({ type: "redraw", id }),
    "set-active": () => gmAction({ type: "set_active", id }),
    "edit-combatant": () => { App.editCombatantId = App.editCombatantId === id ? null : id; render(); },
    "save-combatant": () => saveCombatant(id),
    "cancel-edit-combatant": () => { App.editCombatantId = null; render(); },
    "bild-entfernen": async () => {
      if (await frage("Porträt dieser Figur entfernen?", "Entfernen", true)) gmAction({ type: "set_image", id, url: null });
    },
    "bench": () => gmAction({ type: "bench", id, on: target.getAttribute("data-on") === "1" }),
    "remove-combatant": async () => {
      const c = findCombatant(id);
      const msg = c && c.playerId ? `Spieler "${c.name}" endgültig entfernen (Kick)?` : `${c ? c.name : "Teilnehmer"} entfernen?`;
      if (await frage(msg, "Entfernen", true)) gmAction({ type: "remove_combatant", id });
    },
    "resume": () => gmAction({ type: "resume_session" }),
    "discard-session": () => gmAction({ type: "discard_session" }),
    // SL – Charakterliste
    "new-char": () => renderCharForm(null),
    "roster-to-combat": () => {
      const z = parseInt(($("rosterzone") || {}).value, 10);
      gmAction({ type: "add_from_roster", id, zone: isNaN(z) ? undefined : z });
    },
    "edit-char": () => renderCharForm(S.roster.find((r) => r.id === id)),
    "cancel-char": () => { const h = $("charform"); if (h) h.innerHTML = ""; },
    "save-char": saveChar,
    "delete-char": async () => { if (await frage("Charakter löschen?", "Löschen", true)) gmAction({ type: "roster_delete", id }); },
    // SL – Gegner-Bibliothek
    "bestiary-new": () => renderBestiaryForm(null),
    "bestiary-edit": () => renderBestiaryForm((S.bestiary || []).find((r) => r.id === id)),
    "bestiary-save": saveBestiary,
    "bestiary-cancel": () => { const h = $("bestiaryform"); if (h) h.innerHTML = ""; },
    "bestiary-delete": async () => { if (await frage("Gegner-Typ löschen?", "Löschen", true)) gmAction({ type: "bestiary_delete", id }); },
    "bestiary-to-combat": () => {
      const z = parseInt(($("bestzone") || {}).value, 10);
      const anzahl = parseInt(($("bestcount") || {}).value, 10);
      gmAction({
        type: "add_npc_from_bestiary", id,
        zone: isNaN(z) ? undefined : z,
        count: isNaN(anzahl) ? 1 : anzahl,
        anon: !!($("bestanon") || {}).checked,
      });
    },
    "set-anon": () => gmAction({ type: "set_anon", id, on: target.getAttribute("data-on") === "1" }),
    "bilder-aufraeumen": () => bilderAufraeumen(),
    // SL – Gruppen
    "group-new": async () => {
      const name = await eingabe("Name der Gruppe? (z. B. Ork-Trupp)", "", "Anlegen");
      if (name && name.trim()) gmAction({ type: "group_create", name: name.trim() });
    },
    "group-rename": async () => {
      const g = (App.state.groups || []).find((x) => x.id === target.dataset.group);
      const name = await eingabe("Gruppe umbenennen:", g ? g.name : "", "Umbenennen");
      if (name && name.trim()) gmAction({ type: "group_rename", group: target.dataset.group, name: name.trim() });
    },
    "group-delete": async () => {
      if (await frage("Gruppe auflösen? Die Figuren bleiben im Kampf.", "Auflösen")) {
        gmAction({ type: "group_delete", group: target.dataset.group });
      }
    },
    // SL – Verbündeten-Bibliothek
    "ally-new": () => renderAllyForm(null),
    "ally-edit": () => renderAllyForm((S.allies || []).find((r) => r.id === id)),
    "ally-save": saveAlly,
    "ally-cancel": () => { const h = $("allyform"); if (h) h.innerHTML = ""; },
    "ally-delete": async () => { if (await frage("Verbündeten-Typ löschen?", "Löschen", true)) gmAction({ type: "ally_delete", id }); },
    // SL – Begegnungen (gespeicherte Gruppen)
    "encounter-save": async () => {
      const name = await eingabe("Name der Begegnung? (z. B. Skree-Überfall)", "", "Speichern");
      if (name && name.trim()) gmAction({ type: "save_encounter", name: name.trim() });
    },
    "encounter-to-combat": () => gmAction({ type: "add_encounter", id }),
    "encounter-delete": async () => { if (await frage("Begegnung löschen?", "Löschen", true)) gmAction({ type: "delete_encounter", id }); },
    "ally-to-combat": () => {
      const z = parseInt(($("allyzone") || {}).value, 10);
      gmAction({ type: "add_ally_from_library", id, zone: isNaN(z) ? undefined : z });
    },
    // SL – Nachrichten
    "send-message": sendMessage,
    "clear-image": () => { App.pendingImageUrl = null; render(); },
    "clear-messages": () => gmAction({ type: "clear_messages" }),
    "clear-tv": () => gmAction({ type: "clear_tv_image" }),
    // Spieler-Anfragen
    "toggle-req-mode": () => { App.reqMode = !App.reqMode; render(); },
    "player-request": () => {
      const k = target.getAttribute("data-kind");
      if (target.closest(".daumen-leiste") && (k === "recover" || k === "status")) {
        const m = myCombatant();
        if (m) App.erholGetippt = { id: m.id, t: Date.now() };
        setTimeout(render, 4100);     // falls der Server schweigt: Knopf wieder zeigen
      }
      let detail = {};
      try { detail = JSON.parse(target.getAttribute("data-detail") || "{}"); } catch { /* ignore */ }
      gmActionOrPlayer({ type: "request", kind: target.getAttribute("data-kind"), detail, label: target.getAttribute("data-label") });
      App.reqMode = false;   // nach dem Absenden wieder zuklappen (ruhige Ansicht)
      render();
    },
    "req-apply": () => gmAction({ type: "resolve_request", id, apply: true }),
    "req-dismiss": () => gmAction({ type: "resolve_request", id, apply: false }),
    // Spieler
    "join-als": () => doJoin(id || null, false),
    "join-neu": () => doJoin(null, true),
    "join-modus": () => {
      App.joinEntwurf.modus = target.dataset.modus; App.joinFehler = null; render();
      if (target.dataset.modus === "neu") { const f = $("joinneu"); if (f) f.focus(); }
    },
    "leave": doLeave,
    "hold": () => gmActionOrPlayer({ type: "hold", id }),
    "intervene": () => gmActionOrPlayer({ type: "intervene", id }),
    "reveal-card": () => revealBigCard(target),
    // Kampfzonen: Bewegen NUR über Bahn-Tipp + Bestätigung (s. zoneGoto).
    "set-zone": () => gmAction({ type: "set_zone", id, zone: parseInt(target.getAttribute("data-zone"), 10) }),
    // token-info + zone-goto werden per pointerdown behandelt (robuster, s. u.)
    "tp-remove": async () => {
      const c = findCombatant(id);
      const msg = c && c.playerId ? `Spieler "${c.name}" entfernen (Kick)?` : `${c ? c.name : "Teilnehmer"} entfernen?`;
      if (await frage(msg, "Entfernen", true)) gmAction({ type: "remove_combatant", id });
      App.tokenPopupId = null;
    },
    "attack-request": () => {
      if (!angriffMelden(id)) return;
      App.tokenPopupId = null; render();
    },
    "close-token-popup": () => { App.tokenPopupId = null; render(); },
    "zur-aktiven-zeile": () => zurAktivenZeile(true),
    "zustand-umschalten": () => {
      // Gemerkt in App.rowStatusOpen, damit ein Broadcast-Render es nicht zuklappt.
      if (App.rowStatusOpen.has(id)) App.rowStatusOpen.delete(id); else App.rowStatusOpen.add(id);
      render();
    },
    "leiste-einstellungen": () => { App.leisteEinstellungen = !App.leisteEinstellungen; App.trefferWahl = false; render(); },
    "treffer-wahl": () => { App.trefferWahl = !App.trefferWahl; App.trefferSteigerung = 0; App.leisteEinstellungen = false; render(); },
    "treffer-stufe": () => { App.trefferSteigerung = parseInt(target.dataset.n, 10) || 0; render(); },
    "treffer-auf": () => trefferAuf(id, e.shiftKey),
    "auswahl-leeren": () => { App.auswahl.clear(); render(); },
    "auswahl-gruppe": async () => {
      const name = await eingabe("Name der Gruppe?", "Trupp", "Gruppe anlegen");
      if (!name) return;
      gmAction({ type: "group_create", name: name.trim(), ids: [...App.auswahl] });
      App.auswahl.clear();
    },
    // Nur für die ziehbaren Marker/Chips des SL: bei denen darf pointerdown
    // nichts abfangen (sonst kein Ziehen), also öffnet der Klick das Fenster.
    // Ein echtes Ziehen löst gar keinen Klick aus - beides kommt sich nicht ins Gehege.
    // Im Ziel-Modus (🎯 Treffer offen) ist ein Token auf dem Board das Ziel.
    "token-info": () => {
      if (App.role === "gm" && App.trefferWahl && id !== S.activeId) { trefferAuf(id, e.shiftKey); return; }
      App.tokenPopupId = id; render();
    },
    "open-image": () => {
      App.overlayImage = target.getAttribute("data-url");
      const holder = target.closest("[data-cid]");
      const c = holder ? findCombatant(holder.getAttribute("data-cid")) : null;
      App.overlayName = target.getAttribute("data-name") || (c ? c.name : null);
      render();
    },
    "close-overlay": () => { App.overlayImage = null; App.overlayName = null; render(); },
    "dismiss-msg": () => {
      App.lastSeenMsgTs = Number(target.getAttribute("data-ts")) || Date.now();
      localStorage.setItem("lastSeenMsgTs", App.lastSeenMsgTs);
      render();
    },
    // Status (SL für alle, Spieler für sich selbst)
    "st-shaken": () => toggleStatus(id, "shaken"),
    "st-out": () => toggleStatus(id, "out"),
    "st-cond": () => toggleStatus(id, target.getAttribute("data-cond")),
    // Smart-Treffer (SW-Logik in einem Klick) + Erholen (frei / per Benny)
    "apply-hit": () => gmAction({ type: "apply_hit", id }),
    "apply-heal": () => gmAction({ type: "apply_heal", id }),
    "recover": () => gmAction({ type: "recover", id, benny: target.getAttribute("data-benny") === "1" }),
    // Ausgeschaltete Gegner aufräumen (SL) – nur Gegner, nicht Verbündete/Spieler
    "clear-defeated": async () => {
      const n = target.getAttribute("data-n") || "";
      if (await frage(`${n} ausgeschaltete Gegner aus dem Kampf entfernen?`, "Entfernen")) gmAction({ type: "clear_defeated" });
    },
    // Firewall in einem Klick freigeben (Windows-SL) -> löst UAC-Abfrage aus
    "firewall-allow": () => allowFirewall(),
    "fokus": () => fokusUmschalten(),
    "nur-offene": () => { App.nurOffene = !App.nurOffene; render(); },
    // Begegnung einsetzen, Spieler zurueckholen und austeilen - in einem Schritt.
    "encounter-start": async () => {
      const npcs = (S.combatants || []).filter((c) => c.kind === "npc").length;
      let ersetzen = false;
      if (npcs) {
        // Drei klare Knöpfe statt „OK = … / Abbrechen = …" (Abbrechen hieß
        // dort „dazustellen" - verwirrend, und wirklich abbrechen ging nicht).
        const wahl = await dialog({ text: `Es stehen noch ${npcs} Gegner/Verbündete im Kampf.`, knoepfe: [
          { text: "Abbrechen", wert: null, abbruch: true },
          { text: "Dazustellen", wert: "dazu" },
          { text: "Alte entfernen & frisch starten", wert: "neu", art: "primary", standard: true }] });
        if (!wahl) return;
        ersetzen = wahl === "neu";
      }
      gmAction({ type: "start_encounter", id, ersetzen });
    },
    "alle-zeigen": () => { App.alleZeigen = !App.alleZeigen; render(); },
    "bogen-reiter": () => { App.bogenReiter = target.getAttribute("data-reiter"); render(); },
    "bogen-bearbeiten": () => {
      const m = myCombatant();
      App.bogenEntwurf = bogenVon(m);
      App.talentEntwurf = { talents: [...(m.talents || [])], gluck: !!m.gluck, grosses_gluck: !!m.grosses_gluck };
      render();
    },
    "bogen-abbrechen": () => { App.bogenEntwurf = null; App.talentEntwurf = null; render(); },
    "bogen-speichern": () => {
      const mine = myCombatant();
      if (mine && App.bogenEntwurf) gmActionOrPlayer({ type: "sheet_update", id: mine.id, bogen: App.bogenEntwurf });
      if (mine && App.talentEntwurf) gmActionOrPlayer({ type: "talents_update", id: mine.id, ...App.talentEntwurf });
      App.bogenEntwurf = null;
      App.talentEntwurf = null;
      toast("📜 Gespeichert");
      render();
    },
    "bogen-dazu": () => {
      const liste = target.getAttribute("data-liste");
      if (!App.bogenEntwurf) return;
      App.bogenEntwurf[liste].push(liste === "waffen"
        ? { name: "", art: "nah", fertigkeit: "", schaden: "", info: "" }
        : { name: "", wert: "" });
      render();
    },
    "bogen-weg": () => {
      const liste = target.getAttribute("data-liste");
      if (!App.bogenEntwurf) return;
      App.bogenEntwurf[liste].splice(parseInt(target.getAttribute("data-i"), 10), 1);
      render();
    },
    "effekt-add": () => {
      const name = (($("effname-" + id) || {}).value || "").trim();
      if (!name) { toast("Erst einen Effekt eintragen"); return; }
      const runden = parseInt(($("effrunden-" + id) || {}).value, 10) || 0;
      gmAction({ type: "effect_add", id, name, runden });
    },
    "effekt-weg": () => gmAction({ type: "effect_remove", id, effekt: target.getAttribute("data-effekt") }),
    "effekt-plus": () => gmAction({ type: "effect_adjust", id, effekt: target.getAttribute("data-effekt"), delta: 1 }),
    "effekt-minus": () => gmAction({ type: "effect_adjust", id, effekt: target.getAttribute("data-effekt"), delta: -1 }),
    "anordnung-zuruecksetzen": () => {
      try { localStorage.removeItem("panelAnordnung"); } catch { /* egal */ }
      slAnsichtSichern();
      render();
    },
    "einladung-whatsapp": () => einladungWhatsApp(),
    "einladung-teilen": () => einladungTeilen(),
    "einladung-kopieren": () => einladungKopieren(),
    "einladung-bild": () => einladungsBildKopieren(),
    "qr-gross": () => qrGrossZeigen(),
    "bib-reiter": () => {
      try { localStorage.setItem("bibReiter", target.dataset.reiter); } catch { /* egal */ }
      render();
    },
    "gruppe-menue": () => {
      const gid = target.dataset.group;
      App.gruppeMenue = App.gruppeMenue === gid ? null : gid;
      render();
    },
    "gruppe-aufklappen": () => {
      const k = target.dataset.key;
      if (App.gruppeOffen.has(k)) App.gruppeOffen.delete(k); else App.gruppeOffen.add(k);
      render();
    },
    "tasten-hilfe": () => { App.tastenHilfe = !App.tastenHilfe; render(); },
    "ton-testen": () => {
      e.preventDefault();   // sitzt im <label> - sonst schaltet der Klick das Häkchen um
      tonWecken(); playBeep(660, 150); setTimeout(() => playBeep(990, 170), 170);
      try { if (kannVibrieren) navigator.vibrate([130, 70, 130]); } catch { /* egal */ }
      dranBlitz();
    },
    "km-treffer": () => { App.trefferSteigerung = parseInt(target.dataset.n, 10) || 0; App.trefferSchaden = ""; trefferAuf(id); },
    "angriff-eigene": () => { App.angriffEigene = !App.angriffEigene; render(); },
    "angriff-waehlen": () => {
      App.angriffWahl = !App.angriffWahl;
      App.angriffEigene = false;
      // Wer angreift, muss würfeln: Zug-Uhr sofort anhalten (Stefan: 6 s zu hart).
      if (App.angriffWahl && App.role !== "gm") { const m = myCombatant(); if (m) gmActionOrPlayer({ type: "timer_halt", id: m.id }); }
      render();
    },
    "daumen-aufdecken": () => {
      const karte = document.querySelector('#bigcard [data-act="reveal-card"]');
      if (!karte) return;
      // Erst nach oben, sonst dreht sich die Karte außer Sicht.
      const oben = window.scrollY < 40;
      if (!oben) try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
      setTimeout(() => revealBigCard(karte), oben ? 0 : 350);
    },
    "angriff-auf": () => { if (angriffMelden(id)) { App.angriffWahl = false; render(); } },
    // SL: Angriffs-Fenster wieder hervorholen bzw. auf später schieben
    "angriff-oeffnen": () => { App.angriffSpaeter.delete(id); render(); },
    "angriff-spaeter": () => { App.angriffSpaeter.add(id); render(); },
    "angriff-ergebnis": () => {
      const r = (S.requests || []).find((x) => x.id === id);
      if (!r) return;
      const angreifer = findCombatant(r.combatantId);
      const zugEnde = !!(angreifer && S.activeId === angreifer.id && App.angriffZugEnde);
      gmAction({ type: "resolve_attack", id, ergebnis: target.dataset.ergebnis,
        steigerungen: parseInt(target.dataset.stg, 10) || 0, zugEnde });
      App.angriffSchaden = "";
      toast(`⚔ Ergebnis an ${angreifer ? angreifer.name : "den Spieler"} geschickt${zugEnde ? " – Zug beendet" : ""}`);
    },
    "hilfe-umschalten": () => {
      const sec = target.dataset.sec;
      if (App.hilfeOffen.has(sec)) App.hilfeOffen.delete(sec); else App.hilfeOffen.add(sec);
      render();
    },
    "jetzt-verbinden": () => { App.wentOfflineAt = App.wentOfflineAt || Date.now(); ensureConnected(); adressFallback(); },
    // Rückgängig (SL)
    "undo": () => gmAction({ type: "undo" }),
    // Bennies
    "benny-plus": () => gmActionOrPlayer({ type: "benny_adjust", id, delta: 1 }),
    "benny-minus": () => gmActionOrPlayer({ type: "benny_adjust", id, delta: -1 }),
    // Benny an den oben gewaehlten Empfaenger - laeuft als kurze Nachricht
    // („🪙 +1 Benny"), damit der Spieler es auch mitbekommt.
    // Aus dem Verlauf/Archiv erneut schicken - an den oben gewaehlten Empfaenger,
    // nicht zwingend an den von damals (meist will man es jemand anderem zeigen).
    "nochmal-senden": () => {
      const m = (S.messages || []).find((x) => x.id === target.getAttribute("data-msg"));
      if (!m) return;
      const ziel = ($("msgtarget") || {}).value || m.target || "all";
      gmAction({ type: "message", target: ziel, text: m.text, imageUrl: m.imageUrl });
      toast(ziel === "all" ? "Nochmal an alle geschickt" : "Nochmal geschickt");
    },
    "auf-tv": () => {
      gmAction({ type: "message", target: "beamer", text: "", imageUrl: target.getAttribute("data-url") });
      toast("📺 Bild liegt auf dem TV");
    },
    "benny-geben": () => {
      const ziel = ($("msgtarget") || {}).value || "all";
      if (ziel === "beamer") { toast("Bennies gehen nur an Spieler"); return; }
      gmAction({ type: "message", target: ziel, text: "", bennies: 1 });
      toast(ziel === "all" ? "🪙 Jeder Spieler bekommt einen Benny" : "🪙 Benny verteilt");
    },
    "benny-refresh": async () => { if (await frage("Alle Wildcards auf Startwert auffrischen?", "Auffrischen", false)) gmAction({ type: "benny_refresh" }); },
    "sl-benny-plus": () => gmAction({ type: "sl_benny_adjust", delta: 1 }),
    "sl-benny-minus": () => gmAction({ type: "sl_benny_adjust", delta: -1 }),
  };
  if (handlers[act]) { e.preventDefault(); handlers[act](); }
  // Rechtsklick-Menü: nach der Aktion zu (außer „bleibt"-Knöpfe).
  if (App.kontextMenue && target.closest(".kontext-menue") && !target.classList.contains("km-bleibt")) kontextMenueZu();
});
// Klick irgendwo daneben schließt das Menü (vor allen anderen Klick-Handlern).
document.addEventListener("click", (e) => {
  if (App.kontextMenue && !e.target.closest(".kontext-menue")) kontextMenueZu();
}, true);

// Tastatur für den SL: bei 25 Figuren ist jeder gesparte Mausweg spürbar.
//   Leertaste / Enter → freigeben bzw. Zug bestätigen (der jeweils passende Schritt)
//   W                 → weiter (ohne Timer)
//   T / H             → Treffer / Heilung beim aktuellen Akteur
//   Z                 → Ziel wählen: wen trifft der aktuelle Akteur?
//   ?                 → Übersicht aller Tastenkürzel
// Läuft NICHT, während in ein Feld getippt wird - sonst schluckt es Buchstaben.
document.addEventListener("keydown", (e) => {
  if (App.role !== "gm" || !App.state) return;
  if (e.key === "Escape" && App.tastenHilfe) { App.tastenHilfe = false; render(); return; }
  if (e.key === "Escape" && App.auswahl.size) { App.auswahl.clear(); render(); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (e.key === "?") { e.preventDefault(); App.tastenHilfe = !App.tastenHilfe; render(); return; }
  const s = App.state;
  const aktiv = s.combatants.find((c) => c.id === s.activeId);
  // Runde durch (niemand mehr dran) oder noch nichts ausgeteilt: Leertaste
  // teilt die naechste Runde aus. Vorher musste man dafuer zur Maus greifen.
  if (!aktiv) {
    if ((e.key === " " || e.key === "Enter") && s.combatants.some((c) => !c.benched)) {
      e.preventDefault();
      gmAction({ type: "new_round" });
    }
    return;
  }

  const taste = e.key.toLowerCase();
  if (App.trefferWahl && /^[0-3]$/.test(e.key)) {
    e.preventDefault();
    App.trefferSteigerung = parseInt(e.key, 10);
    render();
    return;
  }
  if (App.trefferWahl && e.key === "Escape") { App.trefferWahl = false; render(); return; }
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    gmAction(s.phase === "running" ? { type: "confirm_turn" } : { type: "release" });
  } else if (taste === "w") {
    e.preventDefault();
    gmAction({ type: "confirm_turn" });     // „Weiter" = Zug beenden ohne Timer
  } else if (taste === "t") {
    e.preventDefault();
    gmAction({ type: "apply_hit", id: aktiv.id });
  } else if (taste === "h") {
    e.preventDefault();
    gmAction({ type: "apply_heal", id: aktiv.id });
  } else if (taste === "z") {
    e.preventDefault();
    App.trefferWahl = !App.trefferWahl;     // „Ziel": wen trifft der Aktive?
    App.leisteEinstellungen = false;
    render();
  }
});

// Kampfzonen-Auswahl per pointerdown statt click: die Aktion schließt sofort ab,
// unabhängig von einem gleich eintreffenden Broadcast-Render (behebt das „nur auf
// dem Icon loslassen"-Problem). Token = Info-Popup; freie Bahn = dorthin bewegen.
let tippStart = null;   // gemerkter Tipp: erst beim LOSLASSEN wird gehandelt

// Der Klick, den der Browser nach dem Loslassen nachschiebt, landet an derselben
// Stelle - und dort liegt dann das gerade geöffnete Fenster. Also einmal schlucken.
function schluckNaechstenKlick() {
  const weg = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener("click", weg, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", weg, true), 350);
}

// Strg-Klick auf eine Zeile der Reihenfolge (SL) sammelt ebenfalls - vorher
// ging das nur im Zonen-Board, in der Liste passierte beim Strg-Klick nichts.
document.addEventListener("pointerdown", (e) => {
  if (App.role !== "gm" || !(e.ctrlKey || e.metaKey)) return;
  const zeile = e.target.closest && e.target.closest(".order .combatant[data-cid]");
  if (!zeile || e.target.closest("button, input, select, label, a")) return;
  e.preventDefault();
  const id = zeile.dataset.cid;
  if (App.auswahl.has(id)) App.auswahl.delete(id); else App.auswahl.add(id);
  schluckNaechstenKlick();
  render();
}, true);

document.addEventListener("pointerdown", (e) => {
  // Nur die linke Taste bzw. der Finger. Ein Rechtsklick öffnete sonst beim
  // Loslassen das Info-Fenster über dem Rechtsklick-Menü (Stresstest 28.09.).
  if (e.button !== 0) { tippStart = null; return; }
  const t = e.target.closest('[data-act="token-info"], [data-act="zone-goto"]');
  if (!t) {
    tippStart = null;
    // Tipp daneben bricht eine schwebende Bewegungs-Bestätigung ab.
    if (App.pendingMove) { App.pendingMove = null; render(); }
    return;
  }
  const ziehbar = t.getAttribute("draggable") === "true";
  // Strg/Cmd-Klick (nur SL) sammelt Figuren, statt das Info-Fenster zu öffnen.
  if (ziehbar && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const id = t.getAttribute("data-id");
    if (App.auswahl.has(id)) App.auswahl.delete(id); else App.auswahl.add(id);
    render();
    return;
  }
  // NUR MERKEN - gehandelt wird beim Loslassen (pointerup). Früher öffnete das
  // Info-Fenster schon beim Aufsetzen, direkt unter dem Finger; beim Loslassen
  // landete der Tipp dann IM Fenster: auf dem Hintergrund (Fenster sofort wieder
  // zu - "geht beim Tippen nicht auf"), oder gar auf "Angreifen" (ungewollte
  // Aktion). Nur langes Halten klappte, weil das Handy den Tipp dann verwirft.
  // Gemerkt werden reine Werte statt des Elements: ein Neuzeichnen zwischen
  // Aufsetzen und Loslassen (Zustands-Update) schadet so nicht.
  tippStart = {
    x: e.clientX, y: e.clientY,
    act: t.getAttribute("data-act"), id: t.getAttribute("data-id"), tz: t.getAttribute("data-tz"),
  };
  // Ziehbare Marker (SL) NICHT abfangen: preventDefault() unterbindet das
  // native Ziehen, und Drag & Drop wäre tot.
  if (!ziehbar) e.preventDefault();
});

document.addEventListener("pointercancel", () => { tippStart = null; });   // Handy scrollt

document.addEventListener("pointerup", (e) => {
  const s = tippStart;
  tippStart = null;
  if (!s || gezogeneId) return;                                     // gezogen, kein Tipp
  if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) return;    // gewischt/gescrollt
  schluckNaechstenKlick();
  if (s.act === "token-info") {
    // Ist „🎯 Treffer" offen, ist die angetippte Figur das Ziel. (Der Weg über
    // den Klick-Handler kam nie an: der Klick wird oben geschluckt - mit der
    // Maus öffnete sich darum nur das Info-Fenster.)
    if (App.role === "gm" && App.trefferWahl && App.state && s.id !== App.state.activeId) {
      trefferAuf(s.id, e.shiftKey);
      return;
    }
    App.tokenPopupId = s.id;
    render();
  } else {
    zoneGoto(s.id, Number(s.tz));
  }
});

// Bahn-Tipp der eigenen Figur: 1 Schritt = normal, 2 = Rennen. Gegen Missclicks
// erst BESTÄTIGEN (zweiter Tipp auf dieselbe Bahn führt aus).
function zoneGoto(id, tz) {
  const c = App.state && App.state.combatants.find((x) => x.id === id);
  if (!c || isNaN(tz)) return;
  const delta = tz - Zones.zoneOf(c);
  const steps = Math.abs(delta);
  if (steps < 1 || steps > 2) return;
  if (App.pendingMove && App.pendingMove.id === id && App.pendingMove.tz === tz) {
    App.pendingMove = null;
    gmActionOrPlayer({ type: "move_zone", id, dir: delta < 0 ? -1 : 1, run: steps === 2 });
  } else {
    App.pendingMove = { id, tz, run: steps === 2 };
    render();
  }
}

// Spieler und SL nutzen denselben Kanal; der Server erlaubt Spielern nur eng
// begrenzte Aktionen (eigenen Zug bestätigen, Abwarten, Eingreifen).
function gmActionOrPlayer(action) { wsSend({ type: "gm_action", action }); }

// Hook für Mimi: NUR das SL-Gerät verschickt Mimis Miau-Nachrichten (sonst
// würde jede lokale Mimi spammen). Ziel: zufälliger verbundener Spieler oder alle.
window.mimiSend = function (text) {
  if (App.role !== "gm" || !App.state) return;
  const connected = (App.state.players || []).filter((p) => p.connected);
  const target = connected.length && Math.random() < 0.55
    ? connected[Math.floor(Math.random() * connected.length)].id : "all";
  gmAction({ type: "message", sender: "mimi", target, text });
};

document.addEventListener("change", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.getAttribute("data-act");
  if (act === "set-timer") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) gmAction({ type: "set_timer", seconds: v });
  } else if (act === "set-benny-start") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) gmAction({ type: "set_benny_start", value: v });
  } else if (act === "pick-image") {
    uploadImage(t.files[0]);
  } else if (act === "pick-char-image") {
    uploadCharImage(t.files[0], t.getAttribute("data-id"));
  } else if (act === "pick-bestiary-image") {
    uploadBestiaryImage(t.files[0]);
  } else if (act === "pick-ally-image") {
    uploadAllyImage(t.files[0]);
  } else if (act === "group-move") {
    // Verlässlicher Weg neben dem Ziehen – und der einzige auf dem Handy.
    const z = parseInt(t.value, 10);
    if (!isNaN(z)) gmAction({ type: "group_move", group: t.dataset.group, zone: z });
    t.value = "";
  } else if (act === "remember-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZone", String(v)); } catch {} }
  } else if (act === "remember-ally-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZoneAlly", String(v)); } catch {} }
  } else if (act === "remember-player-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZonePlayer", String(v)); } catch {} }
  } else if (act === "set-statisten-ko") {
    gmAction({ type: "set_statisten_ko", value: parseInt(t.value, 10) });
  } else if (act === "toggle-auto-incap") {
    gmAction({ type: "set_auto_incap", on: t.checked });
  } else if (act === "toggle-auto-release") {
    gmAction({ type: "set_auto_release", on: t.checked });
  } else if (act === "toggle-conditions") {
    gmAction({ type: "set_conditions_enabled", on: t.checked });
  } else if (act === "angriff-zugende") {
    App.angriffZugEnde = t.checked;
  } else if (act === "toggle-kampfhilfe") {
    gmAction({ type: "set_kampfhilfe", name: t.dataset.name, on: t.checked });
  } else if (act === "toggle-requests") {
    gmAction({ type: "set_requests_enabled", on: t.checked });
  } else if (act === "toggle-benny-to-gm") {
    gmAction({ type: "set_benny_to_gm", on: t.checked });
  } else if (act === "toggle-notify") {
    try { localStorage.setItem("notifyTurn", t.checked ? "on" : "off"); } catch {}
    if (t.checked) playBeep(880, 120);   // kurzes Feedback, dass Ton geht
  } else if (act === "pick-import") {
    importBackup(t.files[0]);
    t.value = "";
  }
});

// Firewall für die App freigeben (alle Kandidaten-Ports). Löst beim SL eine UAC-Abfrage aus.
async function allowFirewall() {
  App._firewallDone = true;
  App._firewallFail = false;
  render();
  try {
    await fetch("/api/firewall-allow", { method: "POST" });
  } catch { /* egal – UAC läuft ggf. trotzdem */ }
  // Nachsehen, ob die Regel jetzt TATSÄCHLICH existiert. Nur „gestartet" zu
  // melden hilft niemandem – auf Firmen-Laptops scheitert die Elevation still.
  setTimeout(() => {
    fetch("/api/info").then((r) => r.json()).then((info) => {
      App._info = info;
      merkeServerAdressen(info);
      App._firewallDone = false;
      App._firewallFail = info.firewallRuleActive === false;
      render();
    }).catch(() => {});
  }, 5000);
}

// Sicherung wiederherstellen: ersetzt Charaktere + Bibliotheken + Begegnungen.
async function importBackup(file) {
  if (!file) return;
  if (!await frage("Sicherung einspielen? Ersetzt Charakterliste, Gegner-/Verbündeten-Bibliothek und Begegnungen (der laufende Kampf bleibt).", "Einspielen", true)) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/import", { method: "POST", body: fd });
    if (res.status === 400) { hinweis("Das war keine gültige Sicherungsdatei."); return; }
    if (res.status === 403) { hinweis("Import geht nur am Spielleiter-Laptop."); return; }
    if (!res.ok) { hinweis("Import fehlgeschlagen."); return; }

    // Genau berichten, was übernommen wurde – Importieren ERSETZT die Listen,
    // da will man nicht raten, ob die Datei wirklich gepasst hat.
    const b = await res.json();
    if (!b.ok) { hinweis("Nicht eingespielt.\n\n" + (b.fehler || "Unbekannter Grund.")); return; }
    const zeilen = Object.entries(b.uebernommen || {}).map(([was, n]) => `• ${n} ${was}`);
    hinweis("Sicherung eingespielt.\n\n" + (zeilen.join("\n") || "(nichts)") +
      (b.verworfen ? `\n\n${b.verworfen} unbrauchbare Einträge wurden übersprungen.` : ""));
  } catch { hinweis("Import fehlgeschlagen."); }
}

// Hochgeladene Bilder, auf die nichts mehr zeigt, wegräumen. Jedes ersetzte
// Porträt bleibt sonst für immer im data-Ordner liegen.
async function bilderAufraeumen() {
  try {
    const info = await (await fetch("/api/bilder-verwaist")).json();
    if (!info.anzahl) { toast("Keine überflüssigen Bilder gefunden."); return; }
    const kb = Math.round(info.bytes / 1024);
    if (!await frage(`${info.anzahl} Bild(er) werden von nichts mehr verwendet (${kb} KB).\n\nJetzt löschen?`, "Löschen", true)) return;
    const erg = await (await fetch("/api/bilder-aufraeumen", { method: "POST" })).json();
    toast(`${erg.geloescht} Bild(er) gelöscht, ${Math.round(erg.bytes / 1024)} KB frei.`);
  } catch { hinweis("Aufräumen fehlgeschlagen."); }
}

// --- Aktionen ---------------------------------------------------------------

function saveChar() {
  const name = $("charname").value;
  const isWildCard = $("charwc").checked;
  const talents = [...document.querySelectorAll('[data-talent="char"]:checked')].map((c) => c.value);
  const gluck = $("charGluck").checked;
  const grosses_gluck = $("charGrossesGluck").checked;
  const id = $("charid").value || undefined;
  gmAction({ type: "roster_upsert", id, name, isWildCard, talents, gluck, grosses_gluck });
  const h = $("charform"); if (h) h.innerHTML = "";
}

function saveBestiary() {
  const name = $("bestname").value;
  const isWildCard = $("bestwc").checked;
  const talents = [...document.querySelectorAll('[data-talent="best"]:checked')].map((c) => c.value);
  const gluck = $("bestGluck").checked;
  const grosses_gluck = $("bestGrossesGluck").checked;
  const id = $("bestid").value || undefined;
  const image = $("bestimg").value || null;
  gmAction({ type: "bestiary_upsert", id, name, isWildCard, talents, gluck, grosses_gluck, image, ...kampfwerteLesen("best") });
  const h = $("bestiaryform"); if (h) h.innerHTML = "";
}

// Bild für eine Gegner-Vorlage hochladen und ins Formular übernehmen.
async function uploadBestiaryImage(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) {
      const j = await res.json();
      const hid = $("bestimg"); if (hid) hid.value = j.url;
      const av = $("bestavatar"); if (av) av.innerHTML = `<img src="${esc(j.url)}" alt="">`;
    } else if (res.status === 413) hinweis("Bild ist zu groß (max. 8 MB).");
    else hinweis("Upload fehlgeschlagen.");
  } catch { hinweis("Upload fehlgeschlagen."); }
}

function saveAlly() {
  const name = $("allyname").value;
  const isWildCard = $("allywc").checked;
  const talents = [...document.querySelectorAll('[data-talent="ally"]:checked')].map((c) => c.value);
  const gluck = $("allyGluck").checked;
  const grosses_gluck = $("allyGrossesGluck").checked;
  const id = $("allyid").value || undefined;
  const image = $("allyimg").value || null;
  if (!name.trim()) return;
  gmAction({ type: "ally_upsert", id, name, isWildCard, talents, gluck, grosses_gluck, image, ...kampfwerteLesen("ally") });
  const h = $("allyform"); if (h) h.innerHTML = "";
}

// Bild für eine Verbündeten-Vorlage hochladen und ins Formular übernehmen.
async function uploadAllyImage(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) {
      const j = await res.json();
      const hid = $("allyimg"); if (hid) hid.value = j.url;
      const av = $("allyavatar"); if (av) av.innerHTML = `<img src="${esc(j.url)}" alt="">`;
    } else if (res.status === 413) hinweis("Bild ist zu groß (max. 8 MB).");
    else hinweis("Upload fehlgeschlagen.");
  } catch { hinweis("Upload fehlgeschlagen."); }
}

async function uploadImage(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) { const j = await res.json(); App.pendingImageUrl = j.url; render(); }
    else hinweis("Upload nicht erlaubt (nur vom Laptop).");
  } catch { hinweis("Upload fehlgeschlagen."); }
}

// Char-Bild einer Figur hochladen und tischweit setzen (SL: jede; Spieler: eigene).
async function uploadCharImage(file, cid) {
  if (!file || !cid) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) { const j = await res.json(); gmActionOrPlayer({ type: "set_image", id: cid, url: j.url }); }
    else if (res.status === 413) hinweis("Bild ist zu groß (max. 8 MB).");
    else hinweis("Upload fehlgeschlagen.");
  } catch { hinweis("Upload fehlgeschlagen."); }
}

function sendMessage() {
  const target = $("msgtarget").value;
  const text = $("msgtext").value;
  if (!text.trim() && !App.pendingImageUrl) return;
  gmAction({ type: "message", target, text, imageUrl: App.pendingImageUrl });
  $("msgtext").value = "";
  App.pendingImageUrl = null;
}

// characterId: Charakter aus der Liste ("" = nur zuschauen); neu = true: der
// Server legt den Charakter aus dem Namensfeld an.
function doJoin(characterId, neu) {
  const E = App.joinEntwurf;
  const roster = App.state.roster || [];
  const gleich = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  const neuerCharakter = neu ? (E.neuName || "").trim() : "";
  if (neu && !neuerCharakter) {
    // Kein alert(): der verschluckte auf manchen Handys den Beitritt ganz.
    App.joinFehler = "Wie heißt dein Charakter? Oben den Namen eintragen.";
    render();
    const f = $("joinneu"); if (f) f.focus();
    return;
  }
  const char = characterId ? roster.find((r) => r.id === characterId) : null;
  let spieler = (E.spielerName || "").trim();
  // Früher wurde der Charaktername als „Spielername" gemerkt. Steht da noch
  // ein ANDERER Charakter, wäre man „Korgo, gespielt von Tessa".
  if (spieler && roster.some((r) => gleich(r.name, spieler)) && !gleich(spieler, char ? char.name : neuerCharakter)) spieler = "";
  const name = spieler || (char && char.name) || neuerCharakter || "Gast";
  App.joinFehler = null;              // alte Meldung verwerfen
  App.myName = name; App.myCharacterId = char ? char.id : null;
  try {
    localStorage.setItem("playerName", name);
    localStorage.setItem("spielerName", spieler);
    if (char) localStorage.setItem("characterId", char.id); else localStorage.removeItem("characterId");
  } catch { /* privates Fenster */ }
  if (char || neuerCharakter) merkeLetztenCharakter(char ? char.id : null, char ? char.name : neuerCharakter);
  wsSend({ type: "join", name, characterId: App.myCharacterId, neuerCharakter, playerId: App.myPlayerId });
  App.joined = true;
  E.modus = null; E.neuName = "";
}

function doLeave() {
  // Server Bescheid geben, damit der eigene Teilnehmer wirklich entfernt wird
  // (sonst erscheint man beim Neu-Beitreten doppelt).
  if (App.myPlayerId) wsSend({ type: "leave", playerId: App.myPlayerId });
  localStorage.removeItem("playerId");
  localStorage.removeItem("characterId");
  App.myPlayerId = null; App.myCharacterId = null; App.joined = false;
  render();
}

// --- Status ----------------------------------------------------------------

function findCombatant(id) {
  return (App.state && App.state.combatants || []).find((c) => c.id === id);
}
function toggleStatus(id, key) {
  const c = findCombatant(id);
  if (!c) return;
  const st = c.status || {};
  gmActionOrPlayer({ type: "set_status", id, [key]: !st[key] });
}

// --- Skins ------------------------------------------------------------------

const SKINS = ["sand", "skies", "blood", "dark", "glutstein", "nebelmeer", "pergament"];
const SKIN_NAMES = {
  sand: "Sand & Bronze", skies: "Giftnebel", blood: "Blut & Leder",
  dark: "Dark Mode", glutstein: "Glutstein", nebelmeer: "Nebelmeer",
  pergament: "Pergament (hell)",
};
function applySkin(skin) {
  if (!SKINS.includes(skin)) skin = "pergament";
  App.skin = skin;
  document.body.classList.remove(...SKINS.map((s) => "theme-" + s));
  document.body.classList.add("theme-" + skin);
  localStorage.setItem("skin", skin);
  slAnsichtSichern();
  const box = $("skins");
  if (box) box.querySelectorAll(".skin-dot").forEach((d) => d.classList.toggle("active", d.dataset.skin === skin));
}
// Joker-Stile pro Geraet (wie Skin & Aufdeck-Stil). Standard: alle an, der Stil
// wird je Joker zufaellig aus den angehakten gewaehlt.
function jokerAuswahlLaden() {
  try {
    const liste = JSON.parse(localStorage.getItem("jokerStile") || "null");
    if (Array.isArray(liste)) {
      const gut = liste.filter((s) => Cards.JOKER_STILE.includes(s));
      if (gut.length) return gut;
    }
  } catch { /* ignore */ }
  return Cards.JOKER_STILE.slice();
}
function jokerZahlText() {
  const n = jokerAuswahlLaden().length, alle = Cards.JOKER_STILE.length;
  return n === 1 ? "(fest)" : n === alle ? "(Zufall aus allen)" : `(Zufall aus ${n})`;
}
Cards.setJokerAuswahl(jokerAuswahlLaden());

function mountSkins() {
  // Aufgeräumt: Skins + Mimi liegen hinter einem ⚙-Knopf (eingeklappt).
  const bar = document.createElement("div");
  bar.id = "skinbar";
  const gear = document.createElement("button");
  gear.id = "skin-gear";
  gear.type = "button";
  gear.textContent = "⚙";
  gear.title = "Ansicht: Skins & Mimi";
  gear.addEventListener("click", () => bar.classList.toggle("open"));
  const box = document.createElement("div");
  box.id = "skins";
  box.className = "skins skin-menu";
  // „QR-Code zeigen" für JEDES Gerät: wer schon mitspielt, hält sein Handy
  // hin und der Nächste scannt davon - statt dass alle den Laptop abfilmen.
  box.innerHTML = `<button type="button" class="qr-teilen-knopf" data-act="qr-gross">📱 QR-Code für Mitspieler zeigen</button>` +
    SKINS.map((s) => `<button class="skin-dot skin-${s}" data-skin="${s}" title="${SKIN_NAMES[s]}"></button>`).join("") +
    `<div class="reveal-pick">
       <div class="muted small" style="margin-bottom:4px">Karten aufdecken</div>
       <select id="revealsel">${REVEALS.map((r) =>
         `<option value="${r}"${r === revealSetting() ? " selected" : ""}>${REVEAL_NAMES[r]}</option>`).join("")}</select>
     </div>
     <details class="joker-pick">
       <summary>🃏 Joker-Stile <span class="muted small" id="jokerzahl">${jokerZahlText()}</span></summary>
       <div class="joker-checks">${Cards.JOKER_STILE.map((s) =>
         `<label><input type="checkbox" data-joker="${s}"${jokerAuswahlLaden().includes(s) ? " checked" : ""}> ${Cards.JOKER_NAMEN[s]}</label>`).join("")}</div>
     </details>`;
  box.addEventListener("click", (e) => {
    const b = e.target.closest(".skin-dot");
    if (b) applySkin(b.dataset.skin);
  });
  box.addEventListener("change", (e) => {
    if (e.target && e.target.dataset && e.target.dataset.joker) {
      const liste = [...box.querySelectorAll("input[data-joker]:checked")].map((i) => i.dataset.joker);
      // Mindestens einer bleibt an – sonst gaebe es keinen Joker-Stil mehr.
      if (!liste.length) { e.target.checked = true; return; }
      try { localStorage.setItem("jokerStile", JSON.stringify(liste)); } catch { /* ignore */ }
      slAnsichtSichern();
      Cards.setJokerAuswahl(liste);
      const zahl = $("jokerzahl");
      if (zahl) zahl.textContent = jokerZahlText();
      if (App.state) render();
      return;
    }
    if (e.target && e.target.id === "revealsel") {
      try { localStorage.setItem("reveal", e.target.value); } catch { /* ignore */ }
      slAnsichtSichern();
      _revealPick.clear();
      if (App.state) render();
    }
  });
  bar.appendChild(gear);
  bar.appendChild(box);
  document.body.appendChild(bar);
  // Klick außerhalb schließt das Menü.
  document.addEventListener("click", (e) => {
    if (bar.classList.contains("open") && !bar.contains(e.target)) bar.classList.remove("open");
  });
}
function mountMist() {
  const m = document.createElement("div");
  m.className = "mist";
  m.innerHTML = "<span></span><span></span>";
  document.body.appendChild(m);
}

// 3D-Neige-Effekt der Spieler-Großkarte: reagiert auf Finger/Maus (funktioniert
// auch über http). Zusätzlich Gyroskop, falls verfügbar (nur https/iOS-Erlaubnis).
mountSkins();
mountMist();
applySkin(localStorage.getItem("skin") || "pergament");

// --- Info (URL für Beitritt) ------------------------------------------------

fetch("/api/info").then((r) => r.json()).then((info) => {
  App._info = info;
  merkeServerAdressen(info);
  if (App.state) render();
}).catch(() => {});

// Die Adressliste alle 2 Minuten auffrischen: wechselt der Laptop das WLAN,
// kennen die Handys sonst nur die alte Adresse und finden ihn nie wieder.
setInterval(() => {
  fetch("/api/info", { cache: "no-store" }).then((r) => r.json()).then((info) => {
    App._info = info;
    merkeServerAdressen(info);
  }).catch(() => { /* offline - der Reconnect kuemmert sich */ });
}, 120000);

connect();
