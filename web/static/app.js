// Client-Logik für SL- und Spieler-Ansicht.
// Rolle kommt vom Server (Laptop/Loopback = SL, sonst Spieler).

const App = {
  ws: null,
  lastRecv: 0,       // Zeitpunkt der letzten Server-Nachricht (für den Heartbeat)
  wentOfflineAt: 0,  // wann die Verbindung abriss (für die Ausfall-Meldung)
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
};

const ASSET_VERSION = "81";   // muss mit ?v=NN in index.html und APP_VERSION (Server) übereinstimmen

const $ = (id) => document.getElementById(id);

// Version anzeigen; weicht die geladene App von der Server-Version ab, hängt der
// Browser-Cache -> deutlicher Hinweis (genau die Falle vom „Wunden-Bug").
function versionLine() {
  const server = App._info && App._info.version;
  const stale = server && server !== ASSET_VERSION;
  return `<div class="muted small" style="margin-top:8px">App-Version ${esc(ASSET_VERSION)}${server ? ` · Server ${esc(server)}` : ""}</div>` +
    (stale ? `<div class="pill bad" style="margin-top:4px">⚠ Alte Seite im Cache (v${esc(ASSET_VERSION)} statt v${esc(server)}). Einmal Strg+F5 drücken.</div>` : "");
}
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Einklappbares Panel (merkt sich den Zustand pro id in localStorage, Default offen).
function section(id, title, body, defaultOpen) {
  if (defaultOpen === undefined) defaultOpen = true;
  const saved = App.collapsed[id];
  const open = saved === undefined ? defaultOpen : saved !== true;
  return `<details class="panel section" data-sec="${id}"${open ? " open" : ""}>` +
    `<summary class="sec-head"><span class="sec-title">${title}</span><span class="sec-caret">▸</span></summary>` +
    `<div class="panel-body">${body}</div></details>`;
}
// Klappzustand merken (toggle bubbelt nicht -> capture).
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches) return;
  if (d.matches("details.section[data-sec]")) {
    App.collapsed[d.dataset.sec] = !d.open;   // true = eingeklappt
    try { localStorage.setItem("collapsed", JSON.stringify(App.collapsed)); } catch { /* ignore */ }
  } else if (d.matches("details.row-status[data-rowstatus]")) {
    // Aufgeklappte Zustands-Leisten merken, damit ein Broadcast-Render sie nicht zuklappt.
    if (d.open) App.rowStatusOpen.add(d.dataset.rowstatus);
    else App.rowStatusOpen.delete(d.dataset.rowstatus);
  }
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
  const dur = style === "mist" ? 1400 : style === "shatter" ? 1500 : 1000;
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
  App._prevMyTurn = myTurn;
  App._turnInit = true;
}

// --- Verbindung -------------------------------------------------------------

// App-Heartbeat: erkennt eine tote Leitung (WLAN-Aussetzer) in Sekunden, statt
// zu warten bis TCP von selbst zusammenbricht. Alle 5 s ein Ping; kommt >15 s
// nichts mehr vom Server (auch kein Pong), Verbindung hart schließen -> Reconnect.
let heartbeatTimer = null;
function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    const ws = App.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - (App.lastRecv || 0) > 15000) {
      try { ws.close(); } catch { /* onclose übernimmt den Reconnect */ }
      return;
    }
    try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* nächster Tick */ }
  }, 5000);
}

function connect() {
  // Keine Doppel-Sockets: läuft schon einer (verbindend/offen), nichts tun.
  if (App.ws && (App.ws.readyState === WebSocket.CONNECTING || App.ws.readyState === WebSocket.OPEN)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  App.ws = ws;

  ws.onopen = () => {
    App.lastRecv = Date.now();
    setStatus("online");
    startHeartbeat();
    // War die Leitung vorher weg? Dauer an den Server melden (fürs Diagnose-Log).
    if (App.wentOfflineAt) {
      const gapMs = Date.now() - App.wentOfflineAt;
      App.wentOfflineAt = 0;
      try { ws.send(JSON.stringify({ type: "clientlog", event: "wieder verbunden", gapMs })); } catch { /* egal */ }
    }
  };
  ws.onclose = () => {
    stopHeartbeat();
    if (!App.wentOfflineAt) App.wentOfflineAt = Date.now();
    setStatus("offline");
    setTimeout(connect, 1500);
  };
  ws.onerror = () => setStatus("reconnect");
  ws.onmessage = (ev) => {
    App.lastRecv = Date.now();   // jede Nachricht (auch Pong) hält die Leitung „frisch"
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "pong") return;   // reiner Heartbeat, nichts zu tun
    if (msg.type === "hello") {
      App.role = msg.role;
      document.body.classList.toggle("player", App.role === "player");
      maybeAutoRejoin();
    } else if (msg.type === "state") {
      if (msg.state.serverNow) App.clockOffset = msg.state.serverNow - Date.now();
      App.state = msg.state;
      checkRequestAlert();   // SL: neue Anfrage -> Signal
      checkTurnNotify();     // Spieler: dran -> Vibration/Ton
      // Während einer laufenden Karten-Aufdeckung NICHT sofort neu rendern – sonst
      // baut render() die Karte neu und sie schnappt aufgedeckt (das „Hakeln").
      // Neuesten Zustand nur merken und direkt nach der Animation einmal anwenden.
      if (App.revealLockUntil && Date.now() < App.revealLockUntil) { App.pendingRender = true; return; }
      render();
    } else if (msg.type === "joined") {
      App.myPlayerId = msg.playerId;
      App.joined = true;
      localStorage.setItem("playerId", msg.playerId);
      render();
    }
  };
}

// Handys pausieren beim Sperren die Reconnect-Schleife. Beim Wieder-Aufwecken
// (Tab sichtbar / Fokus / Netz zurück) SOFORT neu verbinden statt zu warten.
function ensureConnected() {
  if (!App.ws || App.ws.readyState === WebSocket.CLOSING || App.ws.readyState === WebSocket.CLOSED) connect();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) ensureConnected(); });
window.addEventListener("focus", ensureConnected);
window.addEventListener("online", ensureConnected);

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

function gmAction(action) {
  if (App.ws && App.ws.readyState === 1) App.ws.send(JSON.stringify({ type: "gm_action", action }));
}
function wsSend(obj) {
  if (App.ws && App.ws.readyState === 1) App.ws.send(JSON.stringify(obj));
}

