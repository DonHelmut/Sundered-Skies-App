// Spielleiter-Pult: Panels, Anordnen per Ziehen, Rechtsklick-Menü,
// Kämpfe vorbereiten.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

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
      <h1 class="kopf-marke"><img src="/static/icon.svg" alt="" class="kopf-logo"><span class="wortmarke">Sundered Skies</span><span class="kopf-rolle">Spielleiter</span></h1>
      <div class="row tight">
        ${updateKopfHtml()}
        ${handysKopfHtml()}
        ${aufnahmeKopfHtml()}
        ${modusKopfHtml()}
        ${anordnungIstStandard(spalte) ? "" : `<button class="ghost" data-act="anordnung-zuruecksetzen" title="Panels wieder in die ursprüngliche Reihenfolge bringen">↺ Anordnung zurücksetzen</button>`}
        <span class="kopf-gruppe">
        ${kopfMenueHtml()}
        <button class="ghost" data-act="fokus" title="Alles ausser Kampf, Zonen und Reihenfolge zuklappen">
          ${App.fokus ? "▤ Alles zeigen" : "▣ Fokus auf den Kampf"}</button>
        </span>
      </div>
    </div>
    ${resume}
    <div class="grid2">
      <div class="sp sp1" data-spalte="links">${spalte.links.map((k) => PANEL_BAU[k]()).join("")}</div>
      <div class="sp sp2" data-spalte="rechts">${spalte.rechts.map((k) => PANEL_BAU[k]()).join("")}</div>
    </div>
    ${renderAktionsleiste()}
    ${App.tastenHilfe ? tastenHilfeHtml() : ""}
    ${modusFensterHtml()}${anleitungHtml()}
    ${renderRequestsPanel()}
    ${angriffPopupHtml()}
    <datalist id="effekt-vorschlaege">${EFFEKT_VORSCHLAEGE.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
}

// --- Panels selbst anordnen (nur SL) -----------------------------------------
// Jedes Panel laesst sich an seiner Ueberschrift auf einen anderen Platz ziehen,
// auch in die andere Spalte. Die Anordnung gilt pro Geraet (wie das Auf-/
// Zuklappen). Schluessel = data-sec des Panels.
const PANEL_BAU = {
  // Kein Panel mehr (schwebt, siehe renderRequestsPanel) - der Schlüssel
  // bleibt, damit gemerkte Anordnungen von früher weiter passen.
  requests: () => "",
  // 🎛 Ausgeschaltete Teile (funktionAn) bauen gar kein Panel - die
  // Anordnung bleibt trotzdem gemerkt, beim Einschalten steht es wieder da.
  zones: () => funktionAn("zonen") ? renderZonesPanel() : "",
  message: () => funktionAn("nachrichten") || funktionAn("bennies") ? renderMessagePanel() : "",
  bibliothek: () => renderBibliothekPanel(),
  connect: () => renderConnectPanel(),
  combat: () => renderOrderPanel(true),
  // Läuft gerade eine Aufnahme, bleibt das Panel - sonst käme man nach dem
  // Ausschalten nicht mehr an „■ Beenden".
  aufnahme: () => funktionAn("aufnahme") || Aufn.rec ? renderAufnahmePanel() : "",
  protokolle: () => funktionAn("aufnahme") ? renderProtokollPanel() : "",
  geld: () => funktionAn("geld") ? renderGeldPanel() : "",
};
const STANDARD_ANORDNUNG = {
  links: ["requests", "zones", "message", "geld", "bibliothek", "connect", "aufnahme", "protokolle"],
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
  html += adressBereichHtml(info.ip);
  return html;
}

