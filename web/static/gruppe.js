// Reiter „Gruppe" am Handy (Kalle 28.11.2026): die Mitspieler mit Bild und
// Steckbrief ansehen. Bewusst OHNE Werte, Geld und Notizen („sonst zu
// transparent") – vorher sah man unten im Bogen die kompletten Bögen der
// anderen samt Werten; die sind dafür weg. Den Steckbrief füllt jeder für
// seinen eigenen Charakter selbst aus (Server: steckbrief_setzen).
// Look aus Runde 2 der Vorschläge („zu billo" war Runde 1): Karten mit
// Goldrahmen, Name auf dem Bild, ohne Bild ein Wappen mit Anfangsbuchstaben;
// angetippt eine ganze Seite mit großem Bild und „‹ Zurück" links oben.
// Teil der Client-Logik, klassische <script>-Datei (Reihenfolge in index.html).

const STECKBRIEF_FELDER = [["volk", "Volk", 40], ["satz", "In einem Satz", 140],
  ["aussehen", "Aussehen", 600], ["geschichte", "Geschichte", 2000]];

function gruppeCharakter(c) {
  return (App.state.roster || []).find((r) => r.id === c.characterId) || null;
}
function steckbriefVon(c) {
  const r = gruppeCharakter(c);
  const s = (r && r.steckbrief) || {};
  return Object.fromEntries(STECKBRIEF_FELDER.map(([k]) => [k, String(s[k] || "")]));
}
function gruppeBild(c) {
  const r = gruppeCharakter(c);
  return c.image || (r && r.image) || "";
}
// Die anderen zuerst (nach Name), der eigene Charakter zum Schluss.
function gruppeFiguren() {
  const mine = myCombatant();
  const alle = (App.state.combatants || []).filter((c) => c.kind === "player");
  const andere = alle.filter((c) => !mine || c.id !== mine.id).sort((a, b) => a.name.localeCompare(b.name, "de"));
  return mine ? [...andere, mine] : andere;
}
function gruppeUnterzeile(c, lang) {
  const s = steckbriefVon(c);
  const wer = c.playerName && c.playerName !== c.name ? (lang ? `gespielt von ${esc(c.playerName)}` : esc(c.playerName)) : "";
  return [s.volk ? esc(s.volk) : "", wer].filter(Boolean).join(" · ");
}
function gruppeWappen(c) {
  return `<div class="gr-wappen"><i>${esc((c.name || "?").trim().charAt(0).toUpperCase())}</i></div>`;
}

function gruppeSeiteHtml(mine) {
  const karten = gruppeFiguren().map((c) => {
    const bild = gruppeBild(c);
    const ich = mine && c.id === mine.id;
    return `<button type="button" class="gr-karte" data-act="gruppe-auf" data-id="${c.id}">
      ${bild ? `<img src="${esc(bild)}" alt="" loading="lazy">` : gruppeWappen(c)}
      ${ich ? `<span class="gr-siegel">Ich</span>` : ""}
      <span class="gr-schild"><b>${esc(c.name)}</b>${gruppeUnterzeile(c) ? `<span>${gruppeUnterzeile(c)}</span>` : ""}</span></button>`;
  }).join("");
  return `<div class="gruppe"><h2 class="gr-titel">Die Gruppe</h2><div class="gr-zier"></div>
    <div class="gr-grid">${karten}</div></div>`;
}

// Ganze Seite über allem (außer Nachrichten und Rückfragen).
function gruppeSteckbriefHtml() {
  if (App.role !== "player" || !App.gruppeId || !App.state) return "";
  const c = (App.state.combatants || []).find((x) => x.id === App.gruppeId);
  if (!c) { App.gruppeId = null; App.steckEntwurf = null; return ""; }
  const mine = myCombatant();
  const eigen = !!mine && c.id === mine.id;
  const bild = gruppeBild(c);
  const oben = bild
    ? `<div class="st-held"><img src="${esc(bild)}" alt=""></div>`
    : `<div class="st-held ohne-bild">${gruppeWappen(c)}</div>`;
  const s = steckbriefVon(c);
  const leer = !STECKBRIEF_FELDER.some(([k]) => s[k]);
  let inhalt;
  if (eigen && App.steckEntwurf) {
    const e = App.steckEntwurf;
    inhalt = `<div class="st-form">
      <label class="st-bildwahl ghost">${symbolSvg("camera")} ${bild ? "Bild ändern" : "Bild wählen"}
        <input type="file" accept="image/*" data-act="pick-char-image" data-id="${c.id}" hidden></label>
      ${STECKBRIEF_FELDER.map(([k, name, n]) => `<label class="st-feld"><span>${name}</span>${k === "volk" || k === "satz"
        ? `<input data-steck="${k}" maxlength="${n}" value="${esc(e[k])}">`
        : `<textarea data-steck="${k}" maxlength="${n}" rows="${k === "geschichte" ? 6 : 3}">${esc(e[k])}</textarea>`}</label>`).join("")}
      <div class="st-knoepfe"><button type="button" class="primary" data-act="steck-speichern">✓ Speichern</button>
        <button type="button" class="ghost" data-act="steck-abbrechen">Abbrechen</button></div></div>`;
  } else {
    const absatz = (k, titel) => s[k] ? `<div class="st-abschnitt${k === "geschichte" && s[k].length > 120 ? " initial" : ""}">
        <h4>${titel}</h4><p>${esc(s[k]).replace(/\n/g, "<br>")}</p></div>` : "";
    inhalt = `${s.satz ? `<div class="st-satz">${esc(s.satz)}</div>` : ""}
      ${absatz("aussehen", "Aussehen")}${absatz("geschichte", "Geschichte")}
      ${eigen ? `<div class="st-knoepfe"><button type="button" class="${leer ? "primary" : "ghost"}" data-act="steck-bearbeiten">✎ ${leer ? "Steckbrief ausfüllen" : "Bearbeiten"}</button></div>` : ""}`;
  }
  // Beim Bearbeiten führt „Zurück" erst zurück zum Ansehen (eine Ebene).
  return `<div class="st-seite" role="dialog" aria-label="${esc(c.name)}" data-scroll-merk="steckbrief">
    ${oben}${zurueckKnopf(eigen && App.steckEntwurf ? "steck-abbrechen" : "gruppe-zu")}
    <div class="st-text"><div class="st-name">${esc(c.name)}</div>
      ${gruppeUnterzeile(c, true) ? `<div class="st-unter">${gruppeUnterzeile(c, true)}</div>` : ""}
      <div class="gr-zier"></div>${inhalt}</div></div>`;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "gruppe-auf") {
    App.gruppeId = t.dataset.id; App.steckEntwurf = null; render();
    const s = document.querySelector(".st-seite");
    if (s) s.scrollTop = 0;
  } else if (act === "gruppe-zu") { App.gruppeId = null; App.steckEntwurf = null; render(); }
  else if (act === "steck-bearbeiten") {
    const mine = myCombatant();
    if (mine) { App.steckEntwurf = steckbriefVon(mine); render(); }
  } else if (act === "steck-abbrechen") { App.steckEntwurf = null; render(); }
  else if (act === "steck-speichern") {
    if (App.steckEntwurf) gmAction({ type: "steckbrief_setzen", steckbrief: App.steckEntwurf });
    App.steckEntwurf = null; render();
  }
});
document.addEventListener("input", (e) => {
  const k = e.target.dataset && e.target.dataset.steck;
  if (k && App.steckEntwurf) App.steckEntwurf[k] = e.target.value;
});