function maybeAutoRejoin() {
  if (App.role === "player" && App.myPlayerId && App.myName) {
    wsSend({ type: "join", name: App.myName, characterId: App.myCharacterId, playerId: App.myPlayerId });
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

function statusBadges(c) {
  const st = c.status;
  if (!st) return "";
  if (st.out) return `<span class="pill bad">Ausgeschaltet</span>`;
  const b = [];
  if (st.shaken) b.push(`<span class="pill warn">Angeschlagen</span>`);
  // Wunden mit Abzug – für jede Figur, die welche hat (SL kann auch Statisten
  // zähe machen). Deutlich sichtbar für SL und Spieler.
  if (st.wounds > 0) {
    b.push(`<span class="pill bad">🩸 ${st.wounds} Wunde${st.wounds > 1 ? "n" : ""} · −${st.wounds}</span>`);
  }
  const conds = (App.state && App.state.conditions) || {};
  Object.keys(conds).forEach((k) => { if (st[k]) b.push(`<span class="pill">${esc(conds[k])}</span>`); });
  return b.join(" ");
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

  const CHARGE = 600, FLIP = 1700, STEP = 950;
  const extra = seq ? (seq.length - 1) * STEP : 0;
  const DONE = CHARGE + FLIP + extra + 500;
  App.revealLockUntil = Date.now() + DONE;
  clearTimeout(App._revealFlush);
  App._revealFlush = setTimeout(() => {
    App.revealLockUntil = 0; App.pendingRender = false;
    render();
  }, DONE);

  // Wird die gerade gezeigte Karte noch ersetzt (Talent zieht nach)? Dann
  // pulsiert sie ruhig weiter – bei „Schnell" ist das genau die 2-5, die
  // abgeworfen wird. Kein Bewegen, nur Licht (Karte bleibt auf ihrer Höhe).
  const markWait = (idx) => {
    if (!node.isConnected || !seq) return;
    const more = idx < seq.length - 1;
    const c = seq[idx];
    const low = !!c && c.rank !== "JOKER" && Number(c.rank) >= 2 && Number(c.rank) <= 5;
    node.classList.toggle("redraw-wait", more);
    node.classList.toggle("redraw-low", more && low);
  };

  if (seq && front) {
    front.innerHTML = Cards.renderCardSVG(seq[0], img);   // erste gezogene zeigen
    markWait(0);
  }

  setTimeout(() => {
    if (!node.isConnected) return;
    node.classList.remove("await-big");
    // „flipping" zusätzlich hart setzen (Sicherheitsnetz, falls transitionstart
    // nicht feuert) – währenddessen sind die Filter aus und die Drehung bleibt flüssig.
    node.classList.add("revealed", "reveal-big", "flipping");
    playReveal(node);
    setTimeout(() => node.classList.remove("reveal-big", "flipping"), FLIP + 400);
    if (seq && seq.length > 1) {
      let i = 1;
      const nextCard = () => {
        if (!node.isConnected || i >= seq.length) return;
        if (front) front.innerHTML = Cards.renderCardSVG(seq[i], img);
        markWait(i);
        node.classList.remove("reveal-pop"); void node.offsetWidth;
        node.classList.add("reveal-pop");                 // „neu gezogen"-Pop
        setTimeout(() => node.classList.remove("reveal-pop"), 650);
        i += 1;
        if (i < seq.length) setTimeout(nextCard, STEP);
      };
      setTimeout(nextCard, FLIP + 200);
    }
  }, CHARGE);
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
  nodes.slice().reverse().forEach((node, i) => {
    setTimeout(() => {
      if (!node.isConnected) return;
      node.classList.remove("awaiting");
      node.classList.add("revealed", "reveal-pop");
      playReveal(node);
      setTimeout(() => node.classList.remove("reveal-pop"), 650);
    }, flyIn + i * 200);
  });
  const lockMs = flyIn + (nodes.length - 1) * 200 + 700;

  // Anti-Hakeln: die Aufdeckung gegen zwischenzeitliche Broadcasts abschirmen.
  // Der neueste Zustand wird gemerkt (App.pendingRender) und erst danach gerendert.
  if (lockMs > 0) {
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
  return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
}
function zoneLabel(z) {
  const zs = App.state && App.state.zones;
  return (zs && zs[z]) ? `${zs[z].emoji} ${zs[z].label}` : String(z);
}
function zoneOptions(sel) {
  const zs = (App.state && App.state.zones) || (window.Zones && Zones.LABELS) || [];
  return zs.map((z, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${z.emoji} ${esc(z.label)}</option>`).join("");
}
// Zielscheibe. Bewegung läuft AUSSCHLIESSLICH über das Antippen einer erreichbaren
// Bahn + Bestätigung (zweiter Tipp) – keine Sofort-Knöpfe mehr (Missclick-Schutz).
function renderZonesPanel() {
  const s = App.state;
  if (!s.combatants.length) return "";
  const mine = myCombatant();
  const mover = mine ? { id: mine.id, zone: Zones.zoneOf(mine), canMove: !mine.moved } : null;
  const target = Zones.renderTarget(s.combatants, { zones: s.zones, activeId: s.activeId, interactive: true, mover, pending: App.pendingMove });
  const controls = mine
    ? `<div class="zone-hint">${mine.moved
        ? "Diesen Zug schon bewegt – warte auf die nächste Runde."
        : (App.pendingMove
            ? "Zum Bestätigen die markierte Bahn nochmal tippen (oder daneben zum Abbrechen)."
            : "Erreichbare Bahn tippen (1 = gratis · 2 = 🏃 Rennen) – dann nochmal tippen zum Bestätigen.")}</div>`
    : `<div class="zone-hint">Tippe ein Token für Infos.</div>`;
  return section("zones", "Kampfzonen", `${target}${controls}`);
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
  const recoverBenny = (st.shaken && !st.out && c.isWildCard && (c.bennies || 0) > 0)
    ? `<button class="st-btn" data-act="recover" data-id="${c.id}" data-benny="1" title="Wild Card gibt einen Benny aus und ist sofort erholt">🪙➜✓ Benny</button>` : "";
  const recoverFree = (st.shaken && !st.out)
    ? `<button class="st-btn on-shaken" data-act="recover" data-id="${c.id}" data-benny="0" title="Willenskraft-Probe bestanden">✓ Erholt</button>` : "";
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

function showMimiToast(text) {
  const t = el(`<div class="mimi-toast">🐈 ${esc(text || "Miau!")}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function triggerJokerMoment() {
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

function activeHints(combatant) {
  const out = [];
  // Angeschlagen-Erholung: nur für die Figur, die gerade dran ist (SW: Willenskraft-Probe).
  const st = combatant.status || {};
  const isActive = App.state && App.state.activeId === combatant.id;
  if (isActive && st.shaken && !st.out) out.push("Angeschlagen: Willenskraft-Probe zum Erholen");
  // Hinweis-Talente, die bei passender Karte eingeblendet werden.
  const card = combatant.card;
  if (!card) return out;
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

  // Joker-Moment auslösen, wenn ein neuer Joker gezogen wurde.
  if (App.prevJokerFlash === null) App.prevJokerFlash = App.state.jokerFlash;
  else if (App.state.jokerFlash > App.prevJokerFlash) {
    App.prevJokerFlash = App.state.jokerFlash;
    triggerJokerMoment();
  }

  // Mimis Miau als kurzer, selbst-verschwindender Toast (nur Spieler).
  if (App.role === "player") {
    const mimi = (App.state.messages || []).filter((m) => m.sender === "mimi" && (m.target === "all" || m.target === App.myPlayerId));
    const latest = mimi[mimi.length - 1];
    if (App._lastMimiTs === undefined) App._lastMimiTs = latest ? latest.ts : 0;
    else if (latest && latest.ts > App._lastMimiTs) { App._lastMimiTs = latest.ts; showMimiToast(latest.text); }
  }

  const prevRects = captureRects();
  const prevTokens = captureTokens();
  root.innerHTML = (App.role === "gm" ? renderGM() : renderPlayer()) + renderTokenPopupOverlay();
  runReveals();
  playFlip(prevRects);
  playTokens(prevTokens);

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
  const resume = s.hasSavedSession && s.combatants.length === 0 && s.round === 0
    ? `<div class="panel"><div class="row spread">
         <div><strong>Gespeicherte Sitzung gefunden.</strong> <span class="muted">Letzten Kampf fortsetzen?</span></div>
         <div class="row tight">
           <button class="primary" data-act="resume">Fortsetzen</button>
           <button class="ghost" data-act="discard-session">Verwerfen</button>
         </div></div></div>`
    : "";

  return `
    <h1>Spielleiter · Sundered Skies Initiative</h1>
    ${resume}
    <div class="grid2">
      <div>
        ${renderRequestsPanel()}
        ${renderZonesPanel()}
        ${renderOrderPanel(true)}
        ${renderConnectPanel()}
        ${renderBennyPanel()}
      </div>
      <div>
        ${renderRosterPanel()}
        ${renderBestiaryPanel()}
        ${renderAllyPanel()}
        ${renderEncounterPanel()}
        ${renderMessagePanel()}
      </div>
    </div>`;
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
  if (loopback) {
    html += `<div class="pill bad" style="margin-top:8px">⚠ Keine WLAN-Adresse gefunden – ist der Laptop im WLAN? 127.0.0.1 erreicht keine Handys.</div>`;
  }
  html += `<div class="muted small" style="margin-top:8px">Klappt gar nichts? Prüfen: alle im <b>selben WLAN</b> (nicht Gast, nicht 2,4/5 GHz getrennt) · Windows-Firewall darf den Zugriff (Privat) · Router-Client-Trennung aus.</div>`;
  return html;
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
function firewallHtml() {
  const info = App._info;
  if (!info || !info.isWindows) return "";
  if (App._firewallDone) {
    return `<div class="pill good" style="margin-top:10px">🔒 Freigabe gestartet – bitte die Windows-Abfrage (UAC) bestätigen.</div>`;
  }
  const pub = info.networkPublic === true;
  const warn = pub
    ? `<div class="pill bad" style="margin-top:10px">⚠ Dein WLAN ist „Öffentlich" – Windows blockt evtl. eingehende Verbindungen der Handys.</div>`
    : "";
  return `${warn}
    <div class="row" style="margin-top:8px; align-items:center; gap:8px">
      <button class="${pub ? "primary" : "ghost"}" data-act="firewall-allow">🔒 Firewall für die App freigeben</button>
      <span class="muted small">Einmalig; gibt Port 8000 + Ausweich-Ports frei (Windows fragt per UAC).</span>
    </div>`;
}

function renderConnectPanel() {
  return section("connect", "Beitritt für Spieler", `
    <div class="qrbox">
      <img src="/qr.png" alt="QR-Code" onerror="this.style.display='none'">
      <div>
        <div class="muted small">Handy-Kamera auf den QR-Code halten, oder im Browser öffnen:</div>
        <div class="small" style="margin-top:6px">${joinUrlHtml()}</div>
        <div class="muted small" style="margin-top:6px">Der Laptop hier ist automatisch Spielleiter.</div>
      </div>
    </div>
    ${connectedPlayersHtml()}
    ${firewallHtml()}
    ${versionLine()}
    <div class="row" style="margin-top:10px">
      <a href="/tv" target="_blank" rel="noopener"><button>📺 TV-/Beamer-Modus öffnen</button></a>
      <span class="muted small">Read-only Ansicht für einen zweiten Bildschirm.</span>
    </div>
    <div class="row" style="margin-top:12px; align-items:center; flex-wrap:wrap; gap:8px">
      <a href="/api/export" download="sundered-skies-backup.json"><button class="ghost">💾 Sicherung exportieren</button></a>
      <label class="ghost" style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; border:1px solid var(--line); border-radius:10px; padding:10px 14px">
        ⤵ Sicherung importieren
        <input type="file" accept="application/json,.json" data-act="pick-import" style="display:none">
      </label>
      <span class="muted small">Charaktere + Bibliotheken + Begegnungen.</span>
    </div>`);
}

// Kampf-Steuerung (Body, ohne eigenes Panel) – wird oben in die Kampf&Initiative-Box gesetzt.
function renderControlBody() {
  const s = App.state;
  const phasePill = {
    idle: `<span class="pill">Bereit</span>`,
    running: `<span class="pill warn">Zug läuft</span>`,
    gate: `<span class="pill good">Freigabe ausstehend</span>`,
  }[s.phase] || "";
  // Aufräum-Knopf nur zeigen, wenn es ausgeschaltete Gegner gibt (kein Dauer-Clutter).
  const defeated = s.combatants.filter((c) => c.kind === "npc" && !c.ally && (c.status || {}).out);
  const cleanupRow = defeated.length
    ? `<div class="row" style="margin-bottom:8px"><button class="ghost bad" data-act="clear-defeated" data-n="${defeated.length}">🧹 ${defeated.length} ausgeschaltete${defeated.length === 1 ? "n Gegner" : " Gegner"} entfernen</button></div>`
    : "";
  return `
    <div class="row spread" style="margin-bottom:8px">
      <div class="row tight">${phasePill}</div>
      <button class="ghost" data-act="undo" ${s.canUndo ? "" : "disabled"} title="Letzte Aktion rückgängig">↶ Rückgängig</button>
    </div>
    ${cleanupRow}
    <div class="row">
      <button class="primary big" data-act="new-round" style="flex:1">🃏 ${s.round === 0 ? "Karten an ALLE austeilen" : "Neue Runde – an ALLE austeilen"}</button>
      <button class="ghost bad" data-act="reset" title="Alles zurücksetzen">Zurücksetzen</button>
    </div>
    <div class="muted small">Teilt allen Teilnehmern (Spieler & Gegner) gleichzeitig eine neue Karte aus. Einzeln nachziehen geht mit 🔄 in der Liste.</div>
    <label class="row tight" style="align-items:center; margin-top:10px; cursor:pointer">
      <input type="checkbox" data-act="toggle-auto-incap" ${s.autoIncap ? "checked" : ""} style="width:auto">
      <span class="small">Bei der 4. Wunde automatisch „Ausgeschaltet"</span>
    </label>
    <label class="row tight" style="align-items:center; margin-top:6px; cursor:pointer">
      <input type="checkbox" data-act="toggle-conditions" ${s.conditionsEnabled !== false ? "checked" : ""} style="width:auto">
      <span class="small">Zustände verwenden (Verwundbar, Abgelenkt, Am Boden, Betäubt)</span>
    </label>
    <label class="row tight" style="align-items:center; margin-top:6px; cursor:pointer">
      <input type="checkbox" data-act="toggle-requests" ${s.requestsEnabled !== false ? "checked" : ""} style="width:auto">
      <span class="small">Spieler dürfen anfragen (Benny, Angeschlagen, Wunden …)</span>
    </label>
    <div class="row" style="margin-top:12px; align-items:flex-end">
      <label class="field" style="width:150px">
        <span>Zeit pro Zug (Sek.)</span>
        <input type="number" id="timerinput" min="1" max="600" value="${s.timerSeconds}" data-act="set-timer">
      </label>
      ${renderTurnControls()}
    </div>`;
}

function renderTurnControls() {
  const s = App.state;
  const active = s.combatants.find((c) => c.id === s.activeId);
  const anyCards = s.combatants.some((c) => c.card);

  // Runde zu Ende (alle dran gewesen): klarer Hinweis statt toter Taste.
  if (!active && anyCards && s.round > 0) {
    return `<div class="grow">
      <div class="pill good" style="margin-bottom:8px">✓ Runde ${s.round} beendet – alle waren dran</div>
      <button class="primary big" data-act="new-round">🃏 Nächste Runde austeilen</button>
    </div>`;
  }
  // Noch nichts ausgeteilt.
  if (!anyCards) {
    return `<div class="grow muted small">Oben „Karten an ALLE austeilen", dann hier freigeben.</div>`;
  }

  const timer = s.phase === "running" ? timerRing() : "";
  // NSC-Seite (Gegner + Verbündete) braucht keinen Countdown -> „Weiter" ist Standard.
  const isNpcSide = !!(active && active.kind === "npc");
  let controls;
  if (s.phase === "running") {
    controls = `<button class="good big" data-act="confirm-turn">Zug bestätigen ✓</button>`;
  } else {
    const dis = active ? "" : "disabled";
    const releaseBtn = `<button class="${isNpcSide ? "ghost" : "primary big"}" data-act="release" ${dis}>Freigeben ▶</button>`;
    const weiterBtn = `<button class="${isNpcSide ? "primary big" : "ghost"}" data-act="skip-turn" ${dis} title="Ohne Timer sofort zum nächsten">Weiter ⏭</button>`;
    controls = isNpcSide ? weiterBtn + releaseBtn : releaseBtn + weiterBtn;
  }
  return `<div class="grow">
    <div class="muted small">Aktueller Akteur${isNpcSide ? " (NSC)" : ""}</div>
    <div style="font-size:1.3rem; font-weight:800; color:var(--gold)">${esc(active ? active.name : "—")}</div>
    ${timer}
    <div class="row tight" style="margin-top:8px; gap:8px">${controls}</div>
  </div>`;
}

function renderRequestsPanel() {
  const s = App.state;
  if (!s.requests || !s.requests.length) return "";
  const rows = s.requests.map((r) => {
    const attack = r.kind === "attack";
    const actions = attack
      // Angriff ist reine Meldung: würfeln am Tisch, Ergebnis über das Ziel-Token setzen.
      ? `<button class="st-btn on" data-act="req-dismiss" data-id="${r.id}" title="Erledigt">Erledigt ✓</button>`
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

function renderBennyPanel() {
  const s = App.state;
  return section("bennies", "Bennies", `
    <div class="row" style="margin-bottom:8px">
      <button data-act="benny-refresh" title="Alle Wildcards auf Startwert setzen">↻ Auffrischen</button>
    </div>
    <div class="row" style="align-items:flex-end">
      <label class="field" style="width:170px">
        <span>Startwert je Wildcard</span>
        <input type="number" id="bennystart" min="0" max="20" value="${s.bennyStart}" data-act="set-benny-start">
      </label>
      <div class="grow">
        <div class="muted small">SL-Pool</div>
        <div class="status-ctrl">
          <button class="st-btn" data-act="sl-benny-minus">–</button>
          <span style="min-width:44px;text-align:center;font-weight:700">🪙 ${s.slBennies}</span>
          <button class="st-btn" data-act="sl-benny-plus">+</button>
        </div>
      </div>
    </div>
    <label class="row tight" style="align-items:center; margin-top:8px; cursor:pointer">
      <input type="checkbox" data-act="toggle-benny-to-gm" ${s.bennyToGm ? "checked" : ""} style="width:auto">
      <span class="small">Ausgegebene Spieler-Bennies wandern in den SL-Pool (Hausregel)</span>
    </label>
    <div class="muted small" style="margin-top:6px">Auffrischen setzt jede Wildcard auf Startwert + Glück-Bonus. Ohne Klick bleiben alle Bennies erhalten.</div>`);
}

function renderOrderPanel(isGM) {
  const s = App.state;
  if (s.combatants.length === 0) {
    // SL: Kampf-Steuerung trotzdem zeigen (Austeilen etc.), Initiative noch leer.
    if (isGM) {
      return section("combat", `Kampf & Initiative · Runde ${s.round}`,
        `${renderControlBody()}<hr class="combat-sep"><div class="muted">Noch keine Teilnehmer. Spieler treten per QR-Code bei, Gegner/Verbündete rechts hinzufügen.</div>`);
    }
    return section("order", "Reihenfolge", `<div class="muted">Noch keine Teilnehmer. Spieler treten per QR-Code bei.</div>`);
  }
  const active = s.combatants.filter((c) => !c.benched);
  const benched = s.combatants.filter((c) => c.benched);
  // Pausierte („Nicht im Kampf") unten, ausgegraut, ohne Position.
  const benchRows = benched.length
    ? `<div class="order-divider">⏸ Nicht im Kampf</div>` + benched.map((c) => combatantRow(c, null, isGM, isGM)).join("")
    : "";
  // SL sieht Kampf-Steuerung + volle Reihenfolge in EINER Box.
  if (isGM) {
    const rows = active.map((c, i) => combatantRow(c, i + 1, true, true)).join("");
    return section("combat", `Kampf & Initiative · Runde ${s.round}`,
      `${renderControlBody()}<hr class="combat-sep"><div class="order-heading">Initiative-Reihenfolge</div><div class="order">${rows}${benchRows}</div>`);
  }
  // Spieler: Position nur für tischweit AUFGEDECKTE Karten. Verdeckte kommen ohne
  // Nummer in neutraler Reihenfolge nach unten -> verraten die Reihenfolge nicht.
  const openC = active.filter((c) => c.revealed);
  const hiddenC = active.filter((c) => !c.revealed)
    .slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let body = openC.map((c, i) => combatantRow(c, i + 1, false, true)).join("");
  if (hiddenC.length) {
    body += `<div class="order-divider">${openC.length ? "Noch verdeckt" : "Noch niemand aufgedeckt – tippt eure Karte an!"}</div>`;
    body += hiddenC.map((c) => combatantRow(c, null, false, false)).join("");
  }
  return section("order", "Initiative-Reihenfolge", `<div class="order">${body}${benchRows}</div>`);
}

// num: Positionsnummer (oder null = verdeckt, keine Position). isOpen: Karte offen?
function combatantRow(c, num, isGM, isOpen) {
  const s = App.state;
  const isActive = c.id === s.activeId;
  const showCard = isGM || isOpen;                 // Karte offen sichtbar?
  // Karten-abgeleitete Infos (Joker/hält/Hinweise) NUR zeigen, wenn aufgedeckt.
  const hasJoker = showCard && c.card && c.card.suit === "joker";
  const cls = ["combatant",
    c.kind === "npc" ? (c.ally ? "ally" : "enemy") : "", isActive ? "active" : "",
    c.done ? "done" : "", (showCard && c.held) ? "held" : "", hasJoker ? "joker-holder" : "",
    c.benched ? "benched" : "", showCard ? "" : "facedown"].filter(Boolean).join(" ");
  const hints = showCard ? activeHints(c).map((h) => `<span class="tag" style="color:var(--gold);border-color:var(--gold)">${esc(h)}</span>`).join("") : "";
  const jokerBadge = hasJoker ? `<span class="tag joker-badge">★ JOKER</span>` : "";
  const heldPill = (showCard && c.held) ? `<span class="pill warn">hält</span>` : "";
  // Nur das, was mitten im Kampf zählt – Treffer/Heilung mit EINEM Klick.
  const st0 = c.status || {};
  const gmActions = isGM ? `<div class="actions">
      <button class="small primary" data-act="apply-hit" data-id="${c.id}" ${st0.out ? "disabled" : ""} title="Treffer: nicht angeschlagen → Angeschlagen; sonst +1 Wunde">💥</button>
      <button class="small good" data-act="apply-heal" data-id="${c.id}" title="Heilung: wieder wach / −1 Wunde / Angeschlagen weg">🩹</button>
      <button class="ghost small" data-act="set-active" data-id="${c.id}" title="Als aktiv setzen">▶</button>
      <button class="ghost small" data-act="bench" data-id="${c.id}" data-on="${c.benched ? 0 : 1}" title="${c.benched ? "Wieder in den Kampf" : "Aus dem Kampf (pausieren)"}">${c.benched ? "▶️" : "⏸"}</button>
      <button class="ghost small bad" data-act="remove-combatant" data-id="${c.id}" title="${c.playerId ? "Spieler entfernen (Kick)" : "Entfernen"}">✕</button>
    </div>` : "";
  const idxLabel = num != null ? num : `<span class="idx-hidden">?</span>`;
  const avImg = c.image ? `<img src="${esc(c.image)}" alt="">` : esc(zoneInitials(c.name));
  const avatarEl = isGM
    ? `<label class="avatar" title="Bild wählen/ändern" style="cursor:pointer">${avImg}<input type="file" accept="image/*" data-act="pick-char-image" data-id="${c.id}" style="display:none"></label>`
    : (c.image ? `<span class="avatar zoomable" data-act="open-image" data-url="${esc(c.image)}" title="Bild groß anzeigen"><img src="${esc(c.image)}" alt=""></span>` : "");
  return `<div class="${cls}" data-cid="${c.id}">
    <div class="idx">${idxLabel}</div>
    <div class="mini">${cardSlot(c.id, c.card, c.status, "", { open: showCard, tappable: false })}</div>
    ${avatarEl}
    <div class="who">
      <div class="name">${esc(c.name)} ${heldPill}</div>
      ${c.playerName && c.playerName !== c.name ? `<div class="muted" style="font-size:0.72rem">🎲 ${esc(c.playerName)}</div>` : ""}
      ${isGM && c.note ? `<div class="combatant-note" title="SL-Notiz">📝 ${esc(c.note)}</div>` : ""}
      <div class="badges">
        ${c.benched
          ? `<span class="tag" style="color:var(--muted);border-color:var(--muted)">⏸ Nicht im Kampf</span>`
          : `<span class="tag zone-chip z${Zones.zoneOf(c)}">${esc(zoneLabel(Zones.zoneOf(c)))}</span>`}
        ${c.ally ? `<span class="tag" style="color:var(--good);border-color:var(--good)">🤝 Verbündet</span>` : ""}
        ${jokerBadge}
        ${c.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)">Wild Card</span>' : ""}
        ${showCard ? talentBadges(c.talents) : ""} ${hints}
      </div>
      <div class="status-badges">${bennyBadge(c)} ${statusBadges(c)}${
        (isGM && isActive && (c.status || {}).shaken && !(c.status || {}).out)
          ? ` <button class="st-btn on-shaken" data-act="recover" data-id="${c.id}" data-benny="0" title="Angeschlagen aufheben (Willenskraft-Probe bestanden)">✓ erholt</button>` +
            (c.isWildCard && (c.bennies || 0) > 0
              ? ` <button class="st-btn" data-act="recover" data-id="${c.id}" data-benny="1" title="Benny ausgeben & sofort erholt">🪙</button>` : "")
          : ""}</div>
    </div>
    ${gmActions}
    ${isGM ? `<details class="row-status" data-rowstatus="${c.id}" ${App.rowStatusOpen.has(c.id) ? "open" : ""} style="flex-basis:100%">
      <summary>Zustand</summary>
      <div class="panel-body">${statusControls(c)} ${bennyControls(c)}</div>
    </details>` : ""}
    ${isGM && App.editCombatantId === c.id ? `<div style="flex-basis:100%">${combatantEditor(c)}</div>` : ""}
  </div>`;
}

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
    <label class="field" style="margin-top:8px"><span>📝 Notiz (nur SL)</span>
      <input id="edit-note-${c.id}" value="${esc(c.note || "")}" placeholder="z. B. flieht bei 2 Wunden"></label>
    <div class="row" style="margin-top:8px">
      <button class="primary" data-act="save-combatant" data-id="${c.id}">Speichern</button>
      <button class="ghost" data-act="cancel-edit-combatant">Abbrechen</button>
    </div>
  </div>`;
}

function saveCombatant(id) {
  const name = $(`edit-name-${id}`).value;
  const isWildCard = $(`edit-wc-${id}`).checked;
  const gluck = $(`edit-gluck-${id}`).checked;
  const grosses_gluck = $(`edit-ggluck-${id}`).checked;
  const note = ($(`edit-note-${id}`) || {}).value || "";
  gmAction({ type: "edit_combatant", id, name, isWildCard, gluck, grosses_gluck, note });
  App.editCombatantId = null;
}

function renderRosterPanel() {
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

  return section("roster", "Charakterliste", `
    <div class="row" style="margin-bottom:6px; align-items:flex-end; gap:10px">
      <button data-act="new-char">+ Neuer Charakter</button>
      <label class="field" style="max-width:200px; margin:0"><span>Startzone für „+ Kampf"</span>
        <select id="rosterzone" data-act="remember-player-zone">${zoneOptions(lastPlayerZone())}</select></label>
    </div>
    <div class="muted small">Bleibt gespeichert. Spieler wählen ihren Charakter beim Beitritt.</div>
    <div style="margin-top:8px">${items}</div>
    <div id="charform"></div>`);
}

function talentChecklist(selected, prefix) {
  const meta = App.state.talents;
  return Object.keys(meta).map((k) => `
    <label><input type="checkbox" data-talent="${prefix}" value="${k}" ${selected.includes(k) ? "checked" : ""}> ${esc(meta[k].label)}</label>
  `).join("");
}

// Gegner-Bibliothek: Standard-Gegner mit Bild, schnell in den Kampf (wie Roster).
function renderBestiaryPanel() {
  const list = (App.state && App.state.bestiary) || [];
  const items = list.map((r) => `
    <div class="roster-item">
      <span class="avatar${r.image ? " zoomable" : ""}"${r.image ? ` data-act="open-image" data-url="${esc(r.image)}" data-name="${esc(r.name)}" title="Bild groß anzeigen"` : ""}>${r.image ? `<img src="${esc(r.image)}" alt="">` : esc(zoneInitials(r.name))}</span>
      <div class="grow"><strong>${esc(r.name)}</strong>
        <div class="badges">${r.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)">WC</span>' : ""}${talentBadges(r.talents)}</div>
      </div>
      <button class="small primary" data-act="bestiary-to-combat" data-id="${r.id}" title="In den Kampf (in gewählter Startzone)">+ Kampf</button>
      <button class="ghost small" data-act="bestiary-edit" data-id="${r.id}">Bearbeiten</button>
      <button class="ghost small bad" data-act="bestiary-delete" data-id="${r.id}">✕</button>
    </div>`).join("") || `<div class="muted small">Noch keine Gegner-Vorlagen.</div>`;
  return section("bestiary", "Gegner-Bibliothek", `
    <div class="row" style="margin-bottom:6px; align-items:flex-end; gap:10px">
      <button data-act="bestiary-new">+ Neuer Gegner-Typ</button>
      <label class="field" style="max-width:200px; margin:0"><span>Startzone für „+ Kampf"</span>
        <select id="bestzone" data-act="remember-zone">${zoneOptions(lastNpcZone())}</select></label>
    </div>
    <div class="muted small">Standard-Gegner (mit Bild) – bleiben gespeichert, per „+ Kampf" in der gewählten Zone rein.</div>
    <div style="margin-top:8px">${items}</div>
    <div id="bestiaryform"></div>`);
}

// Verbündeten-Bibliothek – wie das Bestiarium, aber Figuren landen auf Spielerseite.
function renderAllyPanel() {
  const list = (App.state && App.state.allies) || [];
  const items = list.map((r) => `
    <div class="roster-item">
      <span class="avatar${r.image ? " zoomable" : ""}"${r.image ? ` data-act="open-image" data-url="${esc(r.image)}" data-name="${esc(r.name)}" title="Bild groß anzeigen"` : ""}>${r.image ? `<img src="${esc(r.image)}" alt="">` : esc(zoneInitials(r.name))}</span>
      <div class="grow"><strong>${esc(r.name)}</strong>
        <div class="badges">${r.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)">WC</span>' : ""}${talentBadges(r.talents)}</div>
      </div>
      <button class="small primary" data-act="ally-to-combat" data-id="${r.id}" title="In den Kampf (Spielerseite, gewählte Startzone)">+ Kampf</button>
      <button class="ghost small" data-act="ally-edit" data-id="${r.id}">Bearbeiten</button>
      <button class="ghost small bad" data-act="ally-delete" data-id="${r.id}">✕</button>
    </div>`).join("") || `<div class="muted small">Noch keine Verbündeten-Vorlagen.</div>`;
  return section("allies", "Verbündeten-Bibliothek", `
    <div class="row" style="margin-bottom:6px; align-items:flex-end; gap:10px">
      <button data-act="ally-new">+ Neuer Verbündeter</button>
      <label class="field" style="max-width:200px; margin:0"><span>Startzone für „+ Kampf"</span>
        <select id="allyzone" data-act="remember-ally-zone">${zoneOptions(lastAllyZone())}</select></label>
    </div>
    <div class="muted small">NPCs auf Spielerseite (grün). Bleiben gespeichert, per „+ Kampf" in der gewählten Zone rein.</div>
    <div style="margin-top:8px">${items}</div>
    <div id="allyform"></div>`);
}

// Begegnungen: gespeicherte Gegner-/Verbündeten-Gruppen, auf einen Schlag einsetzbar.
function renderEncounterPanel() {
  const list = (App.state && App.state.encounters) || [];
  const hasNpcs = ((App.state && App.state.combatants) || []).some((c) => c.kind === "npc");
  const items = list.map((e) => {
    const names = (e.members || []).map((m) => m.name).join(", ");
    return `<div class="roster-item">
      <div class="grow"><strong>${esc(e.name)}</strong>
        <div class="muted small">${(e.members || []).length} Figur(en): ${esc(names).slice(0, 90)}</div>
      </div>
      <button class="small primary" data-act="encounter-to-combat" data-id="${e.id}" title="Ganze Begegnung in den Kampf setzen">+ Kampf</button>
      <button class="ghost small bad" data-act="encounter-delete" data-id="${e.id}">✕</button>
    </div>`;
  }).join("") || `<div class="muted small">Noch keine Begegnungen gespeichert.</div>`;
  return section("encounters", "Begegnungen", `
    <div class="muted small">Eine Gegner-/Verbündeten-Gruppe speichern und später mit EINEM Klick komplett einsetzen (in den gespeicherten Zonen).</div>
    <div class="row" style="margin:6px 0">
      <button data-act="encounter-save" ${hasNpcs ? "" : "disabled"} title="${hasNpcs ? "Aktuelle Gegner/Verbündete als Begegnung speichern" : "Erst Gegner/Verbündete in den Kampf setzen"}">💾 Aktuelle Aufstellung speichern</button>
    </div>
    <div style="margin-top:8px">${items}</div>`);
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

function renderMessagePanel() {
  const s = App.state;
  const opts = [`<option value="all">Alle Spieler</option>`, `<option value="beamer">📺 Beamer / TV (Bild groß)</option>`]
    .concat(s.players.map((p) => `<option value="${p.id}">${esc(p.name)}${p.connected ? "" : " (offline)"}</option>`))
    .join("");
  const preview = App.pendingImageUrl
    ? `<div class="msg"><img src="${esc(App.pendingImageUrl)}"><button class="ghost small" data-act="clear-image" style="margin-top:6px">Bild entfernen</button></div>`
    : "";
  const log = s.messages.slice().reverse().map((m) => `
    <div class="msg"><div class="to">an ${m.target === "all" ? "alle" : esc((s.players.find((p) => p.id === m.target) || {}).name || "?")}</div>
      ${m.text ? esc(m.text) : ""}${m.imageUrl ? `<img src="${esc(m.imageUrl)}">` : ""}</div>`).join("");

  return section("message", "Nachricht / Bild senden", `
    <label class="field"><span>Empfänger</span><select id="msgtarget">${opts}</select></label>
    <label class="field"><span>Text</span><input id="msgtext" placeholder="Nachricht…"></label>
    ${preview}
    <div class="row">
      <input type="file" id="msgimage" accept="image/*" data-act="pick-image" class="grow">
      <button class="primary" data-act="send-message">Senden</button>
    </div>
    ${s.tvImage ? `<div class="row" style="margin-top:8px"><span class="pill good">📺 TV zeigt gerade ein Bild</span><button class="ghost small" data-act="clear-tv">TV-Bild entfernen</button></div>` : ""}
    ${log ? `<div style="margin-top:10px"><div class="muted small">Verlauf</div>${log}<button class="ghost small" data-act="clear-messages" style="margin-top:6px">Verlauf leeren</button></div>` : ""}`);
}

// ---------- Spieler-Ansicht ----------

function renderPlayer() {
  const s = App.state;
  const mine = s.combatants.find((c) => c.playerId === App.myPlayerId);

  if (!App.joined || !mine) return renderJoin();

  const isMyTurn = s.activeId === mine.id && s.phase === "running";
  const banner = isMyTurn ? `<div class="myturn-banner">Du bist dran!</div>` : "";
  const timer = s.phase === "running"
    ? timerRing()
    : (s.phase === "gate" ? `<div class="center muted small">Warte auf Freigabe durch den Spielleiter…</div>` : "");

  const hints = activeHints(mine).map((h) => `<div class="pill warn" style="margin:4px 2px">${esc(h)}</div>`).join("");

  // Abwarten darf JEDE Figur (SW-Regel) – sinnvoll ansagen kann man es, wenn
  // man gerade dran ist.
  let holdBtn = "";
  if (!mine.held && isMyTurn) holdBtn = `<button data-act="hold" data-id="${mine.id}">Abwarten ⏸</button>`;
  if (mine.held) holdBtn = `<button class="primary big" data-act="intervene" data-id="${mine.id}">Jetzt eingreifen! ⚡</button>`;

  const confirmBtn = isMyTurn ? `<button class="good big" data-act="confirm-turn">Zug bestätigen ✓</button>` : "";
  // Angeschlagen + man ist dran: ein deutlicher Knopf, um sich (nach bestandener
  // Willenskraft-Probe) zu erholen – meldet es dem SL, statt es im Zustand-Menü zu suchen.
  const mySt = mine.status || {};
  const canRecover = isMyTurn && mySt.shaken && !mySt.out;
  const recoverFreeBtn = canRecover
    ? `<button class="primary big" data-act="player-request" data-kind="status" data-detail='{"shaken":false}' data-label="ist nicht mehr angeschlagen">😵➜✓ Erholt (Willenskraft bestanden)</button>`
    : "";
  const recoverBennyBtn = (canRecover && mine.isWildCard && (mine.bennies || 0) > 0)
    ? `<button class="good big" data-act="player-request" data-kind="recover" data-detail='{"benny":true}' data-label="gibt einen Benny aus und ist erholt">🪙➜✓ Benny ausgeben</button>`
    : "";
  const recoverBtn = recoverFreeBtn + recoverBennyBtn;

  const myMsgs = s.messages.filter((m) => m.target === "all" || m.target === App.myPlayerId);
  const msgs = myMsgs.slice().reverse().slice(0, 8)
    .map((m) => `<div class="msg"><div class="to">${m.sender === "mimi" ? "🐈 Mimi" : "Spielleiter"}</div>${m.text ? esc(m.text) : ""}${m.imageUrl ? `<img src="${esc(m.imageUrl)}" data-act="open-image" data-url="${esc(m.imageUrl)}">` : ""}</div>`).join("");

  // Blockierendes Banner NUR für echte SL-Nachrichten (Mimis Miau ist ein Toast).
  const gmMsgs = myMsgs.filter((m) => m.sender !== "mimi");
  const newest = gmMsgs[gmMsgs.length - 1];
  const msgBanner = newest && newest.ts > App.lastSeenMsgTs
    ? `<div class="msg-overlay">
         <div class="msg-card">
           <div class="muted small">${newest.sender === "mimi" ? "🐈 Nachricht von Mimi" : "✉ Nachricht vom Spielleiter"}</div>
           ${newest.text ? `<div class="msg-text">${esc(newest.text)}</div>` : ""}
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
      ${recoverBtn ? `<div class="row" style="justify-content:center; margin-top:10px">${recoverBtn}</div>` : ""}
      <div class="row" style="justify-content:center; margin-top:10px">${confirmBtn}${holdBtn}</div>
      ${playerQuickControls(mine)}
    </div>`;

  // Reihenfolge: Eigene Karte → Reihenfolge → Kampfzonen → Aktionen → Zustände.
  return `
    ${msgBanner}
    <div class="row spread" style="margin-bottom:6px">
      <div class="row tight" style="align-items:center">
        <label class="avatar big" title="Eigenes Bild wählen/ändern" style="cursor:pointer">
          ${mine.image ? `<img src="${esc(mine.image)}" alt="">` : esc(zoneInitials(mine.name))}
          <input type="file" accept="image/*" data-act="pick-char-image" data-id="${mine.id}" style="display:none">
        </label>
        <div><h1 style="margin:0; font-size:1.25rem">${esc(mine.name)}</h1>${playerTag}</div>
      </div>
      <button class="ghost small" data-act="leave">Verlassen</button>
    </div>
    ${banner}
    ${cardPanel}
    ${renderOrderPanel(false)}
    ${mine.benched ? "" : renderZonesPanel()}
    <label class="row tight" style="align-items:center; justify-content:center; margin-top:10px; cursor:pointer">
      <input type="checkbox" data-act="toggle-notify" ${localStorage.getItem("notifyTurn") !== "off" ? "checked" : ""} style="width:auto">
      <span class="small muted">🔔 Vibration/Ton, wenn ich dran bin</span>
    </label>
    ${msgs ? `<div class="panel"><h2>Nachrichten vom Spielleiter</h2>${msgs}</div>` : ""}
  `;
}

function c_bennyChip(c) {
  return c.isWildCard ? `<span class="pill" style="border-color:var(--gold);color:var(--gold)">🪙 ${c.bennies || 0}</span>` : "";
}

function renderJoin() {
  const s = App.state;
  const chars = s.roster.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
  return `
    <h1 class="center">Sundered Skies · Beitreten</h1>
    <div class="panel">
      ${s.roster.length ? `<label class="field"><span>Charakter wählen</span>
        <select id="joinchar"><option value="">– Gast (ohne Charakter) –</option>${chars}</select></label>` : ""}
      <label class="field"><span>Dein Name (Spieler)${s.roster.length ? " – optional bei Charakterwahl" : ""}</span>
        <input id="joinname" value="${esc(App.myName)}" placeholder="z. B. Stefan"></label>
      <button class="primary big" data-act="join" style="width:100%">Beitreten</button>
    </div>
    <div class="center muted small">Nichts zu installieren – läuft direkt im Browser.</div>
  `;
}

// --- Ereignisse (Delegation) ------------------------------------------------

document.addEventListener("click", (e) => {
  // Klick auf den abgedunkelten Hintergrund des Token-Popups schließt es.
  if (App.tokenPopupId && e.target.classList && e.target.classList.contains("token-popup")) {
    App.tokenPopupId = null; render(); return;
  }
  const target = e.target.closest("[data-act]");
  if (!target) return;
  const act = target.getAttribute("data-act");
  const id = target.getAttribute("data-id");
  const S = App.state;

  const handlers = {
    // SL – Kampf
    "new-round": () => gmAction({ type: "new_round" }),
    "reset": () => { if (confirm("Initiative komplett zurücksetzen?")) gmAction({ type: "reset" }); },
    "release": () => gmAction({ type: "release" }),
    "confirm-turn": () => gmActionOrPlayer({ type: "confirm_turn" }),
    "skip-turn": () => gmAction({ type: "confirm_turn" }),   // ohne Timer zum nächsten
    "redraw": () => gmAction({ type: "redraw", id }),
    "set-active": () => gmAction({ type: "set_active", id }),
    "edit-combatant": () => { App.editCombatantId = App.editCombatantId === id ? null : id; render(); },
    "save-combatant": () => saveCombatant(id),
    "cancel-edit-combatant": () => { App.editCombatantId = null; render(); },
    "bench": () => gmAction({ type: "bench", id, on: target.getAttribute("data-on") === "1" }),
    "remove-combatant": () => {
      const c = findCombatant(id);
      const msg = c && c.playerId ? `Spieler "${c.name}" endgültig entfernen (Kick)?` : "Teilnehmer entfernen?";
      if (confirm(msg)) gmAction({ type: "remove_combatant", id });
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
    "delete-char": () => { if (confirm("Charakter löschen?")) gmAction({ type: "roster_delete", id }); },
    // SL – Gegner-Bibliothek
    "bestiary-new": () => renderBestiaryForm(null),
    "bestiary-edit": () => renderBestiaryForm((S.bestiary || []).find((r) => r.id === id)),
    "bestiary-save": saveBestiary,
    "bestiary-cancel": () => { const h = $("bestiaryform"); if (h) h.innerHTML = ""; },
    "bestiary-delete": () => { if (confirm("Gegner-Typ löschen?")) gmAction({ type: "bestiary_delete", id }); },
    "bestiary-to-combat": () => {
      const z = parseInt(($("bestzone") || {}).value, 10);
      gmAction({ type: "add_npc_from_bestiary", id, zone: isNaN(z) ? undefined : z });
    },
    // SL – Verbündeten-Bibliothek
    "ally-new": () => renderAllyForm(null),
    "ally-edit": () => renderAllyForm((S.allies || []).find((r) => r.id === id)),
    "ally-save": saveAlly,
    "ally-cancel": () => { const h = $("allyform"); if (h) h.innerHTML = ""; },
    "ally-delete": () => { if (confirm("Verbündeten-Typ löschen?")) gmAction({ type: "ally_delete", id }); },
    // SL – Begegnungen (gespeicherte Gruppen)
    "encounter-save": () => {
      const name = prompt("Name der Begegnung? (z. B. Skree-Überfall)");
      if (name && name.trim()) gmAction({ type: "save_encounter", name: name.trim() });
    },
    "encounter-to-combat": () => gmAction({ type: "add_encounter", id }),
    "encounter-delete": () => { if (confirm("Begegnung löschen?")) gmAction({ type: "delete_encounter", id }); },
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
      let detail = {};
      try { detail = JSON.parse(target.getAttribute("data-detail") || "{}"); } catch { /* ignore */ }
      gmActionOrPlayer({ type: "request", kind: target.getAttribute("data-kind"), detail, label: target.getAttribute("data-label") });
      App.reqMode = false;   // nach dem Absenden wieder zuklappen (ruhige Ansicht)
      render();
    },
    "req-apply": () => gmAction({ type: "resolve_request", id, apply: true }),
    "req-dismiss": () => gmAction({ type: "resolve_request", id, apply: false }),
    // Spieler
    "join": doJoin,
    "leave": doLeave,
    "hold": () => gmActionOrPlayer({ type: "hold", id }),
    "intervene": () => gmActionOrPlayer({ type: "intervene", id }),
    "reveal-card": () => revealBigCard(target),
    // Kampfzonen: Bewegen NUR über Bahn-Tipp + Bestätigung (s. zoneGoto).
    "set-zone": () => gmAction({ type: "set_zone", id, zone: parseInt(target.getAttribute("data-zone"), 10) }),
    // token-info + zone-goto werden per pointerdown behandelt (robuster, s. u.)
    "tp-remove": () => {
      const c = findCombatant(id);
      const msg = c && c.playerId ? `Spieler "${c.name}" entfernen (Kick)?` : "Teilnehmer entfernen?";
      if (confirm(msg)) gmAction({ type: "remove_combatant", id });
      App.tokenPopupId = null;
    },
    "attack-request": () => {
      const tgt = findCombatant(id);
      gmActionOrPlayer({ type: "request", kind: "attack", detail: { targetId: id }, label: "greift " + (tgt ? tgt.name : "?") + " an" });
      App.tokenPopupId = null; render();
    },
    "close-token-popup": () => { App.tokenPopupId = null; render(); },
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
    "clear-defeated": () => {
      const n = target.getAttribute("data-n") || "";
      if (confirm(`${n} ausgeschaltete Gegner aus dem Kampf entfernen?`)) gmAction({ type: "clear_defeated" });
    },
    // Firewall in einem Klick freigeben (Windows-SL) -> löst UAC-Abfrage aus
    "firewall-allow": () => allowFirewall(),
    // Rückgängig (SL)
    "undo": () => gmAction({ type: "undo" }),
    // Bennies
    "benny-plus": () => gmActionOrPlayer({ type: "benny_adjust", id, delta: 1 }),
    "benny-minus": () => gmActionOrPlayer({ type: "benny_adjust", id, delta: -1 }),
    "benny-refresh": () => { if (confirm("Alle Wildcards auf Startwert auffrischen?")) gmAction({ type: "benny_refresh" }); },
    "sl-benny-plus": () => gmAction({ type: "sl_benny_adjust", delta: 1 }),
    "sl-benny-minus": () => gmAction({ type: "sl_benny_adjust", delta: -1 }),
  };
  if (handlers[act]) { e.preventDefault(); handlers[act](); }
});

// Kampfzonen-Auswahl per pointerdown statt click: die Aktion schließt sofort ab,
// unabhängig von einem gleich eintreffenden Broadcast-Render (behebt das „nur auf
// dem Icon loslassen"-Problem). Token = Info-Popup; freie Bahn = dorthin bewegen.
document.addEventListener("pointerdown", (e) => {
  const t = e.target.closest('[data-act="token-info"], [data-act="zone-goto"]');
  if (!t) {
    // Tipp daneben bricht eine schwebende Bewegungs-Bestätigung ab.
    if (App.pendingMove) { App.pendingMove = null; render(); }
    return;
  }
  e.preventDefault();
  if (t.getAttribute("data-act") === "token-info") {
    App.tokenPopupId = t.getAttribute("data-id");
    render();
  } else {
    zoneGoto(t.getAttribute("data-id"), Number(t.getAttribute("data-tz")));
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
  } else if (act === "remember-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZone", String(v)); } catch {} }
  } else if (act === "remember-ally-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZoneAlly", String(v)); } catch {} }
  } else if (act === "remember-player-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZonePlayer", String(v)); } catch {} }
  } else if (act === "toggle-auto-incap") {
    gmAction({ type: "set_auto_incap", on: t.checked });
  } else if (act === "toggle-conditions") {
    gmAction({ type: "set_conditions_enabled", on: t.checked });
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
  render();
  try {
    await fetch("/api/firewall-allow", { method: "POST" });
  } catch { /* egal – UAC läuft ggf. trotzdem */ }
  // Nach kurzer Zeit den Netzwerk-Status neu holen (Warnung ggf. entfernen).
  setTimeout(() => {
    fetch("/api/info").then((r) => r.json()).then((info) => { App._info = info; render(); }).catch(() => {});
  }, 4000);
}

// Sicherung wiederherstellen: ersetzt Charaktere + Bibliotheken + Begegnungen.
async function importBackup(file) {
  if (!file) return;
  if (!confirm("Sicherung einspielen? Ersetzt Charakterliste, Gegner-/Verbündeten-Bibliothek und Begegnungen (der laufende Kampf bleibt).")) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/import", { method: "POST", body: fd });
    if (res.ok) alert("Sicherung eingespielt.");
    else if (res.status === 400) alert("Das war keine gültige Sicherungsdatei.");
    else if (res.status === 403) alert("Import geht nur am Spielleiter-Laptop.");
    else alert("Import fehlgeschlagen.");
  } catch { alert("Import fehlgeschlagen."); }
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
  gmAction({ type: "bestiary_upsert", id, name, isWildCard, talents, gluck, grosses_gluck, image });
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
    } else if (res.status === 413) alert("Bild ist zu groß (max. 8 MB).");
    else alert("Upload fehlgeschlagen.");
  } catch { alert("Upload fehlgeschlagen."); }
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
  gmAction({ type: "ally_upsert", id, name, isWildCard, talents, gluck, grosses_gluck, image });
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
    } else if (res.status === 413) alert("Bild ist zu groß (max. 8 MB).");
    else alert("Upload fehlgeschlagen.");
  } catch { alert("Upload fehlgeschlagen."); }
}

async function uploadImage(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) { const j = await res.json(); App.pendingImageUrl = j.url; render(); }
    else alert("Upload nicht erlaubt (nur vom Laptop).");
  } catch { alert("Upload fehlgeschlagen."); }
}

// Char-Bild einer Figur hochladen und tischweit setzen (SL: jede; Spieler: eigene).
async function uploadCharImage(file, cid) {
  if (!file || !cid) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) { const j = await res.json(); gmActionOrPlayer({ type: "set_image", id: cid, url: j.url }); }
    else if (res.status === 413) alert("Bild ist zu groß (max. 8 MB).");
    else alert("Upload fehlgeschlagen.");
  } catch { alert("Upload fehlgeschlagen."); }
}

function sendMessage() {
  const target = $("msgtarget").value;
  const text = $("msgtext").value;
  if (!text.trim() && !App.pendingImageUrl) return;
  gmAction({ type: "message", target, text, imageUrl: App.pendingImageUrl });
  $("msgtext").value = "";
  App.pendingImageUrl = null;
}

function doJoin() {
  const charSel = $("joinchar");
  const characterId = charSel ? (charSel.value || null) : null;
  let name = $("joinname").value.trim();   // Spielername (Person)
  // Charakter gewählt, aber kein Name getippt -> Charaktername als Fallback.
  if (characterId && !name) {
    const c = App.state.roster.find((r) => r.id === characterId);
    name = c ? c.name : name;
  }
  if (!name) { alert("Bitte einen Charakter wählen oder deinen Namen eingeben."); return; }
  App.myName = name; App.myCharacterId = characterId;
  localStorage.setItem("playerName", name);
  if (characterId) localStorage.setItem("characterId", characterId); else localStorage.removeItem("characterId");
  wsSend({ type: "join", name, characterId, playerId: App.myPlayerId });
  App.joined = true;
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
  const box = $("skins");
  if (box) box.querySelectorAll(".skin-dot").forEach((d) => d.classList.toggle("active", d.dataset.skin === skin));
}
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
  box.innerHTML = SKINS.map((s) => `<button class="skin-dot skin-${s}" data-skin="${s}" title="${SKIN_NAMES[s]}"></button>`).join("") +
    `<div class="reveal-pick">
       <div class="muted small" style="margin-bottom:4px">Karten aufdecken</div>
       <select id="revealsel">${REVEALS.map((r) =>
         `<option value="${r}"${r === revealSetting() ? " selected" : ""}>${REVEAL_NAMES[r]}</option>`).join("")}</select>
     </div>`;
  box.addEventListener("click", (e) => {
    const b = e.target.closest(".skin-dot");
    if (b) applySkin(b.dataset.skin);
  });
  box.addEventListener("change", (e) => {
    if (e.target && e.target.id === "revealsel") {
      try { localStorage.setItem("reveal", e.target.value); } catch { /* ignore */ }
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
  if (App.state) render();
}).catch(() => {});

connect();
