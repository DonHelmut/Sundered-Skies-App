// Read-only Beamer-/TV-Ansicht. Lauscht nur auf den Zustand (sendet nichts).

const TV = { ws: null, state: null, jokerGesehen: null, clockOffset: 0 };
const $ = (id) => document.getElementById(id);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Skin vom Gerät übernehmen + Nebel-Ambiente.
(function init() {
  const skin = localStorage.getItem("skin") || "pergament";
  const skins = ["sand", "skies", "blood", "dark", "glutstein", "nebelmeer", "pergament"];
  document.body.classList.add("theme-" + (skins.includes(skin) ? skin : "pergament"));
  // Joker-Stile wie am selben Geraet im Menue angehakt (Beamer am SL-Laptop).
  try { Cards.setJokerAuswahl(JSON.parse(localStorage.getItem("jokerStile") || "null")); } catch { /* ignore */ }
  const m = document.createElement("div");
  m.className = "mist";
  m.innerHTML = "<span></span><span></span>";
  document.body.appendChild(m);
})();

function captureRects() {
  const m = {};
  document.querySelectorAll(".tv-tile[data-cid]").forEach((e) => { m[e.dataset.cid] = e.getBoundingClientRect(); });
  return m;
}
function playFlip(prev) {
  document.querySelectorAll(".tv-tile[data-cid]").forEach((e) => {
    const o = prev[e.dataset.cid]; if (!o) return;
    const n = e.getBoundingClientRect();
    const dx = o.left - n.left, dy = o.top - n.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    e.style.transition = "none";
    e.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      e.style.transition = "transform 0.45s cubic-bezier(.2,.7,.2,1)";
      e.style.transform = "";
    });
  });
}
function captureTokens() {
  const m = {};
  document.querySelectorAll(".zone-token[data-id]").forEach((e) => { m[e.dataset.id] = e.getBoundingClientRect(); });
  return m;
}
function playTokens(prev) {
  document.querySelectorAll(".zone-token[data-id]").forEach((e) => {
    const o = prev[e.dataset.id]; if (!o) return;
    const n = e.getBoundingClientRect();
    const dx = o.left - n.left, dy = o.top - n.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    e.style.transition = "none";
    e.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      e.style.transition = "transform 0.45s cubic-bezier(.2,.7,.2,1)";
      e.style.transform = "";
    });
  });
}
function triggerJokerMoment() {
  const m = el(`<div class="joker-moment"><div class="jm-flash"></div><div class="jm-star">★</div><div class="jm-text">JOKER!</div></div>`);
  document.body.appendChild(m);
  setTimeout(() => m.remove(), 1900);
}

let tvHeartbeat = null;
function connect() {
  if (TV.ws && (TV.ws.readyState === WebSocket.CONNECTING || TV.ws.readyState === WebSocket.OPEN)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // ?tv=1: Der Beamer laeuft meist auf dem SL-Laptop und waere sonst "der SL" -
  // dann stuenden verdeckte Gegner mit Klarnamen fuer den ganzen Tisch da.
  const ws = new WebSocket(`${proto}://${location.host}/ws?tv=1`);
  TV.ws = ws;
  ws.onopen = () => { TV.lastRecv = Date.now(); setStatus("online");
    clearInterval(tvHeartbeat);
    tvHeartbeat = setInterval(() => {
      if (!TV.ws || TV.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - (TV.lastRecv || 0) > 15000) { try { TV.ws.close(); } catch {} return; }
      try { TV.ws.send(JSON.stringify({ type: "ping" })); } catch {}
    }, 5000);
    if (TV.wentOfflineAt) {
      const gapMs = Date.now() - TV.wentOfflineAt; TV.wentOfflineAt = 0;
      try { TV.ws.send(JSON.stringify({ type: "clientlog", event: "TV wieder verbunden", gapMs })); } catch {}
    }
  };
  ws.onclose = () => { clearInterval(tvHeartbeat); if (!TV.wentOfflineAt) TV.wentOfflineAt = Date.now(); setStatus("offline"); setTimeout(connect, 1500); };
  ws.onmessage = (ev) => {
    TV.lastRecv = Date.now();
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "hello") {
      // Nach einem Update: Beamer mit altem Code einmal neu laden (wie app.js).
      const eigene = (/[?&]v=([^&]+)/.exec((document.querySelector('script[src*="tv.js"]') || {}).src || "") || [])[1];
      let schon = null;
      try { schon = sessionStorage.getItem("neuGeladenFuer"); } catch { /* egal */ }
      if (msg.version && eigene && msg.version !== eigene && schon !== msg.version) {
        try { sessionStorage.setItem("neuGeladenFuer", msg.version); } catch { /* egal */ }
        location.reload();
      }
      return;
    }
    if (msg.type === "state") {
      if (msg.state.serverNow) TV.clockOffset = msg.state.serverNow - Date.now();
      TV.state = msg.state; render();
    }
  };
}
// Beim Wieder-Aufwecken (Tab sichtbar/Fokus/Netz) sofort neu verbinden.
document.addEventListener("visibilitychange", () => { if (!document.hidden) connect(); });
window.addEventListener("online", connect);

