// Spielabend aufnehmen (nur SL-Laptop) und daraus einen Protokoll-Prompt bauen.
// Teil der Client-Logik, klassisches <script> nach sl.js (gemeinsamer globaler
// Bereich). Server-Seite: server/aufnahme.py.
//
// Aufgenommen wird im Browser des Laptops: über localhost darf er ohne HTTPS
// aufs Mikro. Die Handys fielen aus (kein HTTPS, Mikro stoppt bei Bildschirm
// aus, Akku). Alle 10 s geht ein Stück an den Server - stürzt der Browser ab,
// fehlen höchstens die letzten Sekunden. Transkribiert wird danach lokal mit
// noScribe; das Transkript kommt zurück und die App baut den Claude-Prompt.

// Offizielle Download-Seite (Kai Dröge, auch auf GitHub verlinkt): dort liegt
// immer die neueste Windows-Version. Die GitHub-Releases haben keinen Installer.
const NOSCRIBE_URL = "https://noscribe.de/en/docs/download-installation/";
const AUFN_STUECK_MS = 10000;

const Aufn = {
  status: null,     // Antwort von /api/aufnahme (Liste, laufende Aufnahme)
  laedt: false,
  rec: null,        // MediaRecorder, solange DIESER Tab aufnimmt
  stream: null,
  name: null,
  start: 0,
  bytes: 0,
  kette: Promise.resolve(),   // Stücke strikt nacheinander senden (Reihenfolge!)
  wakeLock: null,
  geraete: [],
  neustart: false,
};