// Woran ein Spieler selbst erkennt, ob sein Handy im richtigen Netz ist: seine
// WLAN-Adresse muss mit denselben drei Zahlen anfangen wie die des Laptops.
// Sonst rätselt man am Tisch – Gast-WLAN und Mobilfunk sehen am Handy beide
// nach „verbunden" aus.
function adressBereichHtml(ip) {
  const bereich = adressBereich(ip);
  if (!bereich) return "";
  return `<div class="muted small adress-bereich" style="margin-top:8px; line-height:1.5">
    📶 Handys brauchen eine WLAN-Adresse, die mit <b>${esc(bereich)}</b>… anfängt (wie dieser Laptop).
    Andere Zahl = falsches Netz (Gast-WLAN, Mobilfunk) → ins selbe WLAN wechseln, mobile Daten aus.
    <span class="hilfe" style="display:block">Nachsehen am Handy – ${esc(HANDY_IP_FINDEN)}</span></div>`;
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

// Kopfleiste (Studio-Runde 6): statt der grünen „Verbunden"-Pille mitten in
// der Leiste ein ruhiger Punkt mit dem, was der SL wirklich wissen will – wie
// viele Handys da sind. Getrennt/Verbinde-neu zeigt weiter die Pille (CSS).
// Feste Breite (min-width), damit „1 Handy"/„12 Handys" die Knöpfe nicht rückt.
function handysKopfHtml() {
  const players = (App.state && App.state.players) || [];
  const da = players.filter((p) => p.connected).length;
  const text = players.length ? `${da} ${da === 1 ? "Handy" : "Handys"} verbunden` : "Noch kein Handy";
  return `<span class="kopf-handys${da ? " an" : ""}" title="${esc(players.map((p) => `${p.connected ? "●" : "○"} ${p.name}`).join("\n") || "Spieler treten per QR-Code bei")}"><i></i>${text}</span>`;
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
  // Symbol + Farbe je Art (Kalle, 14.11.2026, Studio-Runde 2 Vorschlag 2) statt
  // nacktem Text: ✓/■ Erfolg (grün), ● Aufnahme (rot), ⚠/„geht nicht" Warnung,
  // sonst Hinweis. Ein Emoji/Zeichen vorn wird zum Symbol der Kachel.
  const t = String(text || "").trim();
  const vorn = [["●", "circle-dot", "rec"], ["■", "circle-check", "ok"], ["✓", "circle-check", "ok"], ["⚠", "triangle-alert", "warn"]]
    .find(([z]) => t.startsWith(z));
  const emo = !vorn && typeof SYMBOL_ZU === "object" && Object.keys(SYMBOL_ZU).find((e) => t.startsWith(e));
  const rest = (vorn ? t.slice(vorn[0].length) : emo ? t.slice(emo.length) : t).replace(/^\uFE0F?\s*/, "");
  const art = vorn ? vorn[2] : /nicht|fehl|kein|erst /i.test(rest) ? "warn" : /gespeichert|kopiert|gesetzt|gesendet|fertig|bereit/i.test(rest) ? "ok" : "info";
  const sym = vorn ? vorn[1] : emo ? SYMBOL_ZU[emo] : { ok: "circle-check", warn: "triangle-alert" }[art] || "info";
  el.className = `toast toast-${art}${el.classList.contains("sichtbar") ? " sichtbar" : ""}`;
  el.innerHTML = `<span class="toast-sym">${symbolSvg(sym)}</span><span class="toast-text">${esc(rest)}</span>`;
  // Über der festen Leiste unten erscheinen - sonst lag die Meldung genau
  // auf „danach: …" und den Knöpfen (Höhe schwankt: Handy bricht um).
  const leiste = document.querySelector(".aktionsleiste");
  el.style.bottom = leiste ? `${leiste.offsetHeight + 12}px` : "";
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
function bereichsTipp(url) {
  const bereich = adressBereich((/\/\/([^:/]+)/.exec(url) || [])[1]);
  return bereich ? `

Klappt es nicht? In den WLAN-Einstellungen nachsehen: die IP-Adresse deines Handys muss mit ${bereich} anfangen – sonst bist du im falschen WLAN (z. B. Gast-WLAN).` : "";
}

function einladungstext() {
  const url = (App._info && App._info.url) || location.origin + "/";
  // Kein Emoji am Anfang: WhatsApp am PC zeigte den Würfel als „�".
  return `Sundered Skies – Initiative

So kommst du rein:
1) Mobile Daten AUSSCHALTEN (WLAN bleibt an) – sonst springt das Handy mitten im Spiel vom Tisch weg.
2) Ins gleiche WLAN wie mein Laptop.
3) Diesen Link antippen:

${url}

Lässt sich der Link nicht antippen? Lange drücken → Kopieren → in Chrome oder Safari oben einfügen.${bereichsTipp(url)}`;
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
  const bereich = adressBereich((/\/\/([^:/]+)/.exec(url) || [])[1]);
  const B = 640, H = bereich ? 970 : 900;
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
    ...(bereich ? ["", `Geht nicht? Handy-IP (WLAN-Einstellungen)`, `muss mit ${bereich} anfangen – sonst falsches WLAN`] : []),
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
      <li><b>Netzwerk einrichten:</b> im App-Ordner unter <code>Netzwerk-Hilfe</code>
        <code>Netzwerk-einrichten.bat</code> doppelklicken (Firewall frei + WLAN-Stromsparen aus). Sonst drosselt
        Windows die WLAN-Karte im Akkubetrieb. Auf fremden Laptops danach <code>Netzwerk-rueckgaengig.bat</code> – stellt alles wie vorher.</li>
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
  // Gegliedert wie ein Programm-Menü (Kalle, 14.11.2026, Studio-Runde 5):
  // vorher zehn gleich aussehende Kasten-Knöpfe untereinander, man musste
  // jeden lesen. Jetzt drei Gruppen, Zeilen ohne Rahmen, Kürzel rechts.
  return `<details class="kopf-menue" data-merk="kopfmenue"${App.offeneUnter.has("kopfmenue") ? " open" : ""}>
    <summary title="Werkzeuge: TV-Modus, Sicherung, Bilder aufräumen">☰ Mehr</summary>
    <div class="kopf-menue-inhalt">
      <div class="km-gruppe">Spiel</div>
      <button class="km-zeile" data-act="modus-oeffnen" title="Teile der App an- und ausschalten (z. B. nur Reihenfolge, ohne Treffer)">🎛 Was nutzen wir heute?</button>
      <a href="/tv" target="_blank" rel="noopener"><button class="km-zeile">📺 TV-/Beamer-Modus öffnen</button></a>
      <button class="km-zeile" data-act="reset" title="Alle Karten einsammeln und neu mischen, Runde 0 – Gegner bleiben stehen">⟲ Karten einsammeln (Runde 0)</button>
      <div class="km-trenner"></div>
      <div class="km-gruppe">Daten</div>
      <a href="/api/export"><button class="km-zeile" title="Charaktere + Bibliotheken + Begegnungen, mit allen Bildern (Zip)">💾 Sicherung exportieren</button></a>
      <label class="km-zeile" title="Zip-Sicherung (oder alte .json) einspielen">⤵ Sicherung importieren
        <input type="file" accept=".zip,application/zip,application/json,.json" data-act="pick-import" style="display:none"></label>
      <button class="km-zeile" data-act="sicherungen-zeigen" title="Die App sichert Charaktere, Notizen, Bibliotheken und Protokolle etwa stündlich selbst">🛟 Automatische Sicherungen</button>
      <button class="km-zeile" data-act="bilder-aufraeumen" title="Löscht hochgeladene Bilder, die von keiner Figur mehr benutzt werden">🧹 Alte Bilder aufräumen</button>
      <div class="km-trenner"></div>
      <div class="km-gruppe">Hilfe</div>
      <button class="km-zeile" data-act="anleitung-oeffnen" title="Was alles geht und wo es steckt">📖 Anleitung für den SL</button>
      <button class="km-zeile" data-act="tasten-hilfe" title="Alle Tastenkürzel (Taste ?)">⌨ Tastenkürzel<kbd>?</kbd></button>
      <div class="km-fuss">${versionLine()}</div>
    </div>
  </details>`;
}

// Beitritt-Panel (AAA-Runde 17.11.2026, Vorschlag 4). Vorher: QR, zwei
// Adressen als Code-Kästchen, drei Zeilen Netz-Erklärung, vier Knöpfe und
// grüne Namens-Pillen - alles gleich laut. Jetzt: QR + EINE große Adresse
// (die IP - die klappt an jedem Handy, pnp.local nicht überall), zwei Knöpfe
// + ⋯ (Teilen, WhatsApp), „Am Tisch" als Avatare. Die Netz-Hilfe steht hinter
// „Handy kommt nicht rein?"; Warnungen (Adresse gewechselt, kein WLAN,
// öffentliches Netz) bleiben sichtbar oben.
const ohneSchema = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
function beitrittAdresseHtml() {
  const info = App._info;
  if (!info) return `<div class="bt-adr">…</div>`;
  const urls = (info.urls && info.urls.length) ? info.urls : [info.url];
  const loopback = /127\.0\.0\.1/.test(info.ip || info.url || "");
  return `<div class="bt-adr" title="${esc(urls[0])}">${esc(ohneSchema(urls[0]))}</div>
    ${info.prettyUrl ? `<div class="bt-adr2">oder ${esc(ohneSchema(info.prettyUrl))}</div>` : ""}
    ${loopback ? `<div class="pill bad" style="margin-top:8px">⚠ Keine WLAN-Adresse gefunden – ist der Laptop im WLAN? 127.0.0.1 erreicht keine Handys.</div>` : ""}`;
}
function amTischHtml() {
  const players = (App.state && App.state.players) || [];
  if (!players.length) return `<div class="bt-gruppe">Am Tisch</div><div class="muted small">Noch niemand beigetreten.</div>`;
  const online = players.filter((p) => p.connected).length;
  const plaetze = players.map((p) => `<div class="bt-platz${p.connected ? "" : " weg"}" title="${esc(p.name)} – ${p.connected ? "verbunden" : "offline"}">
      <span class="bt-av">${esc(zoneInitials(p.name))}</span><span class="bt-name">${esc(p.name)}</span></div>`).join("");
  return `<div class="bt-gruppe">Am Tisch · ${online} von ${players.length} verbunden</div><div class="bt-plaetze">${plaetze}</div>`;
}
function beitrittHilfeHtml() {
  const info = App._info || {};
  const urls = (info.urls && info.urls.length) ? info.urls : [];
  const pub = info.networkPublic === true;
  return `<details class="unter-klapp bt-hilfe" data-merk="bt-hilfe"${App.offeneUnter.has("bt-hilfe") ? " open" : ""}>
    <summary>${symbolSvg("circle-help")} Handy kommt nicht rein?</summary>
    <div class="bt-hilfe-inhalt">
      ${wlanHtml(info.wlan)}
      ${adressBereichHtml(info.ip)}
      ${urls.length > 1 ? `<div class="muted small" style="margin-top:8px">Andere Adresse probieren (muss zum WLAN des Handys passen):</div>
        ${urls.slice(1).map((u) => `<div style="margin-top:3px"><code class="url">${esc(u)}</code></div>`).join("")}` : ""}
      ${pub ? "" : firewallHtml()}
      ${verbindungsHilfeHtml()}
    </div>
  </details>`;
}
function renderConnectPanel() {
  const info = App._info || {};
  const pub = info.networkPublic === true;
  const mehr = App.btMehr ? `<div class="bib-pop bib-pop-menue bt-pop" role="menu">
      <button type="button" class="km-zeile" data-act="einladung-teilen" title="Bild mit QR-Code über den Teilen-Dialog verschicken">${symbolSvg("upload")} Teilen …</button>
      <button type="button" class="km-zeile" data-act="einladung-whatsapp" title="Nur Text – WhatsApp macht die Adresse leider nicht antippbar">${symbolSvg("message-circle")} Text per WhatsApp</button>
    </div>` : "";
  return section("connect", "Beitritt für Spieler", `
    ${adresswechselHtml()}
    <div class="bt">
      <img class="bt-qr" src="/qr.png" alt="QR-Code" onerror="this.style.display='none'">
      <div class="bt-rechts">
        ${beitrittAdresseHtml()}
        <div class="bt-knoepfe">
          <button class="primary" data-act="einladung-bild" title="Bild mit QR-Code kopieren – in WhatsApp mit Strg+V einfügen">${symbolSvg("image")} QR-Bild kopieren</button>
          <button class="ghost" data-act="qr-gross" title="QR-Code bildschirmfüllend zum Scannen am Tisch">${symbolSvg("scan")} Groß zeigen</button>
          <span class="bt-mehr-huelle"><button class="ghost bt-mehr${App.btMehr ? " on" : ""}" data-act="bt-mehr" title="Teilen, WhatsApp" aria-label="Weitere Wege">⋯</button>${mehr}</span>
        </div>
      </div>
    </div>
    ${pub ? firewallHtml() : ""}
    ${amTischHtml()}
    ${beitrittHilfeHtml()}`);
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
  // Kleine Knöpfe IN der Knopfzeile statt eigener Zeilen darüber (Kalle,
  // 11.11.2026: „beim SL soll nichts mehr geschoben werden"). Vorher erschien
  // beim ersten gefallenen Gegner eine neue Zeile und drückte die ganze
  // Reihenfolge 40 px nach unten - genau während man darin klickt.
  const cleanupRow = defeated.length
    ? `<button class="ghost small bad" data-act="clear-defeated" data-n="${defeated.length}" title="${defeated.length} ausgeschaltete${defeated.length === 1 ? "n Gegner" : " Gegner"} sofort entfernen – spätestens bei der nächsten Runde verschwinden sie von selbst (keine Karte mehr)">🧹 ${defeated.length} weg</button>`
    : "";
  // Kampfende: kein Gegner mehr auf den Beinen, aber Spieler sind verletzt ->
  // ein Knopf heilt alle (Kalle, 30.10.2026). Nur dann sichtbar, mitten im
  // Kampf wäre er eine Falle.
  const verletzt = s.combatants.filter((c) => c.kind === "player"
    && ((c.status || {}).out || (c.status || {}).wounds || (c.status || {}).shaken));
  const gegnerSteht = s.combatants.some((c) => c.kind === "npc" && !c.ally && !c.benched && !(c.status || {}).out);
  // Außerhalb des Kampfes steht der Knopf IMMER da (Kalle, 11.11.2026) - ist
  // niemand verletzt, nur ausgegraut: so kommt und geht nichts in der Zeile.
  const ohneKampf = !s.combatants.some((c) => c.kind === "npc");
  const heilRow = () => (ohneKampf && s.combatants.length) || (verletzt.length && !gegnerSteht)
    ? `<button class="ghost small good" data-act="alle-heilen" ${verletzt.length ? "" : "disabled"} title="${verletzt.length
      ? `Alle Spieler ganz heil (${verletzt.length} verletzt): wach, keine Wunden, nicht angeschlagen. Rückgängig mit ↶`
      : "Gerade ist niemand verletzt"}">🩹 Alle heilen</button>`
    : "";
  // Alles in EINER Zeile: Austeilen (am Rundenende gross), dahinter kleine
  // Symbol-Knoepfe. Vorher zwei Zeilen mit breiten Text-Knoepfen - rund 80 px,
  // die in der Reihenfolge darunter fehlten. Was sie tun, steht im Tooltip.
  // 🏁 Kampf beenden (Kalle, 11.11.2026, 1A): ein Knopf mit Text statt der
  // zwei Symbole ⟲ und 🧹, die keiner auseinanderhielt. Nur wenn es einen
  // Kampf gibt (Gegner/Verbündete da oder Karten ausgeteilt).
  const zeigeBeenden = !!s.round || s.combatants.some((c) => c.kind === "npc");
  // Vorbereitete Kämpfe genau dann anbieten, wenn keiner läuft (Sitzungsbeginn,
  // nach „Kampf abräumen") - im Kampf wäre die Auswahl nur Ballast.
  const kaempfe = s.encounters || [];
  // Der Weg zu „Kämpfe vorbereiten" (Kalle 04.11.2026: lag zu versteckt im
  // dritten Bibliotheks-Reiter) steht hier mit drin - aber auch nur, solange
  // kein Kampf läuft. Im Kampf bleibt die Leiste frei, wer nichts vorbereitet,
  // sieht nur einen kleinen Knopf.
  const keinKampf = !s.combatants.some((c) => c.kind === "npc");
  // Seit 11.11.2026 IN der Knopfzeile statt als eigene Zeile darüber: die kam
  // und ging mit jedem Kampf und schob die Reihenfolge jedes Mal 50 px.
  const verwalten = `<button class="ghost small${kaempfe.length ? " symbol" : ""}" data-act="kaempfe-zeigen" title="Kämpfe verwalten: vorab zusammenstellen, bearbeiten, kopieren (Bibliothek → Kämpfe)">⚔${kaempfe.length ? "" : " Kampf vorbereiten"}</button>`;
  const schnellstart = !keinKampf ? ""
    : kaempfe.length
      ? `<span class="schnellkampf" title="Vorbereiteter Kampf">
        <select id="schnellkampf">${kaempfe.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select>
        <button class="small primary" data-act="schnellkampf-start" title="Kampf einsetzen, Charaktere an ihre Startzone und austeilen">▶ Starten</button>
        ${verwalten}</span>`
      : `<span class="schnellkampf">${verwalten}</span>`;
  return `
    <div class="kampf-knoepfe">
      ${/* Kurze Beschriftung: der Knopf teilt sich die Zeile mit bis zu vier
            weiteren (↶, 🧹 … weg, 🩹, 🏁) und darf nicht umbrechen - der lange
            Text steht im Tooltip und in der Leiste unten. */ ""}
      <button class="${rundeDran ? "primary" : "ghost small"}" data-act="new-round" title="Allen Teilnehmern (Spieler & Gegner) gleichzeitig eine neue Karte austeilen">🃏 ${s.round === 0 ? (schnellstart ? "Austeilen" : "Karten austeilen") : rundeDran ? "Neue Runde austeilen" : "Neue Runde"}</button>
      ${schnellstart || phasePill}
      <span class="kampf-knoepfe-rest">
        <button class="ghost small" data-act="undo" ${s.canUndo ? "" : "disabled"} title="Letzte Aktion rückgängig">↶ Zurück</button>
        ${cleanupRow}${heilRow()}
        ${zeigeBeenden || s.countdown ? `<button class="ghost small${s.countdown ? " cd-knopf an" : ""}" data-act="countdown" title="${s.countdown ? "Countdown ändern oder wegnehmen" : "Countdown für alle: zählt bei jeder neuen Runde selbst runter (z. B. „Schiff bricht“)"}">⏳ ${s.countdown ? `noch ${s.countdown.runden}` : "Countdown"}</button>` : ""}
        ${zeigeBeenden ? `<button class="ghost small" data-act="kampf-beenden" title="Gegner und Verbündete entfernen, Karten einsammeln – die Handys zeigen sofort „Gerade kein Kampf“. Wunden und Bennies bleiben.">🏁 Kampf beenden</button>` : ""}
      </span>
    </div>
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
    return "";
  }
  // „Runde beendet" steht in der Leiste unten - die zweite Pille hier schob
  // am Rundenende die ganze Reihenfolge nach unten (Kalle, 11.11.2026).
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

  const st = active.status || {};
  const gruppe = kartenGruppeVon(active);
  const anzeigeName = gruppe.length > 1 ? `${grundname(active.name)} ×${gruppe.length}` : active.name;
  // Angeschlagen? Dann gehört die Erholung JEDEN Zug an den Anfang - direkt hier.
  const bq = bennyQuelle(active);
  const mitWunden = funktionAn("wunden"), mitAngriff = funktionAn("angriff");
  const erholen = mitWunden && st.shaken && !st.out && gruppe.length === 1 ? `
      <button class="st-btn erholt-knopf" data-act="recover" data-id="${active.id}" data-benny="0" title="Probe geschafft (Willenskraft oder Konstitution): nicht mehr angeschlagen">✓ erholt</button>
      ${bq ? `<button class="st-btn" data-act="recover" data-id="${active.id}" data-benny="1" ${bq.n > 0 ? "" : "disabled"}
        title="${bq.feind ? `Benny aus dem SL-Pool (${bq.n})` : `Eigenen Benny ausgeben (${bq.n})`} – sofort erholt">🪙</button>` : ""}` : "";
  const istNsc = active.kind === "npc";
  // Wer kommt danach? Der SL soll nicht suchen müssen, wen er als Nächstes
  // ansagen muss - pausierte und ausgeschiedene Figuren überspringen wir.
  const naechster = naechsterAkteur(s);

  // Freigeben links, Weiter rechts - IMMER (Bedienbarkeit 25.11.2026). Vorher
  // tauschten die beiden je nach Spieler/Gegner den Platz, und wer im Takt auf
  // dieselbe Stelle klickte, erwischte den falschen. Jetzt wechselt nur die Farbe.
  const haupt = s.phase === "running"
    ? `<button class="good big" data-act="confirm-turn">Zug bestätigen ✓</button>`
    : `<button class="${istNsc ? "ghost" : "primary big"}" data-act="release">Freigeben ▶</button>
       <button class="${istNsc ? "primary big" : "ghost"}" data-act="skip-turn" title="Ohne Timer sofort zum nächsten">Weiter ⏭</button>`;

  // Countdown kompakt in der Leiste - er saß vorher im Panel, das jetzt schlank ist.
  const uhr = s.phase === "running" && s.timerEndsAt
    ? `<span class="al-uhr" id="al-uhr">–</span>`
    // Angehalten (Spieler greift an/erholt sich und würfelt): zeigen, warum
    // nichts mehr herunterzählt. Ohne id - die Uhr-Schleife leert sonst den Text.
    : s.phase === "running" && funktionAn("timer") ? `<span class="al-uhr" title="Uhr angehalten – der Spieler würfelt. Weiter mit „Weiter“.">⏸</span>`
    : "";

  // Vorn nur noch Treffer + Heilung (Kalle, 23.10.2026). Vorher sieben Knöpfe,
  // darunter „💥 selbst getroffen", leicht mit 🎯 zu verwechseln; der Rest
  // (😵 ☠ 🔄 ⚙) wird selten gebraucht und liegt hinter ⋯.
  return `<div class="aktionsleiste">
    ${App.leisteEinstellungen ? leisteEinstellungenHtml() : ""}
    ${!mitAngriff ? "" : App.trefferWahl ? trefferWahlHtml(active) : ""}
    <div class="al-wer">
      ${rundenZaehler(s)}
      <button class="al-name${istNsc && !active.ally ? " feind" : ""}" data-act="zur-aktiven-zeile" title="Zur Zeile springen">${esc(anzeigeName)}</button><span class="al-ist-dran">ist dran</span>
      <span class="al-zustand">${!mitWunden ? "" : st.shaken ? `<span class="tag" style="color:var(--warn);border-color:var(--warn)">😵</span>` : ""}${st.wounds ? `<span class="tag" style="color:var(--bad);border-color:var(--bad)">${st.wounds} 🩸</span>` : ""}</span>
      ${uhr}
      ${naechster
        ? `<span class="al-naechster" title="Kommt als Nächstes dran">danach: <b>${esc(naechster.name)}</b></span>`
        : `<span class="al-naechster">danach: <b>Rundenende</b></span>`}
    </div>
    <div class="al-knoepfe">
      ${mitAngriff && !App.trefferWahl && gegnerzugJetzt(s, active) ? gegnerzugLeisteHtml(active) : ""}
      ${erholen}
      ${mitAngriff ? `<button class="st-btn treffer-knopf${App.trefferWahl === "treffer" ? " on" : ""}" data-act="treffer-wahl" title="${esc(active.name)} trifft jemanden: Ziel und Stärke wählen (Taste Z)">🎯<span class="tk-text"> Treffer</span></button>
      <button class="st-btn treffer-knopf${App.trefferWahl === "heil" ? " on" : ""}" data-act="heil-wahl" title="Jemand wird geheilt: Ziel wählen">🩹<span class="tk-text"> Heilung</span></button>` : ""}
      <span class="al-mehr-huelle"><button class="st-btn${App.leisteMehr ? " on" : ""}" data-act="leiste-mehr" title="Mehr: Angeschlagen, K.O., neue Karte, Kampf-Einstellungen">⋯</button>
      ${/* Schwebt über der Leiste (Bedienbarkeit 25.11.2026): vorher klappten
          hier vier Zeichen ohne Wort (😵 ☠ 🔄 ⚙) IN die Leiste und schoben
          Treffer/Heilung unter der Maus nach links. */ ""}
      ${App.leisteMehr ? `<div class="al-mehr-menue" role="menu">
        <div class="km-kopf"><b>${esc(anzeigeName)}</b></div>
        ${mitWunden ? `
        <button class="km-btn${st.shaken ? " on" : ""}" data-act="st-shaken" data-id="${active.id}">😵 Angeschlagen</button>
        <button class="km-btn${st.out ? " on" : ""}" data-act="st-out" data-id="${active.id}">${st.out ? "☠ Wieder wach" : "☠ K.O."}</button>` : ""}
        <button class="km-btn" data-act="redraw" data-id="${active.id}">🔄 Neue Karte ziehen</button>
        <button class="km-btn${App.leisteEinstellungen ? " on" : ""}" data-act="leiste-einstellungen">⚙ Kampf-Einstellungen</button>
      </div>` : ""}</span>
    </div>
    <div class="al-haupt">${haupt}</div>
  </div>`;
}

// „🎯 Treffer": Wer gerade dran ist, greift an - der SL tippt nur noch das Ziel
// an, statt die Figur in Liste oder Board zu suchen. Jedes Ziel ist eine Zeile
// mit der Stärke direkt daneben (😵 / +1 / +2 / +3): EIN Tipp. Vorher stand die
// Stärke oben, vorgewählt „Erfolg" - wer gleich das Ziel antippte, bekam immer
// nur „angeschlagen" (Kalle, 23.10.2026). Gegner stehen vorn, wenn ein Spieler
// dran ist (und umgekehrt). Ein vom Spieler gemeldetes Ziel ist hervorgehoben.
// Nach dem Treffer schließt die Wahl; mit Shift bleibt sie offen (Flächenschaden).
// „🩹 Heilung" nutzt dieselbe Liste (App.trefferWahl = "heil").
function trefferWahlHtml(active) {
  const s = App.state;
  const heil = App.trefferWahl === "heil";
  const gemeldet = new Set((s.requests || []).filter((r) => r.kind === "attack")
    .map((r) => (r.detail || {}).targetId));
  // Heilen darf auch Ausgeschaltete (wieder wach) und den Aktiven selbst.
  const ziele = s.combatants.filter((c) => !c.benched && (heil || (!(c.status || {}).out && c.id !== active.id)));
  const feind = (c) => c.kind === "npc" && !c.ally;
  const gegner = ziele.filter(feind);
  const freunde = ziele.filter((c) => !feind(c));
  const zeile = (c) => {
    const st = c.status || {};
    const werte = kampfwerteText(c);
    let knoepfe;
    if (heil) {
      // Gleiche Reihenfolge wie apply_heal am Server: wach, Wunde, Angeschlagen.
      const was = st.out ? "☠ wieder wach" : st.wounds ? "−1 🩸" : st.shaken ? "😵 weg" : "";
      knoepfe = `<button type="button" class="tz-stufe heil" data-act="heil-auf" data-id="${c.id}" ${was ? "" : "disabled"}
        title="Heilung (Shift: Auswahl bleibt offen)">🩹 ${was || "gesund"}</button>`;
    } else {
      // SWADE: schon angeschlagen + noch ein Erfolg = 1 Wunde. Der Knopf sagt,
      // was wirklich passiert, damit der SL nicht nachrechnen muss.
      const erst = st.shaken ? "1 🩸" : "😵";
      knoepfe = [0, 1, 2, 3].map((n) => `<button type="button" class="tz-stufe${n ? "" : " erfolg"}" data-act="treffer-auf" data-id="${c.id}" data-n="${n}"
          title="${n ? `+${n} Steigerung: angeschlagen + ${n} ${n === 1 ? "Wunde" : "Wunden"}` : (st.shaken ? "Erfolg: war schon angeschlagen → 1 Wunde" : "Erfolg: angeschlagen")} (Shift: Auswahl bleibt offen)">${n ? `+${n} 🩸` : erst}</button>`).join("")
        + (s.schadenRechnen ? `<button type="button" class="tz-stufe" data-act="treffer-auf" data-id="${c.id}" data-n="s"
          title="Mit dem oben eingetippten Schaden gegen die Robustheit rechnen">🧮</button>` : "");
    }
    return `<div class="treffer-zeile${feind(c) ? " feind" : ""}${gemeldet.has(c.id) && !heil ? " gemeldet" : ""}">
        <span class="tz-name">${esc(c.name)}${st.out ? " ☠" : ""}${st.shaken ? " 😵" : ""}${st.wounds ? ` <span class="treffer-wunden">${st.wounds}🩸</span>` : ""}${werte ? ` <span class="treffer-werte">${werte}</span>` : ""}</span>
        ${knoepfe}</div>`;
  };
  const gruppe = (titel, liste) => liste.length
    ? `<div class="treffer-gruppe"><div class="muted small">${titel}</div>${liste.map(zeile).join("")}</div>` : "";
  const angreiferIstFeind = feind(active);
  return `<div class="al-treffer">
    <div class="row spread" style="align-items:center; margin-bottom:8px">
      <strong>${heil ? "🩹 Wen heilen?" : `🎯 ${esc(active.name)} trifft … wen, wie schlimm?`}</strong>
      <button class="ghost small" data-act="${heil ? "heil-wahl" : "treffer-wahl"}">Schließen</button>
    </div>
    ${heil && freunde.some((c) => c.kind === "player" && ((c.status || {}).out || (c.status || {}).wounds || (c.status || {}).shaken))
      ? `<div class="row" style="margin-bottom:8px"><button type="button" class="ghost good small" data-act="alle-heilen" title="Alle Spieler ganz heil – z. B. am Kampfende">🩹 Alle Spieler ganz heilen</button></div>` : ""}
    ${!heil && s.schadenRechnen ? `<div class="treffer-staerke">
      <label class="treffer-schaden" title="Schadenswurf eintippen, dann beim Ziel 🧮: die App vergleicht mit der Robustheit und rechnet die Steigerungen selbst aus">
        Schaden <input id="treffer-schaden" type="number" min="0" max="99" inputmode="numeric" value="${esc(App.trefferSchaden || "")}" placeholder="z. B. 14"> → beim Ziel 🧮</label></div>` : ""}
    ${angreiferIstFeind || heil
      ? gruppe("Spielerseite", freunde) + gruppe("Gegner", gegner)
      : gruppe("Gegner", gegner) + gruppe("Spielerseite", freunde)}
    ${ziele.length ? "" : `<div class="muted small">Niemand da.</div>`}
  </div>`;
}

// Gegnerzug-Karte (Kalle 02.11.2026): ist ein Gegner dran, steht über der
// Leiste von selbst, was er kann (Angriffs-Zeilen aus den Spielwerten) und wen
// er erreicht - mit Parade/Robustheit und den Stärke-Knöpfen. Ein Tipp trägt
// den Treffer ein, am Handy des Getroffenen steht dann der Gegner als Angreifer.
// „Daneben"/✕ schließt sie für diesen Zug.
function gegnerzugSchluessel(s, active) { return `${s.round}:${active.id}`; }
function gegnerzugJetzt(s, active) {
  return active && active.kind === "npc" && !active.ally && !(active.status || {}).out
    && App.gegnerzugZu !== gegnerzugSchluessel(s, active);
}
// Aus dem Freitext der Spielwerte nur, was beim Angreifen hilft.
function angriffsZeilen(text) {
  const zeilen = String(text || "").split(/\n|;/).map((z) => z.trim()).filter(Boolean);
  return zeilen.filter((z) => /angriff|kämpf|kaempf|schie(ß|ss)|werfen|schaden|waffe|biss|klaue|säbel|schwert|axt|pistole|gewehr|bogen|St\+|\dW\d/i.test(z)).slice(0, 4);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || App.role !== "gm") return;
  const s = App.state;
  const active = s && s.combatants.find((c) => c.id === s.activeId);
  if (t.dataset.act === "gegnerzug-zu" && active) {
    e.preventDefault();
    App.gegnerzugZu = gegnerzugSchluessel(s, active);
    render();
  } else if (t.dataset.act === "gegnerzug-treffer" && active) {
    e.preventDefault();
    App.gegnerzugZu = gegnerzugSchluessel(s, active);
    trefferAuf(t.dataset.id, false, parseInt(t.dataset.n, 10) || 0);
  }
});

// --- Gegnerzug in der Zeile (Vorschlag 1B, Kalle 15.11.2026) ---------------
// Die Karte „X greift an – wen?" lag über der Reihenfolge und verdeckte bei
// 1366×768 die Zeilen 4–9 - bei JEDEM Gegnerzug. Jetzt liegen die vier
// Stärke-Knöpfe schwebend rechts in der Zeile jedes möglichen Ziels (fester
// Platz über Zustand und ⋯, die Zeile ändert ihre Höhe nicht), Angriffswerte
// und „Daneben" stehen in der Leiste unten. Gibt den Angreifer zurück, wenn
// ``c`` gerade ein Ziel ist.
function gegnerzugZiel(c) {
  const s = App.state;
  if (!funktionAn("angriff") || App.trefferWahl || App.kontextMenue && App.kontextMenue.id === c.id) return null;
  const a = s.combatants.find((x) => x.id === s.activeId);
  if (!gegnerzugJetzt(s, a)) return null;
  if (c.benched || (c.status || {}).out || (c.kind === "npc" && !c.ally)) return null;
  return a;
}
function gegnerzugZeileHtml(angreifer, c) {
  const st = c.status || {};
  const art = angriffsArt(angreifer, c);
  const erst = st.shaken ? "1 🩸" : "😵";
  const knoepfe = [0, 1, 2, 3].map((n) => `<button type="button" class="tz-stufe${n ? "" : " erfolg"}" data-act="gegnerzug-treffer" data-id="${c.id}" data-n="${n}"
      title="${esc(angreifer.name)} trifft ${esc(c.name)}: ${n ? `+${n} Steigerung – angeschlagen + ${n} ${n === 1 ? "Wunde" : "Wunden"}` : (st.shaken ? "Erfolg – war schon angeschlagen → 1 Wunde" : "Erfolg – angeschlagen")}">${n ? `+${n}` : erst}</button>`).join("");
  return `<div class="gz-inline${art.art === "weg" ? " gz-weg" : ""}" title="${esc(art.titel || "")}">
    ${art.art === "weg" ? `<span class="gz-inline-weit">zu weit</span>` : ""}${knoepfe}</div>`;
}
function gegnerzugLeisteHtml(angreifer) {
  const zeilen = angriffsZeilen(angreifer.spielwerte);
  return `<span class="gz-leiste" title="${esc(zeilen.join("\n") || "Treffer direkt in der Zeile des Ziels setzen")}">⚔ <b>Treffer in der Zeile</b>${zeilen.length ? ` · <span class="gz-leiste-werte">${esc(zeilen[0])}</span>` : ""}</span>
    <button class="ghost small" data-act="gegnerzug-zu" title="Kein Treffer – Treffer-Knöpfe für diesen Zug ausblenden">✗ Daneben</button>`;
}

// Heilung aus der Liste: ein Schritt nach apply_heal (wach / −1 Wunde / 😵 weg).
function heilAuf(id, offenLassen) {
  const c = (App.state.combatants || []).find((x) => x.id === id);
  if (!c) return;
  gmAction({ type: "apply_heal", id });
  toast(`🩹 ${c.name} geheilt – rückgängig mit ↶`);
  if (!offenLassen) App.trefferWahl = false;
  render();
}

// ``stufe``: 0..3 Steigerungen; "s" = aus dem eingetippten Schaden rechnen;
// weggelassen = vorgewählte Stärke (Tasten 0–3, fürs Antippen im Board).
function trefferAuf(id, offenLassen, stufe) {
  const S = App.state;
  const c = (S.combatants || []).find((x) => x.id === id);
  if (!c) return;
  const st = c.status || {};
  let stg = typeof stufe === "number" ? stufe : (App.trefferSteigerung || 0);
  let zusatz = "";
  // Optional: Schaden eingetippt -> gegen die Robustheit rechnen (SWADE:
  // Schaden >= Robustheit = angeschlagen, je volle 4 darüber eine Steigerung).
  // Nur über 🧮 (bzw. Board-Tipp) - ein Tipp auf +2 meint +2, auch wenn im
  // Feld noch eine Zahl steht.
  const schaden = S.schadenRechnen && (stufe === "s" || stufe === undefined) ? parseInt(App.trefferSchaden, 10) : NaN;
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
  return `<div class="tasten-hilfe-hg" data-act="tasten-hilfe">
    <div class="tasten-hilfe panel" data-act="">
      <div class="row spread" style="align-items:center; margin-bottom:8px">
        <strong>⌨ Tastenkürzel</strong>
        <button class="ghost small" data-act="tasten-hilfe">Schließen</button>
      </div>
      ${tastenTabelleHtml()}
    </div>
  </div>`;
}
// Auch im Kapitel „⌨ Tasten" der 📖 Anleitung (modi.js). Ausgeschaltetes (🎛)
// fehlt - Z/T/H tun dann ja nichts.
function tastenTabelleHtml() {
  const zeile = (tasten, text, f) => f && !funktionAn(f) ? ""
    : `<tr><td>${tasten.map((t) => `<kbd>${t}</kbd>`).join(" ")}</td><td>${text}</td></tr>`;
  return `<table>
        ${zeile(["Leertaste"], "Zug freigeben bzw. bestätigen · am Rundenende: neue Runde austeilen")}
        ${zeile(["Enter"], "wie Leertaste")}
        ${zeile(["W"], "Weiter: Zug beenden ohne Timer")}
        ${zeile(["Z"], "🎯 Treffer: Ziel wählen – wen trifft der Aktive?", "angriff")}
        ${zeile(["0", "1", "2", "3"], "in der Zielwahl: Stärke fürs Antippen im Board (Erfolg / +1 / +2 / +3)", "angriff")}
        ${zeile(["T"], "Der Aktive selbst wird getroffen (angeschlagen bzw. +1 Wunde)", "wunden")}
        ${zeile(["H"], "Der Aktive wird geheilt", "wunden")}
        ${zeile(["Strg", "Klick"], "Figuren sammeln (Board oder Liste), dann gemeinsam ziehen")}
        ${zeile(["Rechtsklick"], "auf Figur (Liste oder Board): Treffer, Heilen, Zustand, Bennies … direkt an der Maus")}
        ${zeile(["Esc"], "Zielwahl schließen · Strg-Auswahl aufheben · dieses Fenster schließen")}
        ${zeile(["?"], "Übersicht der Tastenkürzel")}
      </table>`;
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
    <div class="muted small" style="margin-top:10px">Alle Tastenkürzel: Taste <kbd>?</kbd> ·
      <button type="button" class="linkknopf" data-act="modus-oeffnen">🎛 Ganze Teile an/aus (Treffer, Wunden, Bennies …)</button></div>
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

// SL-Sicht eines verdeckten Namens: 🫥 vorn + gestrichelt. Früher ein
// „🫥 verdeckt"-Abzeichen hinter dem Namen - in der zweispaltigen Liste wurde
// es hinten abgeschnitten, der SL sah nicht mehr, wer verdeckt ist.
function anonName(name) {
  return `<span class="anon-marke" title="Verdeckt: die Spieler sehen statt des Namens nur Unlesbares">🫥</span><span class="anon-name" title="Verdeckt: die Spieler sehen statt des Namens nur Unlesbares">${esc(name)}</span>`;
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
      <div class="name">${gruppe.some((x) => x.anon) ? anonName(name) : esc(name)} <span class="gk-anzahl">×${gruppe.length}</span></div>
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

// Anfragen schweben unter der Kopfleiste (Kalle, 11.11.2026, Vorschlag 4):
// vorher klappte dafür oben links ein eigenes Panel auf und schob Kampfzonen
// und alles darunter weg - mitten im Klick lag dann etwas anderes unter der
// Maus. Jetzt liegt die Karte ÜBER der Seite, nichts rückt.
function renderRequestsPanel() {
  const s = App.state;
  if (!s.requests || !s.requests.length) return "";
  const rows = s.requests.map((r) => {
    const attack = r.kind === "attack";
    const actions = attack
      // Angriff ist reine Meldung: würfeln am Tisch, Ergebnis über das Ziel-Token setzen.
      ? `${(r.detail || {}).targetId ? `<button class="st-btn" data-act="angriff-oeffnen" data-id="${r.id}" title="Angriffs-Fenster öffnen: Daneben, Kein Schaden, Erfolg oder Steigerungen">⚔ Entscheiden</button>` : ""}
         <button class="st-btn on" data-act="req-dismiss" data-id="${r.id}" title="Daneben / erledigt">Erledigt ✓</button>`
      // Beschriftet und groß genug (Bedienbarkeit 15.11.2026, Vorschlag 3):
      // vorher ein roter ✓ mit 30×21 px - rot las sich wie „ablehnen".
      : `<button class="good req-ja" data-act="req-apply" data-id="${r.id}" title="Anfrage übernehmen – wird sofort angewendet">✓ Übernehmen</button>
         <button class="ghost req-nein" data-act="req-dismiss" data-id="${r.id}" title="Anfrage ablehnen">Ablehnen</button>`;
    return `
    <div class="req-item">
      <div class="grow">
        <strong>${esc(r.playerName || r.name)}</strong> <span class="muted small">${esc(r.name)}</span>
        <div>${attack ? "⚔ " : ""}${esc(r.label || r.kind)}</div>
      </div>
      ${actions}
    </div>`;
  }).join("");
  return `<div class="anfragen-schweb" data-sec="requests">
    <div class="as-titel">✋ ${s.requests.length === 1 ? "Anfrage" : `Anfragen (${s.requests.length})`}</div>${rows}</div>`;
}

// Startfläche bei leerem Tisch (Kalle, 14.11.2026, Studio-Runde Vorschlag 4):
// vorher stand hier nur ein grauer Satz, der Rest der Seite war leer – der
// erste Eindruck jedes Abends. Jetzt die drei Schritte, die vor dem ersten
// Austeilen anstehen, je mit einem Knopf. Verschwindet, sobald jemand am Tisch
// ist (dann steht hier die Reihenfolge) – schiebt also mitten im Spiel nichts.
// Nur bis zum ersten Austeilen des Abends - nach „Kampf beenden" mitten im
// Abend wäre „Willkommen am Tisch" fehl am Platz.
function startflaecheNochZeigen(s) {
  if (s.round || s.combatants.some((c) => c.card)) App._schonAusgeteilt = true;
  return !App._schonAusgeteilt;
}
function startflaecheHtml() {
  const s = App.state;
  const spieler = s.players || [];
  const da = spieler.filter((p) => p.connected).length;
  const punkte = Array.from({ length: Math.max(5, spieler.length) }, (_, i) =>
    `<i class="${i < da ? "an" : ""}"></i>`).join("");
  // Bleibt bis zum ersten Austeilen stehen (Bedienbarkeit 15.11.2026, Vorschlag
  // 2) - vorher verschwand sie mit dem ersten Handy, gerade wenn „Kampf
  // vorbereiten" und „Abend starten" noch anstanden. Erledigtes bekommt ein ✓.
  const kaempfe = s.encounters || [];
  const gegner = s.combatants.filter((c) => c.kind === "npc" && !c.ally).length;
  const kampfFertig = gegner > 0 || kaempfe.length > 0;
  const nimmtAuf = typeof Aufn !== "undefined" && !!Aufn.rec;
  const zeile = (sym, titel, text, knopf, extra = "", fertig = false) => `<div class="sf-zeile${fertig ? " fertig" : ""}">
      <div class="sf-sym">${symbolSvg(fertig ? "circle-check" : sym)}</div>
      <div class="sf-text"><div class="sf-titel">${titel}</div><div class="sf-unter">${text}</div>${extra}</div>
      ${knopf}</div>`;
  const zeilen = [
    zeile("qr-code", "Spieler einladen", da ? `${da} ${da === 1 ? "Handy ist" : "Handys sind"} da – weitere per QR-Code.` : "QR-Code zeigen – Handys treten ohne Installation bei.",
      `<button class="ghost sf-knopf" data-act="qr-gross">QR-Code zeigen ${symbolSvg("chevron-right")}</button>`,
      `<div class="sf-handys">${punkte}<span>${da ? `${da} ${da === 1 ? "Handy" : "Handys"} da` : "noch niemand da"}</span></div>`, da > 0),
    zeile("swords", "Kampf vorbereiten",
      gegner ? `${gegner} Gegner am Tisch – oben austeilen.`
        : kaempfe.length ? `${kaempfe.length === 1 ? `„${esc(kaempfe[0].name)}“ ist` : `${kaempfe.length} Kämpfe sind`} bereit – oben ▶ Starten.`
        : "Gegner aus der Bibliothek oder als Text einfügen.",
      `<button class="ghost sf-knopf" data-act="kaempfe-zeigen">${kampfFertig ? "Kämpfe" : "Kampf anlegen"} ${symbolSvg("chevron-right")}</button>`, "", kampfFertig),
    funktionAn("aufnahme") ? zeile("mic", "Abend starten", nimmtAuf ? "Aufnahme läuft – das Protokoll entsteht am Ende von selbst." : "Aufnahme an – das Protokoll entsteht am Ende von selbst.",
      nimmtAuf ? "" : `<button class="ghost sf-knopf" data-act="aufn-abend">Abend starten ${symbolSvg("chevron-right")}</button>`, "", nimmtAuf) : "",
  ].join("");
  return `<div class="startflaeche">
    <div class="sf-kopf"><div class="wortmarke sf-gruss">Willkommen am Tisch</div></div>
    ${zeilen}</div>`;
}

function renderOrderPanel(isGM, gesperrt = false) {
  const s = App.state;
  if (s.combatants.length === 0) {
    // SL: Kampf-Steuerung trotzdem zeigen (Austeilen etc.), Initiative noch leer.
    if (isGM) {
      return section("combat", `Kampf & Initiative · Runde ${s.round}${countdownPille(s.countdown)}`,
        `${renderControlBody()}<hr class="combat-sep">${startflaecheHtml()}`);
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
    return section("combat", `Kampf & Initiative · Runde ${s.round}${countdownPille(s.countdown)}`,
      `${renderControlBody()}<hr class="combat-sep">
       <div class="order-heading row spread"><span>Initiative-Reihenfolge</span>${filter}</div>
       <div class="order"><div class="order-raster" style="--zeilen:${Math.max(1, Math.ceil(zeilenZahl / 2))}">${rows}</div>${benchRows}</div>
       ${startflaecheNochZeigen(s) ? `<hr class="combat-sep">${startflaecheHtml()}` : ""}`);
  }
  // Spieler: Position nur für tischweit AUFGEDECKTE Karten. Verdeckte kommen ohne
  // Nummer in neutraler Reihenfolge nach unten -> verraten die Reihenfolge nicht.
  // Gesperrt (eigene Karte noch zu): alle als „verdeckt" in neutraler Folge
  // zeigen statt eines kleinen Hinweis-Kastens. Vorher wuchs die Liste beim
  // eigenen Aufdecken von einem Zweizeiler auf volle Länge und schob die
  // Kampfzonen darunter um eine halbe Bildschirmhöhe weg (Messung 15.11.2026).
  const openC = gesperrt ? [] : active.filter((c) => c.revealed);
  const hiddenC = active.filter((c) => gesperrt || !c.revealed)
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
  const positionsZeile = gesperrt
    // Nicht noch einmal „aufdecken" sagen (AAA-Runde 17.11.2026, 3): das stand
    // schon auf der Karte und unten im großen Knopf - dreimal dasselbe. Die
    // Zeile bleibt aber stehen (gleiche Höhe), sonst rückt die Liste, sobald
    // nach dem Aufdecken „Du bist 3. von 7" kommt.
    ? `<div class="mein-platz order-locked">Runde ${s.round} · ${openC.length + hiddenC.length} im Kampf</div>`
    : meinPlatz >= 0
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
    // Vor dem ersten Austeilen hat niemand eine Karte - dann nicht zum
    // Antippen auffordern (Test 02.11.2026: stand schon in Runde 0 da).
    const keineKarten = !active.some((c) => c.card);
    body += `<div class="order-divider">${openC.length || gesperrt ? "Noch verdeckt"
      : keineKarten ? "Noch keine Karten – der Spielleiter teilt gleich aus" : "Noch niemand aufgedeckt – tippt eure Karte an!"}</div>`;
    body += zeigenH.map((c) => combatantRow(c, null, false, false)).join("");
  }
  // Sind alle offen, bleibt die Trennzeile als stiller Abschluss stehen: sonst
  // fiel sie beim letzten Aufdecken weg und die Zonen darunter rückten hoch.
  else if (openC.length) body += `<div class="order-divider order-alle-offen">Alle Karten liegen offen</div>`;
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
  // Gegnerzug (Bedienbarkeit 15.11.2026, Vorschlag 1B): Treffer direkt in der
  // Zeile des Ziels statt einer Karte, die die halbe Reihenfolge verdeckte.
  const gzAngreifer = isGM && gegnerzugZiel(c);
  const cls = ["combatant", gzAngreifer ? "gz-ziel" : "",
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
      <button class="ghost small${App.kontextMenue && App.kontextMenue.id === c.id ? " on" : ""}" data-act="zustand-umschalten" data-id="${c.id}" title="Mehr: Treffer, Heilung, Zustände, Bennies, aktiv setzen, verdecken, pausieren, entfernen">⋯</button>
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
  // Eigene Zeile am Handy schlank (Kalle, 25.10.2026): „Du", „WC", Bennies und
  // Wunden stehen schon im Kopf über der Karte; die goldene Kante reicht zum Finden.
  const duTag = "";
  const schlank = !isGM && isOwn;
  // Am Handy jede Zeile in EINER Zeile (Kalle, 11.11.2026, Vorschlag 2): Zone,
  // „WC", „Verbündet" und die Bennies der anderen machten jede Figur zwei
  // Zeilen hoch. Die Zone steht im Zonen-Kasten darunter, Verbündete sind grün,
  // fremde Bennies braucht am Handy niemand. Wunden und Zustände bleiben.
  const handy = !isGM;
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
      <div class="name">${c.anon && !isGM ? `<span class="verdeckt" title="Der Spielleiter hält verborgen, wer das ist">${esc(c.name)}</span>`
        : c.anon ? anonName(c.name) : esc(c.name)}${isGM && c.playerName && c.playerName !== c.name ? ` <span class="spieler-name" title="Gespielt von">🎲 ${esc(c.playerName)}</span>` : ""} ${heldPill}</div>
      ${c.playerName && c.playerName !== c.name && !isGM ? `<div class="muted" style="font-size:0.72rem">🎲 ${esc(c.playerName)}</div>` : ""}
      ${isGM && c.note ? `<div class="combatant-note" title="SL-Notiz">📝 ${esc(c.note)}</div>` : ""}
      <div class="badges">
        ${c.benched
          ? `<span class="tag" style="color:var(--muted);border-color:var(--muted)">⏸ Nicht im Kampf</span>`
          : funktionAn("zonen") && !handy ? `<span class="tag zone-chip z${Zones.zoneOf(c)}">${esc(zoneLabel(Zones.zoneOf(c)))}</span>` : ""}
        ${c.ally && !handy ? `<span class="tag" style="color:var(--good);border-color:var(--good)">🤝 Verbündet</span>` : ""}
        ${duTag}${naechsterTag}${jokerBadge}
        ${c.isWildCard && !handy ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)" title="Wild Card: hält 3 Wunden aus, hat Bennies">★ Wildcard</span>' : ""}
        ${showCard ? (isGM ? talentKurz(c.talents) : talentBadges(c.talents)) : ""}${showCard ? talentTrail(c) : ""} ${hints}
        ${handy ? "" : bennyBadge(c)}
      </div>
      ${/* „✓ erholt"/🪙 stehen nur noch in der Leiste unten: in der Zeile
            machten sie die aktive Figur eine Zeile höher, und alles darunter
            rückte (Kalle, 11.11.2026: beim SL soll nichts mehr rücken). */ ""}
      <div class="status-badges">${schlank ? "" : statusBadges(c, isGM)}</div>
    </div>
    ${gmActions}
    ${gzAngreifer ? gegnerzugZeileHtml(gzAngreifer, c) : ""}
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
  const mitWunden = funktionAn("wunden");
  // Überschriften statt Symbol-Etiketten (Bedienbarkeit 25.11.2026): vorher
  // 17 Knöpfe ohne Ordnung, „Erfolg" hieß in der Treffer-Wahl 😵. Jetzt gleiche
  // Wörter wie dort, und ✕ Entfernen steht abgesetzt, damit es keiner streift.
  const ueber = (t) => `<div class="km-ueber">${t}</div>`;
  const treffer = st.out || !mitWunden ? "" : `${ueber("Treffer – wie schlimm?")}<div class="km-zeile">
      ${[0, 1, 2, 3].map((n) => `<button class="km-btn km-treffer" data-act="km-treffer" data-id="${c.id}" data-n="${n}"
        title="${n ? `Angeschlagen + ${n} Wunde${n > 1 ? "n" : ""}` : "Angeschlagen (bzw. +1 Wunde, wenn schon angeschlagen)"}">${n ? `+${n} 🩸` : st.shaken ? "1 🩸" : "😵"}</button>`).join("")}</div>`;
  const zustand = !mitWunden ? "" : `${ueber("Zustand")}<div class="km-zeile">
      ${b("apply-heal", "🩹 Heilen")}
      ${b("st-shaken", "😵 Angeschlagen", (st.shaken ? "on " : "") + "km-bleibt")}
      ${b("st-out", st.out ? "☠ Wieder wach" : "☠ K.O.", st.out ? "on" : "")}
    </div>`;
  const zustaende = Object.keys(conds).length ? `<div class="km-zeile km-klein">${Object.keys(conds).map((key) =>
      `<button class="km-btn km-bleibt${st[key] ? " on" : ""}" data-act="st-cond" data-id="${c.id}" data-cond="${key}">${esc(conds[key])}</button>`).join("")}</div>` : "";
  const bennies = c.isWildCard && funktionAn("bennies") ? `${ueber("Bennies")}<div class="km-zeile"><span class="km-label">🪙</span>
      ${b("benny-minus", "–", "km-bleibt")}<span class="km-zahl">${rollZahl("kmb-" + c.id, c.bennies || 0)}</span>${b("benny-plus", "+", "km-bleibt")}</div>` : "";
  const zug = `${ueber("Reihenfolge")}<div class="km-zeile">
      ${c.id === App.state.activeId ? "" : b("set-active", "▶ Aktiv setzen")}
      ${c.card && !st.out ? b(c.held ? "intervene" : "hold", c.held ? "⚡ Eingreifen" : "⏸ Abwarten") : ""}
      ${b("redraw", "🔄 Neu ziehen")}
    </div>`;
  const verwalten = `${ueber("Figur")}<div class="km-zeile km-klein">
      ${hatBogen(c) || hatSpielwerte(c) ? b("bogen-ansicht", c.kind === "npc" ? "📜 Spielwerte" : "📜 Bogen") : ""}
      ${b("edit-combatant", "✎ Bearbeiten")}
      ${c.kind === "npc" && !c.ally ? `<button class="km-btn${c.anon ? " on" : ""}" data-act="set-anon" data-id="${c.id}" data-on="${c.anon ? 0 : 1}">${c.anon ? "🫥 Aufdecken" : "👁 Verdecken"}</button>` : ""}
      ${c.kind === "npc" ? b("npc-verstaerkung", "➕ Noch einer", "km-bleibt", "Noch eine Figur wie diese in dieselbe Zone (Werte, Bild, verdeckt) – Verstärkung mitten im Kampf") : ""}
      <button class="km-btn" data-act="bench" data-id="${c.id}" data-on="${c.benched ? 0 : 1}">${c.benched ? "▶️ Wieder rein" : "⏸ Pausieren"}</button>
    </div>
    <div class="km-weg">${b("remove-combatant", "✕ Entfernen", "bad")}</div>`;
  const werte = kampfwerteText(c);
  return `<div class="kontext-menue" style="left:${k.x}px; top:${k.y}px" role="menu">
    <div class="km-kopf"><b class="${c.kind === "npc" && !c.ally ? "km-feind" : ""}">${esc(c.name)}</b>${
      werte ? `<span class="km-werte">${esc(werte)}</span>` : ""}${
      st.wounds && mitWunden ? `<span class="km-werte">🩸 ${st.wounds}</span>` : ""}</div>
    ${treffer}${zustand}${zustaende}${bennies}${zug}
    ${ueber("Effekt mit Runden")}<div class="km-zeile km-effekt">${effektSteuerung(c)}</div>
    ${verwalten}
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
  App._kmZu = { id: App.kontextMenue.id, t: Date.now() };
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
  { key: "encounters", name: "Kämpfe", n: (s) => (s.encounters || []).length, inhalt: () => encounterInhalt() },
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

// Bibliothek-Zeilen (AAA-Runde 17.11.2026, Vorschlag 2). Vorher je Zeile
// „+ Kampf / Bearbeiten / ✕" als Knopfreihe und oben Startzone/Anzahl/verdeckt
// als Formular, das man vor jedem Klick prüfen musste. Jetzt: Avatar, Name,
// Werte-Zeile; „⚔ In den Kampf" bleibt EIN Klick (gemerkte Startzone), das ▾
// daneben öffnet ein schwebendes Fenster für Anzahl/Zone/verdeckt. Bearbeiten
// = Tipp auf den Namen oder ⋯, Löschen nur noch im ⋯ (nicht mehr direkt neben
// „In den Kampf", wo man sich vertippen konnte). Schwebend: nichts rückt.
const BIB_ART = {
  roster: { kampf: "roster-to-combat", edit: "edit-char", del: "delete-char", neu: "new-char", neuText: "Neuer Charakter",
    zone: "rosterzone", zoneAct: "remember-player-zone", zoneWert: () => lastPlayerZone(), form: "charform",
    leer: "Noch keine Charaktere gespeichert.", such: "Charakter suchen …", av: "bib-sp" },
  bestiary: { kampf: "bestiary-to-combat", edit: "bestiary-edit", del: "bestiary-delete", neu: "bestiary-new", neuText: "Neuer Gegner",
    zone: "bestzone", zoneAct: "remember-zone", zoneWert: () => lastNpcZone(), form: "bestiaryform", anzahl: true, anon: true,
    leer: "Noch keine Gegner-Vorlagen.", such: "Gegner suchen …", av: "bib-feind" },
  allies: { kampf: "ally-to-combat", edit: "ally-edit", del: "ally-delete", neu: "ally-new", neuText: "Neuer Verbündeter",
    zone: "allyzone", zoneAct: "remember-ally-zone", zoneWert: () => lastAllyZone(), form: "allyform",
    leer: "Noch keine Verbündeten-Vorlagen.", such: "Verbündeten suchen …", av: "bib-freund" },
};
function bibWerteZeile(r) {
  const sw = String(r.spielwerte || "").split("\n").map((z) => z.trim()).filter(Boolean).join(" · ");
  return sw || kampfwerteText(r) || "";
}
function bibPopHtml(art, r) {
  const k = BIB_ART[art], pop = App.bibPop;
  if (!pop || pop.id !== r.id) return "";
  if (pop.art === "menue") {
    return `<div class="bib-pop bib-pop-menue" role="menu">
      <button type="button" class="km-zeile" data-act="${k.edit}" data-id="${r.id}">${symbolSvg("pencil")} Bearbeiten</button>
      ${art === "roster" && hatBogen(r) ? `<button type="button" class="km-zeile" data-act="bogen-ansicht" data-id="${r.id}" data-quelle="roster">${symbolSvg("scroll-text")} Charakterbogen ansehen</button>` : ""}
      <div class="km-trenner"></div>
      <button type="button" class="km-zeile bib-loeschen" data-act="${k.del}" data-id="${r.id}">🗑 Löschen …</button></div>`;
  }
  return `<div class="bib-pop" role="dialog" aria-label="${esc(r.name)} in den Kampf">
    <div class="bib-pop-titel">${esc(r.name)} in den Kampf</div>
    ${k.anzahl ? `<div class="bib-pop-zeile"><span>Anzahl</span><span class="bib-zahl">
      <button type="button" data-act="bib-anzahl" data-d="-1" aria-label="weniger">−</button>
      <input id="bestcount" type="number" min="1" max="20" value="${App.bibAnzahl || 1}" aria-label="Anzahl">
      <button type="button" data-act="bib-anzahl" data-d="1" aria-label="mehr">+</button></span></div>` : ""}
    <label class="bib-pop-zeile"><span>Startzone</span>
      <select id="${k.zone}" data-act="${k.zoneAct}">${zoneOptions(k.zoneWert())}</select></label>
    ${k.anon ? `<label class="bib-pop-zeile" title="Spieler sehen dann nur einen unlesbaren Namen – du weiterhin den echten"><span>Name verdeckt 🫥</span>
      <span class="es-sch"><input type="checkbox" id="bestanon"${App.bibAnon ? " checked" : ""}><i></i></span></label>` : ""}
    <div class="bib-pop-fuss"><button type="button" class="primary" data-act="${k.kampf}" data-id="${r.id}">${symbolSvg("swords")} Hinzufügen</button></div>
  </div>`;
}
function bibListeHtml(art, list) {
  const k = BIB_ART[art];
  const q = (App.bibSuche || "").trim().toLowerCase();
  const mitSuche = list.length >= 5;
  const gezeigt = mitSuche && q ? list.filter((r) => (r.name + " " + (r.spielwerte || "")).toLowerCase().includes(q)) : list;
  const zeilen = gezeigt.map((r) => {
    const werte = art === "roster" ? "" : bibWerteZeile(r);
    const offen = App.bibPop && App.bibPop.id === r.id;
    const av = `<span class="avatar bib-av ${k.av}${r.image ? " zoomable" : ""}"${r.image ? ` data-act="open-image" data-url="${esc(r.image)}" data-name="${esc(r.name)}" title="Bild groß anzeigen"` : ""}>${r.image ? `<img src="${esc(r.image)}" alt="">` : esc(zoneInitials(r.name))}</span>`;
    return `<div class="bib-zeile roster-item${offen ? " pop-offen" : ""}" data-bib-id="${r.id}">
      ${av}
      <button type="button" class="bib-t" data-act="${k.edit}" data-id="${r.id}" title="Bearbeiten">
        <span class="bib-name">${esc(r.name)}${r.isWildCard ? '<span class="bib-chip wc">Wildcard</span>' : ""}${talentBadges(r.talents)}</span>
        ${werte ? `<small>${esc(werte)}</small>` : ""}</button>
      <span class="bib-split">
        <button type="button" class="bib-kampf" data-act="${k.kampf}" data-id="${r.id}" title="In den Kampf (gemerkte Startzone)">${symbolSvg("swords")} In den Kampf</button><button type="button" class="bib-pfeil${offen && App.bibPop.art === "kampf" ? " on" : ""}" data-act="bib-pop" data-art="kampf" data-id="${r.id}" title="${k.anzahl ? "Anzahl, " : ""}Startzone${k.anon ? ", verdeckt" : ""}" aria-label="Optionen für In den Kampf">▾</button></span>
      <button type="button" class="bib-mehr${offen && App.bibPop.art === "menue" ? " on" : ""}" data-act="bib-pop" data-art="menue" data-id="${r.id}" title="Bearbeiten, Löschen" aria-label="Mehr">⋯</button>
      ${bibPopHtml(art, r)}
    </div>`;
  }).join("") || `<div class="muted small bib-leer">${list.length ? "Nichts gefunden." : k.leer}</div>`;
  return `<div class="bib-werkzeug">
      ${mitSuche ? `<label class="bib-suche">${symbolSvg("search")}<input id="bib-suche" type="text" value="${esc(App.bibSuche || "")}" placeholder="${k.such}" aria-label="Suchen" autocomplete="off"></label>` : `<span class="bib-luecke"></span>`}
      <button type="button" class="bib-neu" data-act="${k.neu}">${symbolSvg("plus")} ${k.neuText}</button>
    </div>
    <div class="bib-liste">${zeilen}</div>
    <div id="${k.form}"></div>`;
}
function rosterInhalt() {
  return `${bibListeHtml("roster", App.state.roster || [])}`;
}

function talentChecklist(selected, prefix) {
  const meta = App.state.talents;
  return Object.keys(meta).map((k) => `
    <label><input type="checkbox" data-talent="${prefix}" value="${k}" ${selected.includes(k) ? "checked" : ""}> ${esc(meta[k].label)}</label>
  `).join("");
}

// Gegner-Bibliothek: Standard-Gegner mit Bild, schnell in den Kampf (wie Roster).
function bestiaryInhalt() {
  return `${bibListeHtml("bestiary", (App.state && App.state.bestiary) || [])}`;
}

// Verbündeten-Bibliothek – wie das Bestiarium, aber Figuren landen auf Spielerseite.
function allyInhalt() {
  return `${bibListeHtml("allies", (App.state && App.state.allies) || [])}`;
}

// Enter im Nachrichtenfeld schickt ab (vorher nur per Knopf).
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && e.target && e.target.id === "msgtext") { e.preventDefault(); sendMessage(); }
});
// Schließt das ▾/⋯-Fenster, ohne neu zu zeichnen (der Server-Stand kommt
// ohnehin). Gibt nichts zurück - darum taugt es vor „||".
function bibPopZu() { if (App.bibPop) { App.bibPop = null; render(); } }
// Bearbeiten-Formular erscheint unter der Liste - bei langen Listen außerhalb
// des Bildes. Danach sanft hinscrollen, sonst sah es aus, als passiere nichts.
function bibFormZeigen(hostId) {
  const h = $(hostId);
  const f = h && h.firstElementChild;
  if (f) requestAnimationFrame(() => f.scrollIntoView({ block: "nearest", behavior: "smooth" }));
}
// Schwebendes Fenster der Bibliothek: Tippen daneben / Esc schließt.
document.addEventListener("click", (e) => {
  // ⋯ der Aktionsleiste: Klick daneben klappt das schwebende Menü zu (es läge
  // sonst über der Reihenfolge). Klicks IM Menü lassen es offen - 😵 an/aus.
  // Über composedPath statt closest: der Klick hat oft schon neu gezeichnet,
  // dann hängt e.target nicht mehr im Dokument (Zonen, Anfrage-Karte).
  if (App.leisteMehr && !e.composedPath().some((n) => n.classList
      && (n.classList.contains("al-mehr-huelle") || n.classList.contains("al-einstellungen")))) {
    setTimeout(() => { App.leisteMehr = false; render(); }, 0);
  }
  if (!e.target.isConnected) return;
  // ⋯ im Beitritt-Panel: nach dem Teilen/WhatsApp oder Klick daneben zu.
  // Erst nach dem Klick zuklappen - sonst verschwände der Menüpunkt, bevor
  // seine eigene Aktion läuft.
  if (App.btMehr && !e.target.closest("[data-act=bt-mehr]")) setTimeout(() => { App.btMehr = false; render(); }, 0);
  if (!App.bibPop) return;
  if (e.target.closest(".bib-pop, [data-act=bib-pop]")) return;
  App.bibPop = null; render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && App.bibPop) { e.stopImmediatePropagation(); App.bibPop = null; render(); }
}, true);
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "bib-suche") { App.bibSuche = e.target.value; render(); }
  else if (e.target && e.target.id === "bestcount") App.bibAnzahl = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
});
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "bestanon") App.bibAnon = e.target.checked;
});

