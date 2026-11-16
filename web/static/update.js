// Update-Hinweis für den SL: „Version X ist da" - einmal als Dialog, danach als
// Knopf in der Kopfleiste (Kalle 10.11.2026, Variante C). Ein Klick startet die
// Aktualisieren.exe, die App kommt von selbst wieder.
// Vorgeschichte: Updates gab es nur, wenn jemand daran dachte, die
// Aktualisieren.exe im Ordner zu starten - die meisten spielten mit Versionen
// von vor Monaten. Die Handys sehen davon nichts; nur der Laptop aktualisiert.
// Teil der Client-Logik: klassische <script>-Datei, gemeinsamer globaler
// Bereich. Fragt nur den eigenen Server (/api/update) - der hat GitHub beim
// Start einmal im Hintergrund gefragt.

const Upd = { info: null, laeuft: false };
const UPD_SEITE = "https://github.com/DonHelmut/Sundered-Skies-App/releases/latest";

async function updateLaden() {
  if (App.role !== "gm") return;
  let info;
  try { info = await (await fetch("/api/update")).json(); } catch { return; }
  if (!info || info.error) return;
  const vorher = Upd.info && Upd.info.verfuegbar;
  Upd.info = info;
  if (!info.verfuegbar) return;
  if (!vorher) { App._letztesHtml = null; render(); }
  updateVonSelbstZeigen();
}

// Der Dialog kommt von selbst nur EINMAL je Version und nie mitten ins Spiel:
// läuft schon ein Kampf, eine Aufnahme oder steht eine andere Frage offen,
// bleibt es beim Knopf in der Kopfleiste.
function updateVonSelbstZeigen() {
  const neu = Upd.info.neu;
  let gezeigt = null;
  try { gezeigt = localStorage.getItem("updateGezeigt"); } catch { /* privates Fenster */ }
  if (gezeigt === neu) return;
  const s = App.state || {};
  if (s.round || s.hasSavedSession || Aufn.rec || document.querySelector(".app-dialog-hg")) return;
  try { localStorage.setItem("updateGezeigt", neu); } catch { /* egal */ }
  updateZeigen();
}

function updateKopfHtml() {
  const i = Upd.info;
  // Läuft die Aufnahme, ist die Kopfleiste voll (Zeit, Pegel, ⏸, 📌) und schob
  // sich mit dem Knopf unter die „Verbunden"-Pille. Aktualisieren geht dann
  // ohnehin nicht - er kommt nach dem Ende der Aufnahme wieder.
  if (!i || !i.verfuegbar || Aufn.rec) return "";
  return `<button class="primary upd-knopf" data-act="upd-zeigen" title="Neue Version der App – du hast ${esc(i.lokal)}">⬆ Version ${esc(i.neu)} da</button>`;
}

async function updateZeigen() {
  const i = Upd.info;
  if (!i || !i.verfuegbar || Upd.laeuft) return;
  const s = App.state || {};
  const zeilen = [`Du hast ${esc(i.lokal)}.`];
  if (i.titel) zeilen.push(`<b>Neu:</b> ${esc(i.titel)}`);
  let knoepfe;
  if (!i.kann) {
    // Entwickler-Start oder Aktualisieren.exe gelöscht: nur der Weg von Hand.
    zeilen.push(`<span class="muted">Zum Aktualisieren im App-Ordner <b>Aktualisieren.exe</b> starten – oder das neue Paket laden:<br>
      <a href="${UPD_SEITE}" target="_blank" rel="noopener">${UPD_SEITE.replace("https://", "")}</a></span>`);
    knoepfe = [{ text: "OK", wert: false, art: "primary", standard: true, abbruch: true }];
  } else if (Aufn.rec || i.aufnahme) {
    zeilen.push(`<span class="muted">Gerade läuft eine Aufnahme. Das Update startet die App neu – erst die Aufnahme beenden, dann oben auf „⬆ Version ${esc(i.neu)} da“.</span>`);
    knoepfe = [{ text: "OK", wert: false, art: "primary", standard: true, abbruch: true }];
  } else {
    if (s.round) zeilen.push(`⚠ Es läuft ein Kampf. Die Handys sind etwa eine Minute getrennt; danach fragt die App „Fortsetzen?“ und der Kampf ist wieder da.`);
    zeilen.push(`<span class="muted">Dauert etwa 1 Minute. Die App startet danach von selbst wieder, Charaktere und Spielstand bleiben.</span>`);
    knoepfe = [{ text: "Später", wert: false, abbruch: true },
      { text: "⬆ Jetzt aktualisieren", wert: true, art: "primary", standard: true }];
  }
  const ja = await dialog({ text: `⬆ Version ${i.neu} ist da`,
    inhalt: `<div class="upd-text">${zeilen.join("<br>")}</div>`, knoepfe });
  if (ja) updateStarten();
}

