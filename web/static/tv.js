// Read-only Beamer-/TV-Ansicht. Lauscht nur auf den Zustand (sendet nichts).

const TV = { ws: null, state: null, prevJokerFlash: null, clockOffset: 0 };
const $ = (id) => document.getElementById(id);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Skin vom Gerät übernehmen + Nebel-Ambiente.
(function init() {
  const skin = localStorage.getItem("skin") || "pergament";
  const skins = ["sand", "skies", "blood", "dark", "glutstein", "nebelmeer", "pergament"];
  document.body.classList.add("theme-" + (skins.includes(skin) ? skin : "pergament"));
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
  const root = $("tv");
  const active = s.combatants.find((c) => c.id === s.activeId);

  // Joker-Moment bei neuem Joker.
  if (TV.prevJokerFlash === null) TV.prevJokerFlash = s.jokerFlash;
  else if (s.jokerFlash > TV.prevJokerFlash) { TV.prevJokerFlash = s.jokerFlash; triggerJokerMoment(); }

  const prevRects = captureRects();
  const prevTokens = captureTokens();

  const zonesBlock = (s.combatants.length && window.Zones)
    ? `<div class="tv-zones"><h2 class="tv-zones-title">Kampfzonen</h2>${Zones.renderTarget(s.combatants, { zones: s.zones, activeId: s.activeId, interactive: false })}</div>`
    : "";

  const timerBlock = s.phase === "running"
    ? `<div class="tv-timer" id="tvtimer">…</div>`
    : `<div class="tv-phase">${s.phase === "gate" ? "Bereit – warte auf Freigabe" : "Bereit"}</div>`;

  const spotlight = active
    ? `<div class="tv-spotlight">
         <div class="tv-bigcard">${cardFace(active.id, active.card, active.status, active.card && active.card.suit === "joker")}</div>
         <div class="tv-actorinfo">
           <div class="tv-actorlabel">Am Zug</div>
           <div class="tv-actorname">${esc(active.name)}</div>
           <div>${statusBadges(active)}</div>
         </div>
       </div>`
    : `<div class="tv-spotlight muted">Noch keine Initiative ausgeteilt.</div>`;

  const tiles = s.combatants.map((c, i) => {
    const isActive = c.id === s.activeId;
    const hasJoker = c.card && c.card.suit === "joker";
    const heldPill = c.held ? `<span class="pill warn">hält</span>` : "";
    const jokerBadge = hasJoker ? `<span class="pill" style="background:var(--gold);color:#1a1206;border-color:var(--gold);font-weight:800">★ JOKER</span>` : "";
    return `<div class="tv-tile ${isActive ? "active" : ""} ${c.kind === "npc" ? "enemy" : ""} ${hasJoker ? "joker-holder" : ""}" data-cid="${c.id}">
      <div class="tv-tilepos">${i + 1}</div>
      ${cardFace(c.id, c.card, c.status, hasJoker)}
      <div class="tv-tilename">${c.anon
        ? `<span class="verdeckt">${esc(c.name)}</span>`
        : esc(c.name)} ${heldPill}</div>
      <div class="badges">${jokerBadge} ${statusBadges(c)}</div>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="tv-top">
      <div class="tv-round">Runde ${s.round}</div>
      ${timerBlock}
    </div>
    ${spotlight}
    ${zonesBlock}
    <div class="tv-order">${tiles}</div>
    ${s.tvImage && (s.tvImage.imageUrl || s.tvImage.text) ? `<div class="tv-image-overlay">
      ${s.tvImage.imageUrl ? `<img src="${esc(s.tvImage.imageUrl)}">` : ""}
      ${s.tvImage.text ? `<div class="tv-image-caption">${esc(s.tvImage.text)}</div>` : ""}
    </div>` : ""}`;

  playFlip(prevRects);
  playTokens(prevTokens);
}

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