// Begegnungen: gespeicherte Gegner-/Verbündeten-Gruppen, auf einen Schlag einsetzbar.
// --- Kämpfe vorbereiten ------------------------------------------------------
// Der SL baut Kämpfe VORAB zusammen - ohne den laufenden Kampf anzufassen:
// Charaktere mit Startzone, Gegner/Verbündete aus den Bibliotheken mit Anzahl,
// Zone und „verdeckt". Gespielt wird per „▶ Starten" (oder Schnellstart über
// dem Austeilen-Knopf, wenn der Kampf leer ist). Früher ging Speichern nur,
// indem man die Gegner erst in den laufenden Kampf stellte.
function kampfZusammenfassung(e) {
  const gruppen = {};
  (e.members || []).forEach((m) => { const n = grundname(m.name); gruppen[n] = (gruppen[n] || 0) + 1; });
  const npc = Object.entries(gruppen).map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(", ");
  const chars = (e.charaktere || []).map((ch) => ((App.state.roster || []).find((r) => r.id === ch.characterId) || {}).name).filter(Boolean);
  return [chars.length ? `👥 ${chars.join(", ")}` : "", npc ? `⚔ ${npc}` : ""].filter(Boolean).join(" · ");
}

function encounterInhalt() {
  if (App.kampfEntwurf) return kampfBaukastenHtml();
  const list = (App.state && App.state.encounters) || [];
  const imKampf = ((App.state && App.state.combatants) || []).length > 0;
  const items = list.map((e) => `<div class="roster-item kampf-eintrag">
      <div class="grow" style="min-width:0"><strong>${esc(e.name)}</strong>
        <div class="muted small kampf-zeile">${esc(kampfZusammenfassung(e)).slice(0, 140)}</div>
        ${e.note ? `<div class="muted small kampf-zeile">📝 ${esc(e.note)}</div>` : ""}
      </div>
      <button class="small primary" data-act="encounter-start" data-id="${e.id}" title="Einsetzen, Charaktere an ihre Startzone, pausierte Spieler zurückholen und sofort austeilen">▶ Starten</button>
      <button class="ghost small" data-act="encounter-to-combat" data-id="${e.id}" title="Nur dazustellen (z. B. Verstärkung), ohne auszuteilen">+ dazu</button>
      <button class="ghost small" data-act="kb-bearbeiten" data-id="${e.id}" title="Bearbeiten">✎</button>
      <button class="ghost small" data-act="encounter-copy" data-id="${e.id}" title="Kopie anlegen (z. B. als Vorlage für eine Variante)">⎘</button>
      <button class="ghost small bad" data-act="encounter-delete" data-id="${e.id}" title="Löschen">✕</button>
    </div>`).join("") || `<div class="muted small">Noch keine Kämpfe vorbereitet.</div>`;
  return `
    <div class="row" style="margin:6px 0; gap:6px">
      <button class="primary" data-act="kb-neu">➕ Kampf vorbereiten</button>
      <button class="ghost" data-act="kampf-import" title="Kampf, den du unterwegs mit Gemini, ChatGPT & Co. geschrieben hast, einfügen">📋 Aus Text einfügen</button>
      <button class="ghost small" data-act="encounter-save" ${imKampf ? "" : "disabled"} title="${imKampf ? "Den laufenden Kampf (Figuren und Zonen) als vorbereiteten Kampf speichern" : "Gerade steht niemand im Kampf"}">💾 Laufenden Kampf merken</button>
    </div>
    <div class="kampf-ablage muted small" title="Textdatei mit einem Kampf (z. B. von Gemini) hier ablegen">📄 Textdatei hierher ziehen – oder <button type="button" class="linkknopf" data-act="kampf-import-datei">Datei wählen …</button></div>
    <div style="margin-top:8px">${items}</div>`;
}

