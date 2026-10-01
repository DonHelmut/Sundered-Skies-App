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