async function updateStarten() {
  Upd.laeuft = true;
  let antwort = null;
  try { antwort = await (await fetch("/api/update/start", { method: "POST" })).json(); } catch { /* unten */ }
  if (!antwort || !antwort.ok) {
    Upd.laeuft = false;
    hinweis((antwort && antwort.error) || "Das Update ließ sich nicht starten.");
    return;
  }
  const ziel = (Upd.info && Upd.info.neu) || "";
  try { sessionStorage.setItem("updateZiel", JSON.stringify({ neu: ziel, titel: (Upd.info && Upd.info.titel) || "" })); } catch { /* egal */ }
  updateLaufZeigen(ziel);
}

// --- Ladebalken (Kalle 16.11.2026, Variante A) --------------------------------
// Vorgeschichte: Nach dem Klick stand nur „im schwarzen Fenster sieht man den
// Fortschritt" da - das lag oft hinter der App („da fehlt ne Art Ladebalken").
// Jetzt schreibt Aktualisieren.exe ihren Stand nach data/update-stand.json, die
// App liest ihn über /api/update/fortschritt. Drei Schritte:
//   1 Laden (die App läuft dabei weiter → echter Balken, MB, Restzeit)
//   2 Tauschen (die App ist kurz aus → keine Antwort; wandernder Balken)
//   3 Neustart (die neue App antwortet → Seite lädt neu, dann „✓ läuft").
// Eigenes Fenster statt dialog(): das hier darf man nicht wegklicken (der Klick
// daneben schlösse sonst den Balken, das Update liefe unsichtbar weiter).

const UPD_SCHRITTE = ["Neue Version herunterladen", "App kurz beenden, Dateien tauschen", "App neu starten"];
const UPD_FUSS = "Fenster offen lassen. Charaktere und Spielstand bleiben, die Handys verbinden sich danach von selbst wieder.";

function updMb(n) { return (n / 1048576).toFixed(0); }

function updSchritteHtml(stufe, unter) {
  return `<ol class="upd-schritte">${UPD_SCHRITTE.map((t, i) => {
    const art = i < stufe ? "fertig" : i === stufe ? "jetzt" : "offen";
    return `<li class="${art}"><span class="upd-nr">${i < stufe ? "✓" : i + 1}</span><span class="upd-t">${t}</span>${
      i === stufe && unter ? `<div class="upd-unter">${unter}</div>` : ""}</li>`;
  }).join("")}</ol>`;
}

function updBalken(anteil, links, rechts) {
  // Breite als transform (scaleX) statt width: läuft auf der Grafikkarte, und
  // die Zeile darunter bleibt, wo sie ist.
  const w = anteil == null ? "" : ` style="transform:scaleX(${Math.max(0, Math.min(1, anteil)).toFixed(3)})"`;
  return `<div class="upd-balken${anteil == null ? " wandern" : ""}"><i${w}></i></div>
    <div class="upd-zahlen"><span>${links}</span><span>${rechts}</span></div>`;
}

function updFenster() {
  let box = document.querySelector(".upd-lauf");
  if (!box) {
    if (typeof _dialogZu === "function" && _dialogZu) _dialogZu(null);   // offenen Dialog schließen
    box = el(`<div class="app-dialog-hg upd-lauf" role="dialog" aria-modal="true" aria-live="polite">
      <div class="app-dialog panel"><div class="app-dialog-titel upd-titel"></div>
        <div class="upd-koerper"></div><div class="app-dialog-knoepfe"></div></div></div>`);
    document.body.appendChild(box);
    // Solange das Fenster offen ist, keine Tasten an die SL-Steuerung (sonst
    // gäbe die Leertaste nebenbei den nächsten Zug frei).
    box._taste = (e) => { if (document.body.contains(box)) e.stopImmediatePropagation(); };
    document.addEventListener("keydown", box._taste, true);
  }
  return box;
}