// Baukasten-Entwurf: übersteht jedes Neuzeichnen (Server-Updates kommen laufend).
function kampfEntwurfAus(e) {
  const roster = (App.state && App.state.roster) || [];
  const zeilen = [];
  (e ? e.members || [] : []).forEach((m) => {
    const name = grundname(m.name);
    const key = `${m.vorlage || name}|${m.ally ? 1 : 0}|${m.zone}|${m.anon ? 1 : 0}`;
    const z = zeilen.find((x) => x.key === key);
    if (z) z.anzahl += 1;
    else zeilen.push({ key, proto: { ...m, name }, anzahl: 1, zone: m.zone, anon: !!m.anon });
  });
  const chars = {};
  roster.forEach((r) => {
    const drin = e && (e.charaktere || []).find((ch) => ch.characterId === r.id);
    // Neu: alle Charaktere dabei (wer fehlt, wird im Spiel entfernt - Stefan).
    chars[r.id] = { dabei: e ? !!drin : true, zone: drin ? drin.zone : lastPlayerZone() };
  });
  return { id: e ? e.id : null, name: e ? e.name : "", note: e ? e.note || "" : "", zeilen, chars };
}

function kampfBaukastenHtml() {
  const E = App.kampfEntwurf;
  const s = App.state;
  const roster = s.roster || [];
  const charZeilen = roster.map((r) => {
    const c = E.chars[r.id] || { dabei: false, zone: lastPlayerZone() };
    return `<div class="kb-zeile kb-char-zeile${c.dabei ? "" : " aus"}">
      <label class="kb-name"><input type="checkbox" data-act="kb-char" data-id="${r.id}" ${c.dabei ? "checked" : ""}> ${esc(r.name)}</label>
      <select data-act="kb-char-zone" data-id="${r.id}" ${c.dabei ? "" : "disabled"}>${zoneOptions(c.zone)}</select>
    </div>`;
  }).join("") || `<div class="muted small">Noch keine Charaktere angelegt.</div>`;
  const npcZeilen = E.zeilen.map((z, i) => `<div class="kb-zeile">
      <span class="kb-name${z.proto.ally ? " verbuendet" : " feind"}">${z.proto.ally ? "🤝 " : ""}${esc(z.proto.name)}</span>
      <span class="kb-anzahl">
        <button type="button" class="st-btn" data-act="kb-anzahl" data-i="${i}" data-d="-1">−</button>
        <b>${z.anzahl}</b>
        <button type="button" class="st-btn" data-act="kb-anzahl" data-i="${i}" data-d="1">+</button>
      </span>
      <select data-act="kb-zone" data-i="${i}">${zoneOptions(z.zone)}</select>
      ${z.proto.ally ? `<span class="kb-anon"></span>` : `<label class="kb-anon" title="Spieler sehen statt des Namens nur Unlesbares"><input type="checkbox" data-act="kb-anon" data-i="${i}" ${z.anon ? "checked" : ""}> verdeckt</label>`}
      <button type="button" class="ghost small bad" data-act="kb-weg" data-i="${i}" title="Zeile entfernen">✕</button>
    </div>`).join("") || `<div class="muted small">Noch keine Gegner – aus der Bibliothek wählen oder gleich hier neu anlegen.</div>`;
  const opt = (liste, praefix) => (liste || []).map((v) => `<option value="${praefix}:${v.id}">${esc(v.name)}</option>`).join("");
  const dazu = `<select data-act="kb-dazu" class="kb-dazu">
      <option value="">+ Gegner / Verbündete aus der Bibliothek …</option>
      ${(s.bestiary || []).length ? `<optgroup label="Gegner">${opt(s.bestiary, "b")}</optgroup>` : ""}
      ${(s.allies || []).length ? `<optgroup label="Verbündete">${opt(s.allies, "a")}</optgroup>` : ""}
    </select>`;
  // Gegner gleich hier neu anlegen (Bedienbarkeit 15.11.2026, Vorschlag 7):
  // bei leerer Bibliothek war die Auswahl oben eine Sackgasse - erst Reiter
  // „Gegner", Typ anlegen, zurück zu „Kämpfe" (~11 Klicks). Landet zugleich in
  // der Bibliothek. Getipptes steht in E.neu (übersteht jedes Neuzeichnen).
  const N = E.neu || {};
  const neuGegner = `<div class="kb-neu-gegner">
      <span class="muted small">oder neu:</span>
      <input id="kbn-name" data-kbn="name" value="${esc(N.name || "")}" placeholder="Name, z. B. Pirat" maxlength="40" autocomplete="off">
      <input id="kbn-anzahl" data-kbn="anzahl" value="${esc(N.anzahl || "1")}" inputmode="numeric" maxlength="2" title="Anzahl" aria-label="Anzahl">
      <input id="kbn-parade" data-kbn="parade" value="${esc(N.parade || "")}" placeholder="Parade" inputmode="numeric" maxlength="3" autocomplete="off">
      <input id="kbn-robustheit" data-kbn="robustheit" value="${esc(N.robustheit || "")}" placeholder="Robustheit" maxlength="8" autocomplete="off">
      <button type="button" class="primary small" data-act="kb-neu-gegner">＋ Dazu</button>
    </div>`;
  // Wer den Kampf schon unterwegs (KI) geschrieben hat, soll ihn nicht
  // abtippen: beim neuen Kampf direkt der Weg zum Einfügen.
  const importTipp = E.id ? "" : `<div class="muted small kb-import-tipp">Schon fertig in Gemini &amp; Co.? <button type="button" class="linkknopf" data-act="kampf-import">📋 Aus Text einfügen</button></div>`;
  return `<div class="kampf-bau">
    ${importTipp}
    <label class="field"><span>Name des Kampfes</span>
      <input id="kb-name" value="${esc(E.name)}" placeholder="z. B. Skree-Überfall" maxlength="60" autocomplete="off"></label>
    <div class="kb-abschnitt">👥 Charaktere <span class="muted small">– Startzone</span></div>
    ${charZeilen}
    <div class="kb-abschnitt">⚔ Gegner &amp; Verbündete</div>
    ${npcZeilen}
    ${dazu}
    ${neuGegner}
    <label class="field" style="margin-top:10px"><span>Notiz (nur SL)</span>
      <input id="kb-notiz" value="${esc(E.note)}" placeholder="z. B. Boss erst in Runde 2 aufdecken" maxlength="300" autocomplete="off"></label>
    <div class="row" style="justify-content:flex-end; gap:6px; margin-top:8px">
      <button type="button" class="ghost" data-act="kb-abbrechen">Abbrechen</button>
      <button type="button" class="primary" data-act="kb-speichern">💾 Speichern</button>
    </div>
  </div>`;
}