function aufnZeit(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const zwei = (n) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${zwei(Math.floor(s % 3600 / 60))}:${zwei(s % 60)}`;
}

async function aufnStatusLaden() {
  Aufn.laedt = true;
  try { Aufn.status = await (await fetch("/api/aufnahme")).json(); } catch { /* bleibt alt */ }
  Aufn.laedt = false;
  render();
}

// Mikros erst nach der ersten Freigabe mit Namen - vorher heißen alle „".
async function aufnGeraeteLaden() {
  try {
    const alle = await navigator.mediaDevices.enumerateDevices();
    Aufn.geraete = alle.filter((d) => d.kind === "audioinput" && d.label);
  } catch { Aufn.geraete = []; }
}

function aufnGroesse(bytes) {
  return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}
function aufnDauer(ms) {
  const min = Math.round((ms || 0) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;
}

function aufnMikroWahl() {
  try { return localStorage.getItem("aufnahmeMikro") || ""; } catch { return ""; }
}

// Kleine Anzeige in der Kopfleiste: auch bei zugeklapptem Panel sieht man,
// dass aufgenommen wird, und kann einen Moment merken.
function aufnahmeKopfHtml() {
  if (!Aufn.rec) return "";
  return `<span class="pill bad aufn-kopf" title="Spielabend wird aufgenommen"><span class="aufn-punkt"></span>
      <span class="aufn-zeit">${aufnZeit(Date.now() - Aufn.start)}</span></span>
    <button class="ghost" data-act="aufn-marke" title="Diesen Moment fürs Protokoll merken (wird dort besonders erwähnt)">📌 Merken</button>`;
}

function renderAufnahmePanel() {
  if (!Aufn.status && !Aufn.laedt) aufnStatusLaden();
  const st = Aufn.status || { liste: [], aktiv: null };
  const kannAufnehmen = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  let oben;
  if (Aufn.rec) {
    oben = `<div class="aufn-laeuft"><span class="aufn-punkt"></span> Aufnahme läuft
        <b class="aufn-zeit">${aufnZeit(Date.now() - Aufn.start)}</b>
        <span class="muted small aufn-groesse">${aufnGroesse(Aufn.bytes)} gespeichert</span></div>
      <div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap">
        <button class="ghost" data-act="aufn-marke">📌 Moment merken</button>
        <button class="ghost bad" data-act="aufn-stop">■ Aufnahme beenden</button>
      </div>
      <div class="muted small hilfe" style="margin-top:6px">Tab offen lassen, Laptop nicht zuklappen.</div>`;
  } else {
    const wahl = aufnMikroWahl();
    const auswahl = Aufn.geraete.length > 1
      ? `<select data-act="aufn-mikro" title="Welches Mikro?" style="width:auto; max-width:260px">
          <option value="">Standard-Mikro</option>
          ${Aufn.geraete.map((d) => `<option value="${esc(d.deviceId)}"${d.deviceId === wahl ? " selected" : ""}>${esc(d.label)}</option>`).join("")}
        </select>` : "";
    const unterbrochen = st.aktiv
      ? `<div class="pill warn" style="display:block; margin-bottom:8px">⚠ Eine Aufnahme wurde unterbrochen (Seite neu geladen?). Der Ton bis dahin ist gespeichert.</div>` : "";
    oben = kannAufnehmen
      ? `${unterbrochen}<div class="row" style="gap:6px; flex-wrap:wrap; align-items:center">
          <button class="primary" data-act="aufn-start">● ${st.aktiv ? "Weiter aufnehmen" : "Aufnahme starten"}</button>${auswahl}
        </div>`
      : `<div class="pill bad">Dieser Browser kann nicht aufnehmen – Chrome oder Edge nehmen.</div>`;
  }
  const liste = (st.liste || []).filter((x) => !(x.laeuft && Aufn.rec));
  const zeilen = liste.map((x) => {
    const datum = x.start ? new Date(x.start).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : x.name;
    const infos = [aufnDauer(x.dauerMs), aufnGroesse(x.bytes),
      x.kaempfe ? `${x.kaempfe} Kampf${x.kaempfe === 1 ? "" : "e"}` : "", x.marken ? `${x.marken} 📌` : ""].filter(Boolean);
    return `<div class="aufn-zeile">
      <div><b>${esc(datum)}</b> <span class="muted small">${esc(infos.join(" · "))}</span></div>
      <div class="row tight" style="flex-wrap:wrap">
        ${x.datei ? `<a href="/api/aufnahme/datei/${encodeURIComponent(x.name)}"><button class="ghost small" title="Tondatei herunterladen – die kommt in noScribe">⬇ Ton</button></a>` : ""}
        <label class="ghost knopf-label small" title="Transkript aus noScribe (.html oder .txt) wählen – daraus wird der Prompt für Claude">📝 Transkript → Prompt
          <input type="file" accept=".html,.htm,.txt,.vtt,.srt,text/plain,text/html" data-act="aufn-transkript" data-name="${esc(x.name)}" style="display:none"></label>
        <button class="ghost small bad" data-act="aufn-loeschen" data-name="${esc(x.name)}" title="Aufnahme, Transkript und Prompt löschen">🗑</button>
      </div></div>`;
  }).join("");
  return section("aufnahme", "🎙 Aufnahme &amp; Protokoll", `
    ${oben}
    ${zeilen ? `<div class="aufn-liste">${zeilen}</div>` : ""}
    <div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap; align-items:center">
      <a href="${NOSCRIBE_URL}" target="_blank" rel="noopener"><button class="ghost small" title="Neueste Version, gratis, läuft offline (Installer ca. 3 GB). Nicht noscribe.ai – das kostet.">⬇ noScribe herunterladen</button></a>
    </div>
    <div class="muted small hilfe" style="margin-top:6px; line-height:1.5">
      ① Aufnehmen ② „⬇ Ton“ in noScribe (Deutsch, Sprecher + Zeitstempel an)
      ③ „📝 Transkript → Prompt“ → in Claude einfügen
    </div>`);
}

// --- Aufnehmen -----------------------------------------------------------------

async function aufnahmeStarten() {
  if (Aufn.rec) return;
  const id = aufnMikroWahl();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: id ? { exact: id } : undefined,
      // Ein Tischmikro für alle: Rauschunterdrückung schluckt sonst die leisen
      // Spieler am Tischende. Pegel-Ausgleich hilft dagegen.
      echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1,
    } });
  } catch (e) {
    if (id && e && e.name === "OverconstrainedError") {   // gemerktes Mikro nicht mehr da
      try { localStorage.removeItem("aufnahmeMikro"); } catch { /* egal */ }
      return aufnahmeStarten();
    }
    hinweis("Kein Zugriff aufs Mikro.\n\nOben links in der Adresszeile auf das Schloss/Mikro-Symbol klicken und das Mikrofon erlauben, dann nochmal.");
    return;
  }
  const typ = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"]
    .find((m) => MediaRecorder.isTypeSupported(m)) || "";
  let rec;
  try {
    // 48 kbit/s Opus: ein 4-h-Abend ≈ 90 MB, für Sprache mehr als genug.
    rec = new MediaRecorder(stream, typ ? { mimeType: typ, audioBitsPerSecond: 48000 } : {});
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    hinweis("Aufnahme ließ sich nicht starten.");
    return;
  }
  let name;
  try {
    const r = await fetch("/api/aufnahme/start", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mime: rec.mimeType || typ }) });
    name = (await r.json()).name;
  } catch { /* unten */ }
  if (!name) {
    stream.getTracks().forEach((t) => t.stop());
    hinweis("Server antwortet nicht – Aufnahme nicht gestartet.");
    return;
  }
  Object.assign(Aufn, { rec, stream, name, start: Date.now(), bytes: 0, kette: Promise.resolve() });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) aufnStueckSenden(name, e.data); };
  // Mikro abgezogen / Treiber weg: nicht still weiter „aufnehmen".
  stream.getAudioTracks().forEach((t) => { t.onended = () => {
    if (Aufn.rec === rec) { aufnahmeBeenden(); hinweis("Das Mikro ist weg – Aufnahme beendet. Der Ton bis hierher ist gespeichert."); }
  }; });
  rec.start(AUFN_STUECK_MS);
  aufnWachHalten();
  aufnGeraeteLaden();
  toast("● Aufnahme läuft");
  aufnStatusLaden();
}

function aufnStueckSenden(name, blob) {
  Aufn.kette = Aufn.kette.then(async () => {
    for (let versuch = 0; versuch < 3; versuch++) {
      try {
        const r = await fetch(`/api/aufnahme/stueck?name=${encodeURIComponent(name)}`, { method: "POST", body: blob });
        if (r.status === 409) {
          // Server kennt die Aufnahme nicht mehr (neu gestartet): ohne Kopf-
          // Stück wäre der Rest unbrauchbar -> sauber neu anfangen. Erst NACH
          // diesem Glied der Kette, sonst wartet das Beenden auf sich selbst.
          if (Aufn.name === name && !Aufn.neustart) {
            Aufn.neustart = true;
            setTimeout(async () => { await aufnahmeBeenden(true); Aufn.neustart = false; aufnahmeStarten(); }, 0);
          }
          return;
        }
        if (r.ok) { if (Aufn.name === name) Aufn.bytes += blob.size; return; }
      } catch { /* kurz warten, nochmal */ }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  });
}

async function aufnahmeBeenden(still = false) {
  const { rec, stream } = Aufn;
  if (!rec) return;
  Aufn.rec = null;
  await new Promise((fertig) => {
    rec.onstop = fertig;
    try { rec.stop(); } catch { fertig(); }
  });
  stream.getTracks().forEach((t) => t.stop());
  await Aufn.kette;                         // letzte Stücke noch abliefern
  Aufn.name = null;
  if (Aufn.wakeLock) { try { Aufn.wakeLock.release(); } catch { /* egal */ } Aufn.wakeLock = null; }
  try { Aufn.status = await (await fetch("/api/aufnahme/stop", { method: "POST" })).json(); } catch { /* egal */ }
  if (!still) toast("■ Aufnahme beendet und gespeichert");
  render();
}

// Bildschirm wach halten: Geht der Laptop schlafen, endet die Aufnahme.
async function aufnWachHalten() {
  if (!Aufn.rec || !navigator.wakeLock) return;
  try { Aufn.wakeLock = await navigator.wakeLock.request("screen"); } catch { /* geht nicht überall */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Aufn.rec && !Aufn.wakeLock) aufnWachHalten();
  if (Aufn.wakeLock && Aufn.wakeLock.released) { Aufn.wakeLock = null; aufnWachHalten(); }
});
// Tab schließen mitten in der Aufnahme: der Browser fragt nach (das ist kein
// sperrbarer confirm(), sondern die eingebaute Verlassen-Warnung).
window.addEventListener("beforeunload", (e) => {
  if (Aufn.rec) { e.preventDefault(); e.returnValue = ""; }
});
// Laufzeit-Anzeige jede Sekunde nachführen, ohne alles neu zu zeichnen.
setInterval(() => {
  if (!Aufn.rec) return;
  const t = aufnZeit(Date.now() - Aufn.start);
  document.querySelectorAll(".aufn-zeit").forEach((x) => { x.textContent = t; });
  document.querySelectorAll(".aufn-groesse").forEach((x) => { x.textContent = `${aufnGroesse(Aufn.bytes)} gespeichert`; });
}, 1000);

async function aufnMarke() {
  if (!Aufn.rec) return;
  // Sofort merken, ohne Nachfrage: am Tisch zählt der Moment, nicht der Text.
  try { await fetch("/api/aufnahme/marke", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { return; }
  toast(`📌 Gemerkt bei ${aufnZeit(Date.now() - Aufn.start)}`);
}

// --- Transkript -> Prompt --------------------------------------------------------

async function aufnPromptBauen(name, datei) {
  if (!datei) return;
  const fd = new FormData();
  fd.append("file", datei);
  let erg;
  try {
    const r = await fetch(`/api/aufnahme/prompt/${encodeURIComponent(name)}`, { method: "POST", body: fd });
    erg = await r.json();
  } catch { /* unten */ }
  if (!erg || !erg.prompt) { hinweis("Aus dieser Datei ließ sich kein Prompt bauen (leer oder kein Transkript?)."); return; }
  aufnStatusLaden();
  const wahl = await dialog({
    text: `Prompt fertig (${erg.prompt.length.toLocaleString("de-DE")} Zeichen).\n\nIn Claude einfügen (Strg+V) – Claude schreibt daraus das Protokoll.`,
    knoepfe: [
      { text: "Schließen", wert: null, abbruch: true },
      { text: "⬇ Als Datei", wert: "datei" },
      { text: "📋 Kopieren & Claude öffnen", wert: "kopieren", art: "primary", standard: true },
    ],
  });
  if (wahl === "kopieren") {
    try {
      await navigator.clipboard.writeText(erg.prompt);
      window.open("https://claude.ai/new", "_blank", "noopener");
    } catch { aufnPromptDatei(name, erg.prompt); hinweis("Kopieren ging nicht – Prompt stattdessen als Datei gespeichert."); }
  } else if (wahl === "datei") {
    aufnPromptDatei(name, erg.prompt);
  }
}

function aufnPromptDatei(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `protokoll-prompt-${name}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Eigene Klick-/Änderungs-Handler: die Knöpfe heißen alle „aufn-…", der große
// Handler in ereignisse.js kennt sie nicht und lässt sie in Ruhe.
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act^='aufn-']");
  if (!t || App.role !== "gm") return;
  const act = t.dataset.act;
  if (act === "aufn-start") { e.preventDefault(); aufnahmeStarten(); }
  else if (act === "aufn-stop") {
    e.preventDefault();
    if (await frage("Aufnahme beenden?", "Beenden")) aufnahmeBeenden();
  } else if (act === "aufn-marke") { e.preventDefault(); aufnMarke(); }
  else if (act === "aufn-loeschen") {
    e.preventDefault();
    if (!await frage("Diese Aufnahme löschen?\n\nTon, Transkript und Prompt sind dann weg.", "Löschen", true)) return;
    try { await fetch(`/api/aufnahme/loeschen/${encodeURIComponent(t.dataset.name)}`, { method: "POST" }); } catch { /* egal */ }
    aufnStatusLaden();
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.dataset || App.role !== "gm") return;
  if (t.dataset.act === "aufn-mikro") {
    try { localStorage.setItem("aufnahmeMikro", t.value); } catch { /* egal */ }
  } else if (t.dataset.act === "aufn-transkript") {
    aufnPromptBauen(t.dataset.name, t.files && t.files[0]);
    t.value = "";
  }
});