function updFensterZu() {
  const box = document.querySelector(".upd-lauf");
  if (!box) return;
  document.removeEventListener("keydown", box._taste, true);
  box.remove();
}

function updMalen(titel, koerper, knoepfe = "") {
  const box = updFenster();
  box.querySelector(".upd-titel").textContent = titel;
  const ort = box.querySelector(".upd-koerper");
  const neu = el(`<div>${koerper}</div>`);
  // Gleicher Schritt wie eben: nur Balken und Zahlen anpassen statt alles neu
  // zu setzen - sonst springt der Balken (keine Übergänge) und flackert.
  const art = (k) => [...k.querySelectorAll(".upd-schritte li, .upd-balken, .upd-text")].map((x) => x.className).join("|");
  const alteZahlen = ort.querySelectorAll(".upd-zahlen span, .upd-fuss");
  if (ort.firstElementChild && art(ort) === art(neu) && alteZahlen.length === neu.querySelectorAll(".upd-zahlen span, .upd-fuss").length) {
    const ni = neu.querySelector(".upd-balken i"), ai = ort.querySelector(".upd-balken i");
    if (ni && ai) ai.style.transform = ni.style.transform;
    neu.querySelectorAll(".upd-zahlen span, .upd-fuss").forEach((x, i) => {
      if (alteZahlen[i].innerHTML !== x.innerHTML) alteZahlen[i].innerHTML = x.innerHTML;
    });
  } else {
    ort.replaceChildren(...neu.childNodes);
  }
  const k = box.querySelector(".app-dialog-knoepfe");
  if (k.innerHTML !== knoepfe) k.innerHTML = knoepfe;
  k.style.display = knoepfe ? "" : "none";
}

function updateLaufZeigen(ziel) {
  Upd.laeuft = true;
  const titel = `⬆ Update auf ${ziel}`;
  const proben = [];          // [zeit, geladen] der letzten ~5 s - für die Restzeit
  let ausSeit = 0;            // seit wann die App nicht antwortet
  updMalen(titel, updSchritteHtml(0, updBalken(0, "0 %", "Verbinde …")) + `<div class="upd-fuss">${UPD_FUSS}</div>`);

  async function runde() {
    if (!Upd.laeuft) return;
    let st = null;
    try {
      const r = await fetch("/api/update/fortschritt", { cache: "no-store" });
      if (r.ok) st = await r.json();
    } catch { /* App ist gerade aus */ }

    if (!st) {
      // Keine Antwort: die App ist zum Tauschen aus. Das ist der Normalfall.
      if (!ausSeit) ausSeit = Date.now();
      const lange = Date.now() - ausSeit > 180000;
      updMalen(titel, updSchritteHtml(1, updBalken(null, "App ist kurz aus", lange ? "dauert länger als sonst …" : "gleich wieder da"))
        + `<div class="upd-fuss">${lange ? "Kommt sie nicht wieder: App über START.bat neu starten – Spielstand bleibt." : UPD_FUSS}</div>`);
    } else if (ziel && st.version === ziel) {
      // Die neue App antwortet. Die Seite lädt sich gleich selbst neu
      // (veraltetNeuLaden, über die Verbindung) - zur Sicherheit auch hier.
      updMalen(titel, updSchritteHtml(2, updBalken(null, "Startet …", "")) + `<div class="upd-fuss">${UPD_FUSS}</div>`);
      setTimeout(() => location.reload(), 800);
      return;
    } else if (st.schritt === "fehler") {
      updateFehlerZeigen(st);
      return;
    } else if (st.schritt === "laden" && st.groesse) {
      ausSeit = 0;
      const jetzt = Date.now();
      proben.push([jetzt, st.geladen]);
      while (proben.length > 2 && jetzt - proben[0][0] > 5000) proben.shift();
      let rest = "";
      const [t0, g0] = proben[0];
      if (jetzt - t0 > 1500 && st.geladen > g0) {
        const s = Math.ceil((st.groesse - st.geladen) / ((st.geladen - g0) / (jetzt - t0)) / 1000);
        rest = s > 90 ? ` · noch ca. ${Math.ceil(s / 60)} min` : ` · noch ca. ${Math.max(1, s)} s`;
      }
      const anteil = st.geladen / st.groesse;
      updMalen(titel, updSchritteHtml(0, updBalken(anteil, `${Math.floor(anteil * 100)} %`,
        `${updMb(st.geladen)} von ${updMb(st.groesse)} MB${rest}`)) + `<div class="upd-fuss">${UPD_FUSS}</div>`);
    } else if (st.schritt === "entpacken") {
      updMalen(titel, updSchritteHtml(0, updBalken(1, "100 %", "Entpacke …")) + `<div class="upd-fuss">${UPD_FUSS}</div>`);
    } else if (st.schritt === "tauschen" || st.schritt === "fertig") {
      updMalen(titel, updSchritteHtml(1, updBalken(null, "App ist kurz aus", "gleich wieder da")) + `<div class="upd-fuss">${UPD_FUSS}</div>`);
    }
    // „start"/„laden" ohne Größe: Updater fragt noch GitHub - Anzeige bleibt.
    setTimeout(runde, 500);
  }
  runde();
}