// Getipptes im Baukasten sofort in den Entwurf: ein Server-Update zeichnet
// neu und setzte Felder ohne Fokus sonst auf den alten Stand zurück.
document.addEventListener("input", (e) => {
  const E = App.kampfEntwurf, t = e.target;
  if (!E || !t || !t.id) return;
  if (t.id === "kb-name") E.name = t.value;
  else if (t.id === "kb-notiz") E.note = t.value;
  else if (t.dataset && t.dataset.kbn) (E.neu = E.neu || {})[t.dataset.kbn] = t.value;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.dataset && e.target.dataset.kbn) { e.preventDefault(); kampfNeuerGegner(); }
});
// „＋ Dazu": Gegner-Typ in die Bibliothek (gleicher Name = vorhandener Typ)
// und mit Anzahl in den Entwurf.
function kampfNeuerGegner() {
  const E = App.kampfEntwurf;
  if (!E) return;
  const N = E.neu || {};
  const name = (N.name || "").replace(/\s+/g, " ").trim();
  if (!name) { const f = $("kbn-name"); if (f) f.focus(); toast("Erst einen Namen eintragen"); return; }
  const anzahl = Math.max(1, Math.min(30, parseInt(N.anzahl, 10) || 1));
  const bib = App.state.bestiary || [];
  let v = bib.find((b) => (b.name || "").trim().toLowerCase() === name.toLowerCase());
  const werte = { parade: (N.parade || "").trim(), robustheit: (N.robustheit || "").trim(), panzer: "", spielwerte: "" };
  if (!v || werte.parade || werte.robustheit) {
    const id = v ? v.id : `npc-${Math.random().toString(16).slice(2, 10)}`;
    v = { ...(v || {}), id, name: v ? v.name : name, isWildCard: v ? !!v.isWildCard : false, talents: v ? v.talents || [] : [],
      ...(v ? { panzer: v.panzer, spielwerte: v.spielwerte || "" } : {}), parade: werte.parade || (v && v.parade) || "",
      robustheit: werte.robustheit || (v && v.robustheit) || "" };
    gmAction({ type: "bestiary_upsert", id: v.id, name: v.name, isWildCard: v.isWildCard, talents: v.talents,
      gluck: !!v.gluck, grosses_gluck: !!v.grosses_gluck, image: v.image || null,
      parade: v.parade, robustheit: v.robustheit, panzer: v.panzer || "", spielwerte: v.spielwerte || "" });
  }
  const zone = lastNpcZone();
  const key = `${v.id}|0|${zone}|0`;
  const vorhanden = E.zeilen.find((z) => z.key === key);
  if (vorhanden) vorhanden.anzahl += anzahl;
  else E.zeilen.push({ key, anzahl, zone, anon: false,
    proto: { name: v.name, isWildCard: !!v.isWildCard, talents: v.talents || [], gluck: !!v.gluck, grosses_gluck: !!v.grosses_gluck,
             ally: false, image: v.image || null, vorlage: v.id, parade: v.parade, robustheit: v.robustheit, panzer: v.panzer, spielwerte: v.spielwerte || "" } });
  E.neu = {};
  render();
  // Das Feld mit Fokus lässt der Abgleich in Ruhe - darum selbst leeren.
  document.querySelectorAll("[data-kbn]").forEach((f) => { f.value = f.dataset.kbn === "anzahl" ? "1" : ""; });
  const f = $("kbn-name"); if (f) f.focus();
}

