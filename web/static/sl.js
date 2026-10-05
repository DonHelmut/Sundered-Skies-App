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
  // Vorbereitete Kämpfe genau dann anbieten, wenn keiner läuft (Sitzungsbeginn,
  // nach „Kampf abräumen") - im Kampf wäre die Auswahl nur Ballast.
  const kaempfe = s.encounters || [];
  const schnellstart = kaempfe.length && !s.combatants.some((c) => c.kind === "npc")
    ? `<div class="schnellkampf"><span class="muted small">Vorbereitet:</span>
        <select id="schnellkampf">${kaempfe.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select>
        <button class="small primary" data-act="schnellkampf-start" title="Kampf einsetzen, Charaktere an ihre Startzone und austeilen">▶ Starten</button></div>`
    : "";
  return `
    ${cleanupRow}
    ${schnellstart}
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
      ${hatBogen(c) || hatSpielwerte(c) ? b("bogen-ansicht", c.kind === "npc" ? "📜 Spielwerte" : "📜 Bogen") : ""}
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

function rosterInhalt() {
  const s = App.state;
  const items = s.roster.map((r) => `
    <div class="roster-item">
      <div class="grow"><strong>${esc(r.name)}</strong>
        <div class="badges">${r.isWildCard ? '<span class="tag" style="color:var(--gold);border-color:var(--gold)">WC</span>' : ""}${talentBadges(r.talents)}</div>
      </div>
      ${hatBogen(r) ? `<button class="ghost small" data-act="bogen-ansicht" data-id="${r.id}" data-quelle="roster" title="Charakterbogen ansehen">📜</button>` : ""}
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
    <div class="muted small hilfe">Kämpfe vorab zusammenstellen (Charaktere mit Startzone, Gegner und Verbündete aus der Bibliothek) und im Spiel mit EINEM Klick starten. Fehlt ein Spieler, einfach per Rechtsklick entfernen.</div>
    <div class="row" style="margin:6px 0; gap:6px">
      <button class="primary" data-act="kb-neu">➕ Kampf vorbereiten</button>
      <button class="ghost small" data-act="encounter-save" ${imKampf ? "" : "disabled"} title="${imKampf ? "Den laufenden Kampf (Figuren und Zonen) als vorbereiteten Kampf speichern" : "Gerade steht niemand im Kampf"}">💾 Laufenden Kampf merken</button>
    </div>
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
    </div>`).join("") || `<div class="muted small">Noch keine Gegner – unten aus der Bibliothek hinzufügen.</div>`;
  const opt = (liste, praefix) => (liste || []).map((v) => `<option value="${praefix}:${v.id}">${esc(v.name)}</option>`).join("");
  const dazu = `<select data-act="kb-dazu" class="kb-dazu">
      <option value="">+ Gegner / Verbündete aus der Bibliothek …</option>
      ${(s.bestiary || []).length ? `<optgroup label="Gegner">${opt(s.bestiary, "b")}</optgroup>` : ""}
      ${(s.allies || []).length ? `<optgroup label="Verbündete">${opt(s.allies, "a")}</optgroup>` : ""}
    </select>`;
  return `<div class="kampf-bau">
    <label class="field"><span>Name des Kampfes</span>
      <input id="kb-name" value="${esc(E.name)}" placeholder="z. B. Skree-Überfall" maxlength="60" autocomplete="off"></label>
    <div class="kb-abschnitt">👥 Charaktere <span class="muted small">– Startzone</span></div>
    ${charZeilen}
    <div class="kb-abschnitt">⚔ Gegner &amp; Verbündete</div>
    ${npcZeilen}
    ${dazu}
    <label class="field" style="margin-top:10px"><span>Notiz (nur SL)</span>
      <input id="kb-notiz" value="${esc(E.note)}" placeholder="z. B. Boss erst in Runde 2 aufdecken" maxlength="300" autocomplete="off"></label>
    <div class="row" style="justify-content:flex-end; gap:6px; margin-top:8px">
      <button type="button" class="ghost" data-act="kb-abbrechen">Abbrechen</button>
      <button type="button" class="primary" data-act="kb-speichern">💾 Speichern</button>
    </div>
  </div>`;
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
