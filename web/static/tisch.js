// Was SL und Spieler gemeinsam am Tisch sehen: Karten aufdecken, Reihenfolge-
// Animation, Kampfzonen, Gruppen, Joker-Moment, Talente, Timer.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// --- Karten / Flip ----------------------------------------------------------

// opts.open   = soll die Karte (auf diesem Gerät) offen liegen? (SL: immer; Spieler:
//               nur wenn tischweit aufgedeckt). opts.tappable = eigene verdeckte
//               Großkarte, die der Spieler antippen darf.
function cardSlot(cid, card, status, extraClass = "", opts = {}) {
  const { open = true, tappable = false } = opts;
  const key = card ? `${cid}:${card.id}` : `${cid}:none`;
  // Char-Bild dieser Figur: Vorder- UND Rückseite im Design des Bildes.
  const fig = (App.state && App.state.combatants.find((x) => x.id === cid)) || {};
  const cimg = fig.image || null;
  const rwahl = fig.rueckseite || null;     // Rückseite, die sich der Spieler ausgesucht hat
  const front = card ? Cards.renderCardSVG(card, cimg) : Cards.renderBackSVG(cimg, rwahl);
  const isJoker = card && card.suit === "joker";
  const holderCls = ["card-holder", extraClass,
    status && status.out ? "is-out" : "",
    status && status.shaken ? "is-shaken" : "",
    isJoker ? "joker-slot" : ""].filter(Boolean).join(" ");
  const faces = `<div class="flip-inner">
      <div class="flip-face flip-front">${front}</div>
      <div class="flip-face flip-back">${Cards.renderBackSVG(cimg, rwahl)}</div>
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

  // Bogen der Mitspieler sieht jeder, Gegner-Spielwerte nur der SL (die
  // Handys bekommen sie gar nicht erst).
  const bogenKnopf = hatBogen(c) || hatSpielwerte(c)
    ? `<button class="ghost" data-act="bogen-ansicht" data-id="${c.id}" style="width:100%;margin-bottom:8px">📜 ${c.kind === "npc" ? "Spielwerte" : "Charakterbogen"}</button>`
    : "";
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
      ${bogenKnopf}${moveHtml}${zoneSetHtml}${slHtml}${attackHtml}
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
