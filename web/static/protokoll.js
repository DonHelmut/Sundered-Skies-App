// Spielabend-Protokolle: der SL fügt das fertige Protokoll ein (aus Claude,
// Prompt kommt aus dem Aufnahme-Panel) und gibt es frei, wann ER will. Die
// Spieler lesen es am Handy hinter einem eigenen 📜 neben dem ⚙ (Kalle,
// 31.10.2026: „eigenes Protokoll-Zeichen wie die Einstellungen, zum Aufklappen").
// Teil der Client-Logik (Liste der Dateien oben in app.js). Lädt nach
// aktionen.js, vor start.js – beim Laden läuft hier nichts, was später kommt.
//
// Im Zustand stehen nur Titel und Stand, der Text kommt einzeln über
// /api/protokoll/<id> (1–2 Seiten je Abend gingen sonst mit JEDEM Update an
// jedes Handy). Gemerkt pro Gerät: welcher Stand schon gelesen ist (Punkt am 📜).

const Prot = {
  texte: {},            // id -> { stand, text, name, datum }
  laedt: {},            // id -> Stand, der gerade geholt wird
  offen: false,         // Lesefenster (Spieler und SL-Vorschau)
  auf: new Set(),       // aufgeklappte Abende im Lesefenster
  entwurf: null,        // SL: { id|null, name, text } im Einfüge-Fenster
};

function protokollListe() {
  return (App.state && App.state.protokolle) || [];
}

