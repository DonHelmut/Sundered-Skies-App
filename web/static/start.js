// Status, Skins, Beitritts-Info – und der Start: läuft zuletzt, weil er
// Funktionen aus allen anderen Dateien aufruft.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

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
// Kurzname unter dem Farbkreis im Einstellungen-Blatt (passt unter 44 px).
const SKIN_KURZ = {
  sand: "Sand", skies: "Giftnebel", blood: "Blut", dark: "Dunkel",
  glutstein: "Glut", nebelmeer: "Nebel", pergament: "Hell",
};
function applySkin(skin) {
  if (!SKINS.includes(skin)) skin = "pergament";
  App.skin = skin;
  document.body.classList.remove(...SKINS.map((s) => "theme-" + s));
  document.body.classList.add("theme-" + skin);
  localStorage.setItem("skin", skin);
  slAnsichtSichern();
  const box = $("skins");
  if (box) box.querySelectorAll(".skin-dot, .es-farbe").forEach((d) => d.classList.toggle(d.classList.contains("es-farbe") ? "an" : "active", d.dataset.skin === skin));
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

// SL-⚙ als aufgeräumtes Menü (Kalle, Durchleuchtung 19.11.2026, Vorschlag 2):
// gleiche Bausteine wie das Einstellungen-Blatt am Handy (es-*), nur als
// schwebendes Fenster unter dem Zahnrad. Vorher eine enge Kiste mit
// Farbpunkten ohne Namen, drei kleinen Rückseiten-Knöpfen und einem
// 🐈-Knöpfchen, das man nicht als Mimi-Schalter erkannte.
function slMenueHtml() {
  const pfeil = symbolSvg("chevron-right");
  const rs = (App.state && App.state.rueckseiteBild) || null;
  const eigen = rs && rs !== "gruen" ? rs : null;
  const kachel = (on, inhalt, wort, attr, tag = "button") =>
    `<${tag} type="button" class="sl-rs-kachel${on ? " on" : ""}"${attr}>${inhalt}<span>${wort}</span>${tag === "label"
      ? `<input type="file" accept="image/*" data-act="pick-rueckseite" style="display:none">` : ""}</${tag}>`;
  const reveal = revealSetting();
  const farben = SKINS.map((k) => `<button type="button" class="es-farbe${App.skin === k ? " an" : ""}" data-skin="${k}" title="${SKIN_NAMES[k]}">
      <i class="skin-${k}"></i><span>${SKIN_KURZ[k]}</span></button>`).join("");
  let mimiAn = false;
  try { mimiAn = localStorage.getItem("mimi-on") === "1"; } catch { /* egal */ }
  return `<div class="es-kopf"><h3>Ansicht</h3><button type="button" class="es-zu" data-act="einst-zu" aria-label="Schließen">✕</button></div>
    <div class="es-gruppe">Karten für alle</div>
    <div class="es-karte">
      <div class="sl-rs">
        ${kachel(!rs, `<img class="sl-rs-k" src="/static/rueckseite.svg" alt="">`, "Standard", ` data-act="rueckseite-standard" title="Mitgeliefertes Standardbild"`)}
        ${kachel(rs === "gruen", `<i class="sl-rs-k gruen"></i>`, "Grün", ` data-act="rueckseite-gruen" title="Schlichte grüne Rückseite ohne Bild"`)}
        ${kachel(!!eigen, eigen ? `<img class="sl-rs-k" src="${esc(eigen)}" alt="">` : `<i class="sl-rs-k leer">${symbolSvg("image")}</i>`,
          eigen ? "Eigenes · ändern" : "Eigenes Bild", ` title="Eigenes Bild hochladen – bleibt nur auf diesem Laptop (Ordner data)"`, "label")}
      </div>
      <label class="es-zeile"><span class="es-t">Aufdecken</span>
        <select class="es-select" aria-label="Aufdecken">${REVEALS.map((r) =>
          `<option value="${r}"${r === reveal ? " selected" : ""}>${REVEAL_NAMES[r]}</option>`).join("")}</select></label>
      <details class="es-zeile es-joker joker-pick" data-merk="einst-joker"${App.offeneUnter.has("einst-joker") ? " open" : ""}>
        <summary><span class="es-t">Joker-Stile</span><span class="es-wert es-jokerzahl">${jokerZahlText()}</span></summary>
        <div class="joker-checks">${Cards.JOKER_STILE.map((st) =>
          `<label><input type="checkbox" data-joker="${st}"${jokerAuswahlLaden().includes(st) ? " checked" : ""}> ${Cards.JOKER_NAMEN[st]}</label>`).join("")}</div>
      </details>
    </div>
    <div class="es-gruppe">Farbe der App</div>
    <div class="es-karte"><div class="es-farben">${farben}</div></div>
    <div class="es-gruppe">Am Tisch</div>
    <div class="es-karte">
      ${einstSchalter("mimi-schalter", mimiAn, "Mimi", "Die Katze läuft unten am Rand")}
      <button type="button" class="es-zeile es-link" data-act="qr-gross">${symbolSvg("qr-code")}<span class="es-t">QR-Code groß zeigen<small>Für Spieler, die noch fehlen</small></span>${pfeil}</button>
    </div>`;
}

function mountSkins() {
  // Aufgeräumt: Skins + Mimi liegen hinter einem ⚙-Knopf (eingeklappt).
  const bar = document.createElement("div");
  bar.id = "skinbar";
  const gear = document.createElement("button");
  gear.id = "skin-gear";
  gear.type = "button";
  gear.innerHTML = symbolSvg("settings");   // Linien-Symbol (symbole.js)
  gear.title = "Ansicht: Skins & Mimi";
  gear.addEventListener("click", () => bar.classList.toggle("open"));
  const box = document.createElement("div");
  box.id = "skins";
  box.className = "skins skin-menu";
  // „QR-Code zeigen" für JEDES Gerät: wer schon mitspielt, hält sein Handy
  // hin und der Nächste scannt davon - statt dass alle den Laptop abfilmen.
  // #spieler-menue füllt render() (Ton, Rückseite, Bereiche, Verlassen).
  box.innerHTML = `<div id="spieler-menue"></div><button type="button" class="qr-teilen-knopf" data-act="qr-gross">📱 QR-Code für Mitspieler zeigen</button><button type="button" class="qr-teilen-knopf nur-handy" data-act="als-app">📲 Als App auf den Startbildschirm</button>` +
    SKINS.map((s) => `<button class="skin-dot skin-${s}" data-skin="${s}" title="${SKIN_NAMES[s]}"></button>`).join("") +
    `<div class="reveal-pick">
       <div class="muted small" style="margin-bottom:4px">Karten aufdecken</div>
       <select id="revealsel">${REVEALS.map((r) =>
         `<option value="${r}"${r === revealSetting() ? " selected" : ""}>${REVEAL_NAMES[r]}</option>`).join("")}</select>
     </div>
     <div class="rueckseite-pick nur-sl">
       <div class="muted small" style="margin-bottom:4px">Kartenrückseite (für alle)</div>
       <label class="knopf-klein" title="Eigenes Bild hochladen – bleibt nur auf diesem Laptop (Ordner data)">🖼 Bild wählen
         <input type="file" accept="image/*" data-act="pick-rueckseite" style="display:none"></label>
       <button type="button" class="knopf-klein" data-act="rueckseite-standard" title="Mitgeliefertes Standardbild">Standard</button>
       <button type="button" class="knopf-klein" data-act="rueckseite-gruen" title="Schlichte grüne Rückseite ohne Bild">Grün</button>
     </div>
     <details class="joker-pick">
       <summary>🃏 Joker-Stile <span class="muted small" id="jokerzahl">${jokerZahlText()}</span></summary>
       <div class="joker-checks">${Cards.JOKER_STILE.map((s) =>
         `<label><input type="checkbox" data-joker="${s}"${jokerAuswahlLaden().includes(s) ? " checked" : ""}> ${Cards.JOKER_NAMEN[s]}</label>`).join("")}</div>
     </details>`;
  // Hintergrund des Einstellungen-Blatts (Handy): Tippen daneben schließt.
  const hg = document.createElement("div");
  hg.className = "einst-hg";
  hg.addEventListener("click", () => bar.classList.remove("open"));
  box.addEventListener("click", (e) => {
    const b = e.target.closest(".skin-dot, .es-farbe");
    if (b) applySkin(b.dataset.skin);
    if (e.target.closest("[data-act=einst-zu]")) bar.classList.remove("open");
  });
  box.addEventListener("change", (e) => {
    if (e.target && e.target.dataset && e.target.dataset.joker) {
      // Nur die Häkchen-Gruppe, in der getippt wurde: am Handy stehen sie
      // zweimal im Menü (alte Kiste ausgeblendet + Einstellungen-Blatt).
      const gruppe = e.target.closest(".joker-checks") || box;
      const liste = [...gruppe.querySelectorAll("input[data-joker]:checked")].map((i) => i.dataset.joker);
      // Mindestens einer bleibt an – sonst gaebe es keinen Joker-Stil mehr.
      if (!liste.length) { e.target.checked = true; return; }
      try { localStorage.setItem("jokerStile", JSON.stringify(liste)); } catch { /* ignore */ }
      slAnsichtSichern();
      Cards.setJokerAuswahl(liste);
      box.querySelectorAll("#jokerzahl, .es-jokerzahl").forEach((z) => { z.textContent = jokerZahlText(); });
      box.querySelectorAll("input[data-joker]").forEach((i) => { i.checked = liste.includes(i.dataset.joker); });
      if (App.state) render();
      return;
    }
    // Mimi-Schalter im SL-Menü: schaltet über ihren eigenen (versteckten) Knopf,
    // so bleibt alles, was mimi.js beim An/Aus tut, an einer Stelle.
    if (e.target && e.target.dataset && e.target.dataset.act === "mimi-schalter") {
      const t = document.getElementById("mimi-toggle");
      if (t) t.click();
      return;
    }
    if (e.target && (e.target.id === "revealsel" || e.target.classList.contains("es-select"))) {
      try { localStorage.setItem("reveal", e.target.value); } catch { /* ignore */ }
      slAnsichtSichern();
      _revealPick.clear();
      if (App.state) render();
    }
  });
  bar.appendChild(gear);
  bar.appendChild(hg);
  bar.appendChild(box);
  document.body.appendChild(bar);
  // Klick außerhalb schließt das Menü.
  document.addEventListener("click", (e) => {
    // Nicht mehr im Dokument = der Klick hat das Spieler-Menü neu zeichnen
    // lassen (▲▼, Rückseite) - das war ein Klick IM Menü, nicht daneben.
    if (bar.classList.contains("open") && e.target.isConnected && !bar.contains(e.target)) bar.classList.remove("open");
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
  startHinweiseZeigen(info);
}).catch(() => {});

// Warnungen vom Start (Spielstand in OneDrive, schreibgeschützter Ordner …).
// Standen bis 2.0.5 im schwarzen Fenster, das es nicht mehr gibt. Einmal pro
// Fenster reicht - sonst kommt die Frage bei jedem Neuladen wieder.
function startHinweiseZeigen(info) {
  const liste = (info && info.startHinweise) || [];
  if (!liste.length) return;
  try { if (sessionStorage.getItem("startHinweise") === "1") return; sessionStorage.setItem("startHinweise", "1"); } catch { /* ignore */ }
  hinweis(liste.join("\n\n"));
}

// Die Adressliste alle 2 Minuten auffrischen: wechselt der Laptop das WLAN,
// kennen die Handys sonst nur die alte Adresse und finden ihn nie wieder.
setInterval(() => {
  fetch("/api/info", { cache: "no-store" }).then((r) => r.json()).then((info) => {
    App._info = info;
    merkeServerAdressen(info);
  }).catch(() => { /* offline - der Reconnect kuemmert sich */ });
}, 120000);

// --- „Neu in 2.0" -------------------------------------------------------------
// Einmal nach dem großen Update zeigen, was dazugekommen ist (Kalle,
// 04.11.2026) - SL und Handy je mit eigener Liste. Wer die App zum ersten Mal
// öffnet, bekommt nichts: für ihn ist alles neu, die Karte wäre nur im Weg.
// Ob jemand die App schon kannte, muss VOR dem Verbinden feststehen (danach
// stehen playerId & Co. sowieso im Speicher). ?neu=1 zeigt sie zum Ansehen.
const NEU_STAND = "2.0";
const NEU_FRUEHER_GENUTZT = !!App.myPlayerId || !ansichtFehlteBeimStart.has("skin");
const NEU_SL = [
  ["🌙", "Abend starten", "Fortsetzen, Spieler zurückholen und austeilen in einem Klick"],
  ["⚔", "Gegnerzug-Karte", "Angriff des aktiven Gegners, Ziele mit Parade, Ergebnis per Tipp"],
  ["🎙", "Aufnahme → Protokoll", "Mitschrift läuft lokal, Sprecher werden selbst erkannt"],
  ["📜", "Protokolle & „Was bisher geschah“", "freigeben, wann du willst – die Handys lesen mit"],
  ["📋", "Kämpfe vorbereiten", "Gegner mit Spickzettel, Anzahl, Zone und verdeckt"],
];
const NEU_HANDY = [
  ["📝", "Notizen", "mit Themen, Haken, Suche – und 👥 Notizen für die ganze Gruppe"],
  ["⚔", "Angreifen", "Ziel antippen, der Spielleiter sagt dir das Ergebnis"],
  ["🩸", "Treffer-Meldung", "du siehst sofort, was dich erwischt hat und was es kostet"],
  ["📖", "Regeln", "die wichtigsten Proben und Zustände als Spickzettel"],
  ["📜", "Protokolle", "jeden Spielabend als Geschichte nachlesen"],
];
function neuigkeitenZeigen() {
  if (App._neuGezeigt || !App.role || App.role === "tv") return;
  const ansehen = new URLSearchParams(location.search).has("neu");
  let gesehen = null;
  try { gesehen = localStorage.getItem("neuGesehen"); } catch { /* egal */ }
  if (!ansehen && (parseInt(ASSET_VERSION, 10) < 2 || gesehen === NEU_STAND)) return;
  App._neuGezeigt = true;
  try { localStorage.setItem("neuGesehen", NEU_STAND); } catch { /* egal */ }
  if (!ansehen && !NEU_FRUEHER_GENUTZT) return;
  const punkte = App.role === "gm" ? NEU_SL : NEU_HANDY;
  dialog({
    text: `✨ Neu in Sundered Skies Initiative ${NEU_STAND}`,
    inhalt: `<ul class="neu-liste">${punkte.map(([icon, titel, satz]) =>
      `<li><span class="neu-icon">${icon}</span><span><b>${esc(titel)}</b><br><span class="muted">${esc(satz)}</span></span></li>`).join("")}</ul>`,
    knoepfe: [{ text: "Los geht's", art: "primary", abbruch: true, standard: true }],
  });
}

connect();

// Papier-Muster der Karten schon in einer ruhigen Sekunde bauen, nicht erst
// beim ersten Austeilen: das kostete am Handy (4× gedrosselt) ~35 ms genau in
// dem Moment, in dem die Karten einfliegen (Komplett-Test 04.11.2026).
try {
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => {
    try { ensureGlobalDefs(); } catch { /* egal - dann eben beim Austeilen */ }
  });
} catch { /* egal */ }
