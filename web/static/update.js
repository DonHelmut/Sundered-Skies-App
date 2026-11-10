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
  // Bewusst ohne Knopf zum Wegklicken gedacht, aber OK schadet nicht: die
  // Seite lädt sich neu, sobald der Server mit der neuen Version antwortet
  // (veraltetNeuLaden in dialoge.js).
  hinweis("⬆ Das Update läuft.\n\nDieses Fenster offen lassen – es lädt sich von selbst neu, sobald die neue Version da ist (etwa 1 Minute). Im schwarzen Fenster sieht man den Fortschritt.");
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act='upd-zeigen']");
  if (!t || App.role !== "gm") return;
  e.preventDefault();
  updateZeigen();
});

// Der Server fragt GitHub nach dem Start im Hintergrund - kurz warten, und
// später nochmal, falls das Internet beim Start noch nicht da war.
setTimeout(updateLaden, 6000);
setTimeout(updateLaden, 90000);