function kampfSpeichern() {
  const E = App.kampfEntwurf;
  const members = [];
  E.zeilen.forEach((z) => {
    for (let k = 0; k < z.anzahl; k++) members.push({ ...z.proto, zone: z.zone, anon: z.anon && !z.proto.ally });
  });
  const charaktere = Object.entries(E.chars).filter(([, c]) => c.dabei).map(([id, c]) => ({ characterId: id, zone: c.zone }));
  if (!members.length && !charaktere.length) { hinweis("Der Kampf ist noch leer – Charaktere anhaken oder Gegner hinzufügen."); return; }
  gmAction({ type: "encounter_upsert", id: E.id, name: E.name.trim() || "Kampf", note: E.note.trim(), members, charaktere });
  toast(`⚔ „${E.name.trim() || "Kampf"}" gespeichert`);
  App.kampfEntwurf = null;
  render();
}

// --- Kampf aus Text (Gemini, ChatGPT …) ------------------------------------
// Der SL schreibt den Kampf unterwegs mit einer KI (fertige Anleitung per
// „✨ Anleitung"), schickt sich den Text und fügt ihn am Spielabend ein oder
// zieht die .txt aufs Panel. Gelesen wird auf dem Server (kampf_import.py) -
// die Vorschau zeigt beim Tippen, was erkannt wurde, bevor etwas gespeichert ist.
const KAMPF_TEXT_MAX = 60000;