// Text holen, wenn er fehlt oder sich geändert hat (SL hat nachgebessert).
function protokollText(p) {
  const da = Prot.texte[p.id];
  if (da && da.stand === p.stand) return da;
  if (Prot.laedt[p.id] !== p.stand) {
    Prot.laedt[p.id] = p.stand;
    fetch(`/api/protokoll/${encodeURIComponent(p.id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { Prot.texte[p.id] = d; render(); } })
      .catch(() => { /* offline - beim nächsten Zeichnen neu versuchen */ })
      .finally(() => { delete Prot.laedt[p.id]; });
  }
  return da || null;
}

function protokollDatum(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

// Claude schreibt Markdown (Überschriften, Fett, Listen). Ein kleiner,
// sicherer Umsetzer: erst ALLES escapen, dann nur diese Formen erkennen –
// fremdes HTML im eingefügten Text wird so nie ausgeführt.
function protokollHtml(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
  const raus = [];
  let absatz = [], liste = null;
  const absatzZu = () => { if (absatz.length) raus.push(`<p>${absatz.join("<br>")}</p>`); absatz = []; };
  const listeZu = () => { if (liste) raus.push(`<${liste.tag}>${liste.punkte.join("")}</${liste.tag}>`); liste = null; };
  String(text || "").split("\n").forEach((roh) => {
    const z = roh.trim();
    let m;
    if (!z) { absatzZu(); listeZu(); return; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(z))) {
      absatzZu(); listeZu();
      raus.push(`<div class="pt-h${Math.min(m[1].length, 3)}">${inline(m[2].replace(/#+$/, "").trim())}</div>`);
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(z)) {
      absatzZu(); listeZu(); raus.push("<hr>");
    } else if ((m = /^[-*•]\s+(.*)$/.exec(z)) || (m = /^\d+[.)]\s+(.*)$/.exec(z))) {
      absatzZu();
      const tag = /^\d/.test(z) ? "ol" : "ul";
      if (liste && liste.tag !== tag) listeZu();
      if (!liste) liste = { tag, punkte: [] };
      liste.punkte.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^>\s?(.*)$/.exec(z))) {
      absatzZu(); listeZu(); raus.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else {
      listeZu(); absatz.push(inline(z));
    }
  });
  absatzZu(); listeZu();
  return raus.join("");
}

// --- Spieler: 📜 neben dem ⚙ ---------------------------------------------------

function protokollGelesen() {
  try { return Number(localStorage.getItem("protokollGelesen") || 0); } catch { return 0; }
}
function protokollNeuster() {
  return protokollListe().reduce((m, p) => Math.max(m, p.stand || 0), 0);
}

const protKnopf = document.createElement("button");
protKnopf.id = "protokoll-knopf";
protKnopf.type = "button";
protKnopf.textContent = "📜";
protKnopf.title = "Protokolle der Spielabende";
protKnopf.hidden = true;
protKnopf.addEventListener("click", (e) => {
  e.stopPropagation();
  Prot.offen = !Prot.offen;
  if (Prot.offen) protokollOeffnen();
  render();
});

function protokollOeffnen() {
  // Beim ersten Öffnen den neuesten Abend aufklappen.
  const erst = protokollListe()[0];
  if (erst && !Prot.auf.size) Prot.auf.add(erst.id);
  try { localStorage.setItem("protokollGelesen", String(protokollNeuster())); } catch { /* privates Fenster */ }
}

// Von render() nach jedem Zeichnen aufgerufen.
function protokollKnopfAuffrischen() {
  // Gleich hinter dem ⚙ einhängen (die Leiste läuft von rechts nach links).
  // Erst hier: das ⚙ legt start.js an, das NACH dieser Datei lädt.
  const gear = document.getElementById("skin-gear");
  if (!protKnopf.isConnected && gear) gear.after(protKnopf);
  const zeigen = App.role === "player" && protokollListe().length > 0;
  protKnopf.hidden = !zeigen;
  if (!zeigen && App.role === "player") Prot.offen = false;
  // Fenster offen = gelesen; sonst der Punkt, sobald etwas neu freigegeben ist.
  if (zeigen && Prot.offen && protokollNeuster() > protokollGelesen()) protokollOeffnen();
  protKnopf.classList.toggle("neu", zeigen && !Prot.offen && protokollNeuster() > protokollGelesen());
  protKnopf.classList.toggle("on", Prot.offen);
}

function protokollLeseHtml() {
  const liste = protokollListe().filter((p) => App.role === "player" || p.freigegeben || Prot.auf.has(p.id));
  const abende = liste.map((p) => {
    const auf = Prot.auf.has(p.id);
    const t = auf ? protokollText(p) : null;
    const inhalt = !auf ? "" : t ? `<div class="pt-text">${protokollHtml(t.text)}</div>` : `<div class="muted small pt-text">Lädt …</div>`;
    return `<div class="pt-abend${auf ? " auf" : ""}">
      <button type="button" class="pt-kopf" data-act="prot-auf" data-id="${esc(p.id)}">
        <span class="pt-name">${esc(p.name)}</span>
        <span class="pt-datum">${protokollDatum(p.datum)}</span><span class="pt-pfeil">▸</span></button>
      ${inhalt}</div>`;
  }).join("");
  return `<div class="protokoll-hg" data-act="prot-zu">
    <div class="protokoll-fenster panel" data-act="" data-scroll-merk="protokoll">
      <div class="pt-titelzeile"><strong>📜 Protokolle</strong>
        <button class="ghost small" data-act="prot-zu">Schließen</button></div>
      ${abende || `<div class="muted small">Noch nichts freigegeben.</div>`}
    </div></div>`;
}

// --- SL: Panel + Einfüge-Fenster -----------------------------------------------

function renderProtokollPanel() {
  const zeilen = protokollListe().map((p) => `<div class="pt-zeile">
      <div class="pt-zeile-name"><b>${esc(p.name)}</b>
        <span class="muted small">${protokollDatum(p.datum)}</span>
        ${p.freigegeben ? `<span class="pill good pt-pill" title="Die Spieler sehen es unter 📜">👁 für Spieler</span>`
                        : `<span class="pill pt-pill" title="Nur hier am Laptop">nur du</span>`}</div>
      <div class="row tight">
        <button class="${p.freigegeben ? "ghost" : "primary"} small" data-act="prot-frei" data-id="${esc(p.id)}" data-an="${p.freigegeben ? "0" : "1"}">
          ${p.freigegeben ? "Zurückziehen" : "Freigeben"}</button>
        <button class="ghost small" data-act="prot-ansehen" data-id="${esc(p.id)}" title="So sehen es die Spieler">Ansehen</button>
        <button class="ghost small" data-act="prot-bearbeiten" data-id="${esc(p.id)}" title="Bearbeiten">✎</button>
        <button class="ghost small" data-act="prot-loeschen" data-id="${esc(p.id)}" title="Löschen">🗑</button>
      </div></div>`).join("");
  return section("protokolle", "📜 Protokolle", `
    <button class="primary" data-act="prot-neu">＋ Protokoll einfügen</button>
    ${zeilen ? `<div class="pt-liste">${zeilen}</div>` : ""}
    <div class="muted small hilfe" style="margin-top:6px; line-height:1.5">
      Was Claude aus dem „📝 Prompt“ geschrieben hat, hier einfügen. Die Spieler
      sehen es erst nach „Freigeben“ – am Handy unter 📜 neben dem ⚙.
    </div>`);
}

function protokollEntwurfHtml() {
  const E = Prot.entwurf;
  return `<div class="protokoll-hg">
    <div class="protokoll-fenster breit panel protokoll-form">
      <div class="pt-titelzeile"><strong>📜 ${E.id ? "Protokoll bearbeiten" : "Protokoll einfügen"}</strong>
        <button class="ghost small" data-act="prot-abbrechen">Abbrechen</button></div>
      <label class="field"><span>Titel</span>
        <input id="prot-name" value="${esc(E.name)}" maxlength="80" placeholder="Spielabend ${new Date().toLocaleDateString("de-DE")}"></label>
      <label class="field"><span>Text <small class="muted">(so wie Claude ihn geschrieben hat)</small></span>
        <textarea id="prot-text" rows="16" placeholder="Hier einfügen (Strg+V) …">${esc(E.text)}</textarea></label>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:8px">
        ${navigator.clipboard && navigator.clipboard.readText ? `<button class="ghost" data-act="prot-einfuegen" title="Text aus der Zwischenablage holen">📋 Aus Zwischenablage</button>` : ""}
        <span style="flex:1"></span>
        <button class="ghost" data-act="prot-speichern">Speichern</button>
        <button class="primary" data-act="prot-speichern" data-frei="1">Speichern &amp; freigeben</button>
      </div>
    </div></div>`;
}

// Von render() angehängt (im #app, damit Neuzeichnen es mitnimmt).
function protokollFensterHtml() {
  if (App.role === "gm" && Prot.entwurf) return protokollEntwurfHtml();
  if (Prot.offen) return protokollLeseHtml();
  return "";
}

document.addEventListener("input", (e) => {
  if (!Prot.entwurf || !e.target) return;
  if (e.target.id === "prot-name") Prot.entwurf.name = e.target.value;
  if (e.target.id === "prot-text") Prot.entwurf.text = e.target.value;
});

// Eigener Klick-Handler: alle Knöpfe heißen „prot-…", der große Handler in
// ereignisse.js kennt sie nicht.
document.addEventListener("click", async (e) => {
  // Das Fenster selbst trägt data-act="" – ein Klick hinein endet dort und
  // schließt nicht (nur der dunkle Hintergrund und „Schließen").
  const t = e.target.closest("[data-act]");
  if (!t || !t.dataset.act.startsWith("prot-")) return;
  const act = t.dataset.act, id = t.dataset.id;
  e.preventDefault();
  if (act === "prot-zu") { Prot.offen = false; render(); return; }
  if (act === "prot-auf") {
    if (Prot.auf.has(id)) Prot.auf.delete(id); else Prot.auf.add(id);
    render(); return;
  }
  if (App.role !== "gm") return;
  if (act === "prot-neu") {
    Prot.entwurf = { id: null, name: "", text: "" };
    render();
    const f = $("prot-text"); if (f) f.focus();
  } else if (act === "prot-abbrechen") {
    const E = Prot.entwurf;
    if (E && E.text.trim() && !E.id && !await frage("Eingefügten Text verwerfen?", "Verwerfen", true)) return;
    Prot.entwurf = null; render();
  } else if (act === "prot-einfuegen") {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt && Prot.entwurf) { Prot.entwurf.text = txt; render(); }
      else hinweis("Die Zwischenablage ist leer.");
    } catch { hinweis("Kein Zugriff auf die Zwischenablage – einfach ins Feld klicken und Strg+V drücken."); }
  } else if (act === "prot-speichern") {
    const E = Prot.entwurf;
    if (!E || !E.text.trim()) { hinweis("Der Text ist noch leer."); return; }
    const aktion = { type: "protokoll_speichern", id: E.id || undefined, name: E.name, text: E.text };
    if (t.dataset.frei) aktion.freigegeben = true;
    gmAction(aktion);
    Prot.entwurf = null; render();
  } else if (act === "prot-frei") {
    gmAction({ type: "protokoll_freigeben", id, an: t.dataset.an === "1" });
  } else if (act === "prot-ansehen") {
    Prot.auf = new Set([id]); Prot.offen = true; render();
  } else if (act === "prot-bearbeiten") {
    const p = protokollListe().find((x) => x.id === id);
    if (!p) return;
    let d = null;
    try { d = await (await fetch(`/api/protokoll/${encodeURIComponent(id)}`, { cache: "no-store" })).json(); } catch { /* unten */ }
    if (!d || typeof d.text !== "string") { hinweis("Das Protokoll ließ sich nicht laden."); return; }
    Prot.entwurf = { id, name: d.name || p.name, text: d.text };
    render();
  } else if (act === "prot-loeschen") {
    const p = protokollListe().find((x) => x.id === id);
    if (await frage(`Protokoll „${p ? p.name : ""}" löschen?${p && p.freigegeben ? "\n\nDie Spieler sehen es dann auch nicht mehr." : ""}`, "Löschen", true)) {
      gmAction({ type: "protokoll_loeschen", id });
    }
  }
});
