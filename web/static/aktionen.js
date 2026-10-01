// Aktionen, die an den Server gehen.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

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

// Eigenes Rückseitenbild hochladen (SL). Liegt danach in data/uploads - also
// nur auf diesem Laptop, nie im öffentlichen Repo oder im Download-Paket.
async function uploadRueckseite(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) {
      const j = await res.json();
      gmAction({ type: "set_rueckseite", url: j.url });
      toast("Rückseite gesetzt – gilt für alle Karten ohne Charakterbild");
    } else if (res.status === 413) hinweis("Bild ist zu groß (max. 8 MB).");
    else hinweis("Upload fehlgeschlagen.");
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

// Eigene Kartenrückseite des Spielers hochladen. profil=true: das Bild wird
// sein Charakterbild (Kachel „Profil" ohne Bild) und gleich als Rückseite genommen.
async function uploadFigurRueckseite(file, profil) {
  const mine = myCombatant();
  if (!file || !mine) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) {
      const j = await res.json();
      if (profil) gmActionOrPlayer({ type: "set_image", id: mine.id, url: j.url });
      gmActionOrPlayer({ type: "set_figur_rueckseite", id: mine.id, wert: profil ? "profil" : j.url });
      toast("🂠 Rückseite gesetzt");
    } else if (res.status === 413) hinweis("Bild ist zu groß (max. 8 MB).");
    else hinweis("Upload fehlgeschlagen.");
  } catch { hinweis("Upload fehlgeschlagen."); }
}

// Spieler sucht sich die Rückseite SEINER Karten aus: Standard (die des
// Tisches), sein Charakterbild oder ein eigenes Bild. Eingeklappt, damit die
// Spieleransicht aufgeräumt bleibt; offen als drei kleine Karten zum Antippen.
function rueckseiteWahlHtml(mine) {
  const w = mine.rueckseite || null;
  const eigen = typeof w === "string" && w.startsWith("/uploads/") ? w : null;
  // Ohne eigene Wahl gilt automatisch: Charakterbild, falls vorhanden, sonst Standard.
  const gilt = eigen ? "eigen" : w === "profil" || (!w && mine.image) ? "profil" : "standard";
  const name = { eigen: "Eigenes Bild", profil: "Profil", standard: "Standard" }[gilt];
  const kopf = `<button type="button" class="ghost small rs-wahl-kopf" data-act="rs-wahl-auf">🂠 Kartenrückseite: <b>${name}</b> ${App.rsWahlOffen ? "▴" : "▾"}</button>`;
  if (!App.rsWahlOffen) return `<div class="rs-wahl">${kopf}</div>`;
  const karte = (svg) => `<span class="rs-karte">${svg}</span>`;
  const leer = (text) => `<span class="rs-karte rs-leer">${text}</span>`;
  const datei = (profil) => `<input type="file" accept="image/*" data-act="pick-figur-rueckseite"${profil ? ' data-profil="1"' : ""} style="display:none">`;
  const std = `<button type="button" class="rs-kachel${gilt === "standard" ? " on" : ""}" data-act="figur-rueckseite" data-wert="standard">
      ${karte(Cards.renderBackSVG(null, "standard"))}<span>Standard</span></button>`;
  // Profil ohne Charakterbild: Antippen lädt eines hoch (wird auch das Avatar-Bild).
  const prof = mine.image
    ? `<button type="button" class="rs-kachel${gilt === "profil" ? " on" : ""}" data-act="figur-rueckseite" data-wert="profil">
        ${karte(Cards.renderBackSVG(mine.image, "profil"))}<span>Profil</span></button>`
    : `<label class="rs-kachel">${leer("📷<br>Bild<br>wählen")}<span>Profil</span>${datei(true)}</label>`;
  const eig = eigen
    ? `<button type="button" class="rs-kachel${gilt === "eigen" ? " on" : ""}" data-act="figur-rueckseite" data-wert="${esc(eigen)}">
        ${karte(Cards.renderBackSVG(null, eigen))}<span>Eigenes</span></button>`
    : `<label class="rs-kachel">${leer("🖼<br>Bild<br>hochladen")}<span>Eigenes</span>${datei(false)}</label>`;
  const neu = eigen ? `<label class="ghost small rs-neu">🖼 anderes Bild${datei(false)}</label>` : "";
  return `<div class="rs-wahl offen">${kopf}<div class="rs-kacheln">${std}${prof}${eig}</div>${neu}</div>`;
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