function setStatus(kind) {
  const s = $("status");
  if (!s) return;
  s.className = "pill " + (kind === "online" ? "good" : "bad");
  s.textContent = kind === "online" ? "Live" : "Getrennt…";
}

function statusOverlay(st) {
  if (!st) return "";
  let out = "";
  if (st.out) out += `<div class="st-cover">☠</div>`;
  const corner = [];
  if (st.shaken && !st.out) corner.push(`<div class="st-shaken">😵</div>`);
  if (st.wounds > 0 && !st.out) corner.push(`<div class="st-wounds">${Array.from({ length: st.wounds }).map(() => '<span class="st-wound"></span>').join("")}</div>`);
  if (corner.length) out += `<div class="st-corner">${corner.join("")}</div>`;
  return out;
}

function statusBadges(c) {
  const st = c.status; if (!st) return "";
  if (st.out) return `<span class="pill bad">Ausgeschaltet</span>`;
  const b = [];
  if (st.shaken) b.push(`<span class="pill warn">Angeschlagen</span>`);
  if (st.wounds > 0) b.push(`<span class="pill bad">🩸 ${st.wounds} W · −${st.wounds}</span>`);
  const conds = (TV.state && TV.state.conditions) || {};
  Object.keys(conds).forEach((k) => { if (st[k]) b.push(`<span class="pill">${esc(conds[k])}</span>`); });
  return b.join(" ");
}

function cardFace(cid, card, status, isJoker) {
  const holderCls = ["card-holder", status && status.out ? "is-out" : "", isJoker ? "joker-slot" : ""].filter(Boolean).join(" ");
  const cimg = ((TV.state && TV.state.combatants.find((c) => c.id === cid)) || {}).image || null;
  const svg = card ? Cards.renderCardSVG(card, cimg) : Cards.renderBackSVG(cimg);
  return `<div class="${holderCls}"><div class="tv-face">${svg}</div>${statusOverlay(status)}</div>`;
}