function updateFehlerZeigen(st) {
  Upd.laeuft = false;
  try { sessionStorage.removeItem("updateZiel"); } catch { /* egal */ }
  const heil = st.alt_heil !== false;
  const text = `${esc(st.fehler || "Unbekannter Fehler.")}<br>${heil
    ? `<b>Nichts kaputt</b> – Version ${esc(st.version || "")} läuft weiter wie gewohnt.`
    : `Falls die App nicht mehr startet: neues Paket laden und den Ordner <b>data</b> hineinkopieren:<br>
       <a href="${UPD_SEITE}" target="_blank" rel="noopener">${UPD_SEITE.replace("https://", "")}</a>`}`;
  updMalen("Update hat nicht geklappt", `<div class="upd-text">${text}</div>`,
    `<button type="button" class="ghost" data-upd="ok">OK</button><button type="button" class="primary" data-upd="nochmal">Nochmal versuchen</button>`);
  document.querySelector(".upd-lauf [data-upd=nochmal]").focus();
}

// Nach dem Neuladen: „✓ Version X läuft" - der dritte Haken. Lädt die Seite
// mitten im Update neu (F5), läuft der Balken einfach weiter.
function updateNachNeuladen() {
  let ziel = null;
  try { ziel = JSON.parse(sessionStorage.getItem("updateZiel") || "null"); } catch { /* egal */ }
  if (!ziel || !ziel.neu) return;
  if (ziel.neu === ASSET_VERSION) {
    try { sessionStorage.removeItem("updateZiel"); } catch { /* egal */ }
    updMalen(`✓ Version ${ziel.neu} läuft`, updSchritteHtml(3)
      + (ziel.titel ? `<div class="upd-fuss"><b>Neu:</b> ${esc(ziel.titel)}</div>` : ""),
      `<button type="button" class="primary" data-upd="ok">OK</button>`);
    document.querySelector(".upd-lauf [data-upd=ok]").focus();
  } else if (App.role === "gm") {
    updateLaufZeigen(ziel.neu);
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".upd-lauf [data-upd]");
  if (!b) return;
  e.preventDefault();
  updFensterZu();
  if (b.dataset.upd === "nochmal") updateStarten();
});
document.addEventListener("keydown", (e) => {
  // Enter/Escape im Ergebnis-Fenster (nicht während es läuft).
  const box = document.querySelector(".upd-lauf");
  if (!box || Upd.laeuft || !["Enter", "Escape"].includes(e.key)) return;
  const b = box.querySelector(e.key === "Enter" ? "button.primary" : "[data-upd=ok]");
  if (b) { e.preventDefault(); b.click(); }
}, true);

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act='upd-zeigen']");
  if (!t || App.role !== "gm") return;
  e.preventDefault();
  updateZeigen();
});

// Der Server fragt GitHub nach dem Start im Hintergrund - kurz warten, und
// später nochmal, falls das Internet beim Start noch nicht da war.
setTimeout(updateLaden, 6000);
setTimeout(updateNachNeuladen, 1500);
setTimeout(updateLaden, 90000);