async function kampfImportVorschau(text) {
  try {
    const r = await fetch("/api/kampf-import/vorschau", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function kampfImportVorschauHtml(v) {
  if (!v) return `<div class="muted small">Vorschau gerade nicht möglich – Verbindung zum Laptop?</div>`;
  const zonen = (App.state && App.state.zones) || [];
  const kaempfe = (v.kaempfe || []).map((k) => {
    const zeilen = k.gruppen.map((g) => {
      const z = zonen[g.zone] || {};
      // Ohne Werte im Text (diktiert: nur Name + Anzahl) sagen, woher sie
      // kommen: aus der gleichnamigen Vorlage - oder eben später.
      const eigene = g.parade != null || g.robustheit != null || g.spielwerte;
      const teile = [`${z.emoji || ""} ${z.label || ""}`.trim(),
        g.isWildCard ? "Wild Card" : "",
        g.parade != null ? `P ${g.parade}` : "", g.robustheit != null ? `R ${g.robustheit}${g.panzer ? ` (${g.panzer})` : ""}` : "",
        g.anon ? "verdeckt" : "",
        ...(g.talents || []).map((t) => ((App.state.talents || {})[t] || {}).label || t),
        g.spielwerte ? "📋 Werte" : "",
        g.inBibliothek && !eigene ? "📚 Werte aus der Bibliothek" : "",
        !g.inBibliothek && !eigene ? "Werte später" : ""].filter(Boolean);
      return `<div class="ki-gruppe"><span class="kb-name${g.ally ? " verbuendet" : " feind"}">${g.ally ? "🤝 " : ""}${esc(g.name)}${g.anzahl > 1 ? ` <b>×${g.anzahl}</b>` : ""}</span>
        <span class="muted small">${esc(teile.join(" · "))}</span></div>`;
    }).join("");
    return `<div class="kb-abschnitt">✅ ${esc(k.name)}</div>${zeilen}${k.note ? `<div class="muted small">📝 ${esc(k.note)}</div>` : ""}`;
  }).join("");
  const warn = (v.warnungen || []).map((w) => `<div class="small ki-warnung">⚠ ${esc(w)}</div>`).join("");
  return (kaempfe || `<div class="muted small">Noch nichts erkannt – jeder Gegner beginnt mit „GEGNER: Name".</div>`) + warn;
}

async function kiAnleitungHolen() {
  try { const r = await fetch("/api/kampf-import/anleitung"); return r.ok ? (await r.json()).text : null; } catch { return null; }
}

async function kiAnleitungKopieren() {
  const text = await kiAnleitungHolen();
  if (!text) { toast("Anleitung gerade nicht abrufbar"); return; }
  try { await navigator.clipboard.writeText(text); toast("✨ Anleitung kopiert – in Gemini einfügen, dann den Kampf beschreiben"); }
  catch { kiAnleitungSpeichern(text); }
}

// Als Datei: zum Weiterschicken aufs Handy (unterwegs ist kein Laptop da).
async function kiAnleitungSpeichern(text) {
  text = text || await kiAnleitungHolen();
  if (!text) { toast("Anleitung gerade nicht abrufbar"); return; }
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "kampf-anleitung-fuer-ki.txt";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Anleitung gespeichert (Downloads)");
}

async function kampfDateiLesen(datei) {
  if (!datei) return null;
  if (datei.size > KAMPF_TEXT_MAX * 4) { hinweis("Die Datei ist zu groß für einen Kampf – ist es die richtige?"); return null; }
  try { return await datei.text(); } catch { hinweis("Die Datei ließ sich nicht lesen."); return null; }
}

function kampfDateiWaehlen() {
  return new Promise((fertig) => {
    const f = document.createElement("input");
    f.type = "file"; f.accept = ".txt,.md,text/plain";
    f.addEventListener("change", async () => fertig(await kampfDateiLesen(f.files && f.files[0])));
    f.click();
  });
}

async function kampfImportDialog(vorgabe = "") {
  const ergebnis = dialog({
    text: "📋 Kampf aus Text einfügen",
    inhalt: `<div class="muted small ki-hilfe">Text aus Gemini, ChatGPT, Mail oder Notiz hineinkopieren.
        Noch keinen? <button type="button" class="linkknopf" data-ki="kopieren">✨ Anleitung für die KI kopieren</button>
        (oder <button type="button" class="linkknopf" data-ki="speichern">als Datei</button> fürs Handy), in der KI einfügen, Kampf beschreiben.
        Ganz kurz geht auch: <i>kampfpirat 3, Chefpirat 1 verdeckt, orks 2</i></div>
      <textarea class="ki-text" maxlength="${KAMPF_TEXT_MAX}" spellcheck="false" placeholder="KAMPF: Überfall der Wolkenpiraten&#10;GEGNER: Wolkenpirat&#10;ANZAHL: 4&#10;ZONE: Nahbereich"></textarea>
      <div class="row" style="justify-content:space-between; gap:6px; margin:4px 0 2px">
        <button type="button" class="ghost small" data-ki="datei">📄 Datei wählen …</button>
        <label class="small ki-bib" title="Neue Gegner als Vorlage anlegen - Parade &amp; Co. trägst du dort später einmal ein"><input type="checkbox" class="ki-bibliothek" checked> Neue Gegner in die Bibliothek</label>
      </div>
      <div class="ki-vorschau"></div>`,
    knoepfe: [{ text: "Abbrechen", wert: null, abbruch: true }, { text: "💾 Als Kampf speichern", art: "primary" }],
    lesen: (box) => ({ text: box.querySelector(".ki-text").value, bibliothek: box.querySelector(".ki-bibliothek").checked }),
  });
  const box = [...document.querySelectorAll(".app-dialog-hg")].pop();
  if (box) {
    box.querySelector(".app-dialog").classList.add("ki-dialog");
    const feld = box.querySelector(".ki-text");
    const vorschau = box.querySelector(".ki-vorschau");
    let warte = null, nr = 0;
    const neu = () => {
      clearTimeout(warte);
      warte = setTimeout(async () => {
        const meins = ++nr;
        if (!feld.value.trim()) { vorschau.innerHTML = ""; return; }
        const v = await kampfImportVorschau(feld.value);
        if (meins !== nr) return;           // schon weitergetippt
        vorschau.innerHTML = kampfImportVorschauHtml(v);
      }, 250);
    };
    feld.addEventListener("input", neu);
    box.addEventListener("click", async (e) => {
      const k = e.target.closest("[data-ki]");
      if (!k) return;
      e.preventDefault();
      if (k.dataset.ki === "kopieren") kiAnleitungKopieren();
      else if (k.dataset.ki === "speichern") kiAnleitungSpeichern();
      else if (k.dataset.ki === "datei") {
        const text = await kampfDateiWaehlen();
        if (text != null) { feld.value = text.slice(0, KAMPF_TEXT_MAX); neu(); }
      }
    });
    if (vorgabe) { feld.value = vorgabe.slice(0, KAMPF_TEXT_MAX); neu(); }
    feld.focus();
  }
  const wahl = await ergebnis;
  if (!wahl) return;
  const v = await kampfImportVorschau(wahl.text);
  const n = v ? (v.kaempfe || []).length : 0;
  if (!n) {
    await hinweis(v ? "Darin steht noch kein Gegner – jeder beginnt mit „GEGNER: Name\"." : "Der Laptop antwortet gerade nicht – bitte gleich nochmal.");
    return kampfImportDialog(wahl.text);   // Text nicht verlieren
  }
  gmAction({ type: "encounter_import", text: wahl.text, bibliothek: wahl.bibliothek });
  toast(n > 1 ? `⚔ ${n} Kämpfe gespeichert` : `⚔ „${v.kaempfe[0].name}" gespeichert`);
  App.kampfEntwurf = null;
  try { localStorage.setItem("bibReiter", "encounters"); } catch { /* egal */ }
  render();
}

// Textdatei aufs Kämpfe-Panel ziehen. Nur über der Ablage abfangen - sonst
// öffnete der Browser die Datei und die App wäre weg.
document.addEventListener("dragover", (e) => {
  const ziel = e.target.closest && e.target.closest(".kampf-ablage");
  if (!ziel) return;
  e.preventDefault();
  ziel.classList.add("drueber");
});
document.addEventListener("dragleave", (e) => {
  const ziel = e.target.closest && e.target.closest(".kampf-ablage");
  if (ziel) ziel.classList.remove("drueber");
});
document.addEventListener("drop", async (e) => {
  const ziel = e.target.closest && e.target.closest(".kampf-ablage");
  if (!ziel) return;
  e.preventDefault();
  ziel.classList.remove("drueber");
  const text = await kampfDateiLesen(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  if (text != null) kampfImportDialog(text);
});

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
  // Empfänger merkt sich App.msgZiel. Vorher sprang die Auswahl bei jedem
  // Server-Update (z. B. gerade verschickt) zurück auf „Alle Spieler" - beim
  // Flüstern hätte die nächste Nachricht dann versehentlich jeder gelesen.
  if (App.msgZiel !== "all" && App.msgZiel !== "beamer" && App.msgZiel !== "mehrere"
      && !s.players.some((p) => p.id === App.msgZiel)) App.msgZiel = "all";
  // Empfänger als Pillen statt Auswahlliste (AAA-Runde 17.11.2026, 5): ein
  // Tipp, und man SIEHT, an wen es geht. Mehrere Spieler antippen = an
  // mehrere flüstern (vorher eigener Listeneintrag „Mehrere …" + Chips).
  const gewaehlt = App.msgZiel === "mehrere" ? App.msgMehrere : new Set([App.msgZiel]);
  const pille = (ziel, inhalt, an, titel) => `<button type="button" class="msg-pille${an ? " an" : ""}" data-act="msg-pille" data-ziel="${esc(ziel)}" aria-pressed="${an}" title="${esc(titel)}">${inhalt}</button>`;
  const pillen = [pille("all", "Alle", App.msgZiel === "all", "An alle Spieler")]
    .concat(s.players.map((p) => pille(p.id, `<span class="msg-av${p.connected ? "" : " weg"}">${esc(zoneInitials(spielerAnzeige(p)))}</span>${esc(spielerAnzeige(p))}`,
      gewaehlt.has(p.id), `Nur ${spielerAnzeige(p)} (flüstern)${p.connected ? "" : " – gerade offline"}. Mehrere antippen = an mehrere.`)))
    .concat(funktionAn("nachrichten") ? [pille("beamer", `${symbolSvg("tv")} TV`, App.msgZiel === "beamer", "Bild groß auf den TV/Beamer")] : [])
    .join("");
  const zielNamen = App.msgZiel === "all" ? "alle" : App.msgZiel === "beamer" ? "den TV"
    : [...gewaehlt].map((id) => spielerAnzeige(s.players.find((p) => p.id === id))).join(", ");
  const platzhalter = App.msgZiel === "all" ? "Nachricht an alle …" : App.msgZiel === "beamer" ? "Text zum Bild auf dem TV …"
    : `Flüstern an ${zielNamen} …`;
  const preview = App.pendingImageUrl
    ? `<div class="msg-vorschau"><img src="${esc(App.pendingImageUrl)}" alt=""><button class="ghost small" data-act="clear-image">Bild entfernen</button></div>`
    : "";
  // Das Panel ist jetzt dauerhaft offen -> nur die letzten drei Nachrichten,
  // sonst waechst die linke Spalte mit jedem verschickten Benny.
  const log = s.messages.filter((m) => m.sender !== "kampf").slice(-3).reverse().map((m) => `
    <div class="msg-log-zeile${m.target === "all" ? "" : " gefluestert"}">${m.ts ? `<time>${zeitKurz(m.ts)}</time>` : ""}
      <span class="msg-log-text"><span class="msg-log-an">${m.target === "all" ? "An alle" : m.target === "beamer" ? "TV" : `An ${[].concat(m.target).map((id) => esc(spielerAnzeige(s.players.find((p) => p.id === id)))).join(", ")}`} ·</span>
        ${m.text ? esc(m.text.replace(/\n/g, " ")) : ""}${m.imageUrl ? ` <img src="${esc(m.imageUrl)}" alt="" class="msg-log-bild" data-act="open-image" data-url="${esc(m.imageUrl)}" title="Groß ansehen">` : ""}${!m.text && !m.imageUrl && m.bennies ? `🪙 +${m.bennies} Benny` : ""}</span>
      <button class="st-btn msg-ib" data-act="nochmal-senden" data-msg="${m.id}" title="Nochmal senden – an den oben gewählten Empfänger" aria-label="Nochmal senden">🔁</button>
      ${m.imageUrl ? `<button class="st-btn msg-ib" data-act="auf-tv" data-url="${esc(m.imageUrl)}" title="Bild groß auf den TV/Beamer" aria-label="Auf den TV">📺</button>` : ""}
    </div>`).join("");

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

  // Startet zugeklappt (Kalle, 25.10.2026): wird nur ab und zu gebraucht und
  // nahm links dauerhaft drei Zeilen. Der SL-Pool steht dafür im Titel.
  // Einmalig zuklappen, auch wenn der Klappzustand schon gemerkt ist (sonst
  // bliebe es bei jedem, der es je offen hatte, offen). Danach gilt wieder,
  // was der SL selbst auf- oder zuklappt.
  if (!App.collapsed._nachrichtZu) {
    App.collapsed.message = true; App.collapsed._nachrichtZu = true;
    // Nur lokal merken - slAnsichtSichern() mitten im Zeichnen könnte die am
    // Laptop gespeicherte SL-Ansicht überschreiben, bevor sie geladen ist.
    try { localStorage.setItem("collapsed", JSON.stringify(App.collapsed)); } catch { /* ignore */ }
  }
  const mitNachricht = funktionAn("nachrichten"), mitBenny = funktionAn("bennies");
  const titel = [mitNachricht ? "✉ Nachricht / Bild" : "", mitBenny ? (mitNachricht ? "Bennies" : "🪙 Bennies") : ""].filter(Boolean).join(" / ");
  const bennyAn = App.msgZiel === "all" ? "alle" : App.msgZiel === "beamer" ? "…" : zielNamen;
  return section("message", `${titel}${mitBenny ? ` <span class="sec-zusatz">· 🪙 Pool ${s.slBennies}</span>` : ""}`, `
    <div class="msg-an"><span class="msg-an-l">An</span>${pillen}</div>
    ${mitNachricht ? `<div class="msg-komp">
      <input id="msgtext" placeholder="${esc(platzhalter)}" enterkeyhint="send" autocomplete="off">
      <label class="msg-rund knopf-label${App.pendingImageUrl ? " on" : ""}" title="Bild anhängen">${symbolSvg("image")}<input type="file" id="msgimage" accept="image/*" data-act="pick-image" style="display:none"></label>
      <button class="msg-rund msg-senden" data-act="send-message" title="Senden (Enter)" aria-label="Senden">${symbolSvg("arrow-up")}</button>
    </div>
    ${preview}` : ""}
    ${mitBenny ? `<div class="msg-benny">
      <span class="msg-muenze" aria-hidden="true"></span><b>Bennies</b>
      <button class="ghost small" data-act="benny-geben"${App.msgZiel === "beamer" ? " disabled" : ""} title="Der gewählte Empfänger (bei „Alle“ jeder) bekommt einen Benny – mit kurzem Hinweis aufs Handy">+1 an ${esc(bennyAn)}</button>
      <span class="msg-pool"><span class="muted small">SL-Pool</span>
        <button class="msg-pm" data-act="sl-benny-minus" aria-label="SL-Pool weniger">−</button><b>${s.slBennies}</b><button class="msg-pm" data-act="sl-benny-plus" aria-label="SL-Pool mehr">+</button></span>
      <button class="msg-rund msg-auffrischen" data-act="benny-refresh" title="Bennies auffrischen: jede Wildcard auf den Startwert (+ Glück-Bonus) – z. B. zu Beginn des Abends. Startwert: ⚙ unten in der Leiste" aria-label="Bennies auffrischen">${symbolSvg("refresh-cw")}</button>
    </div>` : ""}
    ${s.tvImage ? `<div class="row" style="margin-top:8px"><span class="pill good">📺 TV zeigt gerade ein Bild</span><button class="ghost small" data-act="clear-tv">TV-Bild entfernen</button></div>` : ""}
    ${mitNachricht && log ? `<div class="msg-log">${log}<button class="msg-log-leeren" data-act="clear-messages">Verlauf leeren</button></div>` : ""}
    ${mitNachricht ? archivHtml : ""}`, false);
}

// ⏳ Countdown setzen/ändern (Kalle, 23.11.2026). Läuft einer, zuerst die
// schnellen Wege (−1/+1/weg) - „Ändern" erst im zweiten Schritt.
async function countdownDialog() {
  const cd = App.state.countdown;
  if (cd) {
    const w = await dialog({
      text: `⏳ ${cd.text} · ${countdownRest(cd)}`,
      knoepfe: [{ text: "Wegnehmen", wert: "weg", art: "bad" },
                { text: "−1", wert: -1 }, { text: "+1", wert: 1 },
                { text: "Ändern …", wert: "aendern" },
                { text: "Fertig", wert: null, art: "primary", standard: true, abbruch: true }] });
    if (w === "weg") gmAction({ type: "countdown_weg" });
    else if (w === 1 || w === -1) gmAction({ type: "countdown_stellen", delta: w });
    if (w !== "aendern") return;
  }
  const w = await dialog({
    text: "⏳ Countdown für alle",
    inhalt: `<label class="cd-feld">Was passiert?<input class="cd-was" maxlength="40" placeholder="z. B. Schiff bricht" value="${esc(cd ? cd.text : "")}"></label>
      <label class="cd-feld">In wie vielen Runden?<input class="cd-runden" type="number" inputmode="numeric" min="1" max="99" value="${cd && cd.runden ? cd.runden : 3}"></label>`,
    knoepfe: [{ text: "Abbrechen", wert: null, abbruch: true }, { text: cd ? "Übernehmen" : "⏳ Starten", art: "primary", standard: true }],
    lesen: (box) => ({ text: box.querySelector(".cd-was").value.trim(), runden: parseInt(box.querySelector(".cd-runden").value, 10) }),
  });
  if (!w) return;
  if (!(w.runden >= 1 && w.runden <= 99)) { toast("Runden: 1 bis 99"); return; }
  gmAction({ type: "countdown_setzen", text: w.text || "Countdown", runden: w.runden });
}