function render() {
  const s = TV.state;
  if (!s) return;
  Cards.setJokerRunde(s.round);             // gleicher Joker-Stil wie auf den Handys
  Cards.setRueckseite(s.rueckseiteBild);    // eigenes Rückseitenbild wie beim SL
  const root = $("tv");
  const active = s.combatants.find((c) => c.id === s.activeId);

  // Karten erst zeigen, wenn sie aufgedeckt sind (Gegner sofort, Spieler nach
  // dem Antippen am Handy). Vorher zeigte der TV alles offen und verriet den
  // Spielern ihre Karte, bevor sie selbst aufdecken durften - der Aufdeck-
  // Moment am Handy und die Reihenfolge-Sperre liefen damit ins Leere.
  const offen = (c) => !!(c.card && c.revealed);
  // Joker-Moment erst, wenn ein Joker OFFEN liegt - nicht schon beim Austeilen
  // (sonst weiß der Tisch vom Joker, bevor der Spieler aufgedeckt hat).
  const jokerJetzt = new Set(s.combatants.filter((c) => offen(c) && c.card.suit === "joker").map((c) => `${c.id}:${c.card.id}`));
  if (TV.jokerGesehen && [...jokerJetzt].some((k) => !TV.jokerGesehen.has(k))) triggerJokerMoment();
  TV.jokerGesehen = jokerJetzt;

  const prevRects = captureRects();
  const prevTokens = captureTokens();

  const zonesBlock = (s.combatants.length && window.Zones)
    ? `<div class="tv-zones"><h2 class="tv-zones-title">Kampfzonen</h2><div class="tv-zones-inhalt">${Zones.renderTarget(s.combatants, { zones: s.zones, activeId: s.activeId, interactive: false, blurAnon: true })}</div></div>`
    : "";

  const timerBlock = s.phase === "running"
    ? `<div class="tv-timer" id="tvtimer">…</div>`
    : `<div class="tv-phase">${s.phase === "gate" ? "Bereit – warte auf Freigabe" : "Bereit"}</div>`;

  const spotlight = active
    ? `<div class="tv-spotlight">
         <div class="tv-bigcard">${cardFace(active.id, offen(active) ? active.card : null, active.status, offen(active) && active.card.suit === "joker")}</div>
         <div class="tv-actorinfo">
           <div class="tv-actorlabel">Am Zug</div>
           <div class="tv-actorname">${esc(active.name)}</div>
           <div>${statusBadges(active)}</div>
         </div>
       </div>`
    : `<div class="tv-spotlight muted">Noch keine Initiative ausgeteilt.</div>`;

  const tiles = s.combatants.map((c, i) => {
    const isActive = c.id === s.activeId;
    const hasJoker = offen(c) && c.card.suit === "joker";
    const heldPill = c.held ? `<span class="pill warn">hält</span>` : "";
    const jokerBadge = hasJoker ? `<span class="pill" style="background:var(--gold);color:#1a1206;border-color:var(--gold);font-weight:800">★ JOKER</span>` : "";
    return `<div class="tv-tile ${isActive ? "active" : ""} ${c.kind === "npc" ? "enemy" : ""} ${hasJoker ? "joker-holder" : ""}" data-cid="${c.id}">
      <div class="tv-tilepos">${i + 1}</div>
      ${cardFace(c.id, offen(c) ? c.card : null, c.status, hasJoker)}
      <div class="tv-tilename">${c.anon
        ? `<span class="verdeckt">${esc(c.name)}</span>`
        : esc(c.name)} ${heldPill}</div>
      <div class="badges">${jokerBadge} ${statusBadges(c)} ${offen(c) ? Cards.trail(c) : ""}</div>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="tv-top">
      <div class="tv-round">Runde ${s.round}</div>
      ${timerBlock}
    </div>
    <div class="tv-haupt">
      <div class="tv-links"><div class="tv-buehne">${spotlight}</div><div class="tv-order">${tiles}</div></div>
      ${zonesBlock}
    </div>
    ${s.tvImage && (s.tvImage.imageUrl || s.tvImage.text) ? `<div class="tv-image-overlay">
      ${s.tvImage.imageUrl ? `<img src="${esc(s.tvImage.imageUrl)}">` : ""}
      ${s.tvImage.text ? `<div class="tv-image-caption">${esc(s.tvImage.text)}</div>` : ""}
    </div>` : ""}`;

  einpassen();              // VOR playFlip: die Animation braucht die Endpositionen
  playFlip(prevRects);
  playTokens(prevTokens);
}

// Der TV/Beamer muss IMMER auf einen Bildschirm passen - dort scrollt niemand
// (Stefan). Je nach Auflösung und Anzahl der Figuren wird darum gerechnet:
// - Quer: das hohe Zonen-Board bekommt eine eigene Spalte rechts über die
//   ganze Höhe (in einer flachen Reihe wurde es bei vielen Figuren winzig),
//   links „Am Zug" + Reihenfolge. Hochkant: alles untereinander.
// - Die Bühne („Am Zug") bleibt so hoch wie möglich, solange die Kacheln
//   lesbar groß bleiben; Spaltenzahl so, dass die Kacheln am größten werden.
const ZONEN_B = 480;          // natürliche Breite des Zonen-Boards (zones-target)
function einpassen() {
  const root = $("tv");
  if (!root) return;
  const hoehe = window.innerHeight, breite = window.innerWidth;
  const hoch = hoehe > breite * 1.1;
  document.body.classList.toggle("tv-hoch", hoch);
  const haupt = root.querySelector(".tv-haupt");
  const order = root.querySelector(".tv-order");
  const buehne = root.querySelector(".tv-buehne");
  const zonen = root.querySelector(".tv-zones");
  const inhalt = root.querySelector(".tv-zones-inhalt");
  const kacheln = order ? [...order.children] : [];
  const n = kacheln.length;
  const luecke = Math.max(6, Math.round(hoehe * 0.012));
  if (order) order.style.setProperty("--luecke", luecke + "px");

  // Zonen-Board einpassen: Faktor aus verfügbarer Höhe (quer: ganze Spalte,
  // hochkant: fester Anteil) und höchstens gut ein Drittel der Breite.
  const zonenEinpassen = (platzH, platzB) => {
    if (!zonen || !inhalt) return;
    inhalt.style.transform = "none";
    const titel = zonen.querySelector(".tv-zones-title");
    const titelH = titel ? titel.offsetHeight + 6 : 0;
    const f = Math.max(0.2, Math.min(1.5, (platzH - titelH) / Math.max(1, inhalt.offsetHeight), platzB / ZONEN_B));
    inhalt.style.transform = `scale(${f.toFixed(3)})`;
    zonen.style.width = hoch ? "" : Math.ceil(ZONEN_B * f) + "px";
  };
  if (zonen) {
    if (hoch) { zonen.style.height = Math.round(hoehe * 0.26) + "px"; zonenEinpassen(hoehe * 0.26, breite - 40); }
    else { zonen.style.height = ""; zonenEinpassen(haupt ? haupt.clientHeight : hoehe * 0.8, breite * 0.34); }
  }

  let verhaeltnis = 1.5;                      // Höhe : Breite einer Kachel
  if (n) {
    order.style.setProperty("--kachel-b", "100px");
    order.style.setProperty("--spalten", String(Math.min(n, 10)));
    verhaeltnis = Math.max(...kacheln.map((k) => k.offsetHeight)) / 100 || 1.5;
  }
  const mindestens = Math.min(150, breite / 9);  // darunter wird es unleserlich
  const stufen = n ? (hoch ? [0.3, 0.25, 0.2, 0.16] : [0.5, 0.44, 0.38, 0.32, 0.26, 0.2]) : [0.62];
  let wahl = { b: 0, sp: 1 };
  for (const anteil of stufen) {
    if (buehne) buehne.style.height = Math.round(hoehe * anteil) + "px";
    const H = order ? order.clientHeight : 0, B = order ? order.clientWidth : 0;
    let best = { b: 0, sp: 1 };
    for (let sp = 1; sp <= n; sp++) {
      const zeilen = Math.ceil(n / sp);
      const b = Math.min((B - (sp - 1) * luecke) / sp, (H - (zeilen - 1) * luecke) / zeilen / verhaeltnis);
      if (b > best.b) best = { b, sp };
    }
    wahl = best;
    if (!n || best.b >= mindestens) break;
  }
  if (order && n) {
    order.style.setProperty("--kachel-b", Math.max(40, Math.floor(wahl.b)) + "px");
    order.style.setProperty("--spalten", String(wahl.sp));
  }
}
let _einpassenTakt = null;
window.addEventListener("resize", () => { clearTimeout(_einpassenTakt); _einpassenTakt = setTimeout(einpassen, 80); });

// Timer-Anzeige (nur darstellen, keine Steuerung).
setInterval(() => {
  const s = TV.state;
  const t = $("tvtimer");
  if (!s || !t || s.phase !== "running" || !s.timerEndsAt) return;
  const rem = Math.max(0, s.timerEndsAt - (Date.now() + TV.clockOffset));
  const sec = Math.ceil(rem / 1000);
  t.textContent = sec + "s";
  // Warnbereich = letztes Achtel der eingestellten Zeit.
  t.classList.toggle("low", rem <= (s.timerSeconds * 1000) / 8);
}, 200);

connect();
