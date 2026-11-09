// „Als App aufs Handy": Anleitung iPhone/Android + einmaliger Hinweis-Streifen
// (Kalle, 09.11.2026, Variante 2). Warum: Über das Symbol auf dem
// Startbildschirm findet man die App am nächsten Spielabend sofort wieder,
// statt die Adresse zu suchen - und am iPhone läuft sie dann ohne Safari-Leiste.
// Ein echtes „Installieren" bietet Chrome nur über HTTPS an; im Heim-WLAN gibt
// es nur http, darum eine Anleitung statt eines Knopfs, der es selbst macht.
// Teil der Client-Logik (klassisches <script>, nach dialoge.js geladen).

const ALS_APP_ZU = "alsAppHinweisZu";

function alsAppGeraet() {
  const ua = navigator.userAgent || "";
  // iPad meldet sich seit iPadOS 13 als Mac - nur die Touch-Punkte verraten es.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "";
}

// Schon übers Symbol geöffnet? Dann weder Streifen noch Knopf.
function alsAppLaeuftSchon() {
  try {
    return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch { return false; }
}

const ALS_APP_SCHRITTE = {
  ios: { titel: "📲 iPhone: Sundered Skies als App", schritte: [
    "Unten in Safari auf <b>Teilen</b> <span class=\"als-app-taste\">⬆</span> tippen",
    "Runterscrollen → <b>„Zum Home-Bildschirm“</b>",
    "Name vorgeschlagen: „Sundered Skies“ – nach Wunsch ändern → <b>Hinzufügen</b>"],
    fuss: "Ab jetzt übers Symbol öffnen: Vollbild, ohne Safari-Leiste. Am besten mit Safari. " +
          "Beim ersten Öffnen einmal deinen Charakter wählen – das Symbol hat einen eigenen Speicher." },
  android: { titel: "📲 Android: Sundered Skies als App", schritte: [
    "Oben rechts in Chrome auf <b>⋮</b> tippen",
    "<b>„Zum Startbildschirm hinzufügen“</b>",
    "Name nach Wunsch ändern → <b>Hinzufügen</b>"],
    fuss: "Öffnet sich danach im Chrome-Fenster (Vollbild geht ohne HTTPS nicht)." },
};

function alsAppAnleitung(geraet) {
  const g = geraet || alsAppGeraet() || "android";
  const a = ALS_APP_SCHRITTE[g];
  const reiter = ["ios", "android"].map((k) =>
    `<button type="button" class="pill als-app-reiter${k === g ? " aktiv" : ""}" data-geraet="${k}">${k === "ios" ? "iPhone" : "Android"}</button>`).join("");
  const inhalt = `<div class="als-app-reiterzeile">${reiter}</div>
    <ol class="als-app-schritte">${a.schritte.map((s) => `<li>${s}</li>`).join("")}</ol>
    <p class="muted small als-app-fuss">${esc(a.fuss)}</p>
    <p class="muted small als-app-fuss">Das Symbol merkt sich die Adresse dieses Laptops. Klappt also im selben WLAN mit demselben Laptop – woanders neu scannen.</p>`;
  dialog({ text: a.titel, inhalt, knoepfe: [{ text: "OK", art: "primary", standard: true, abbruch: true, wert: true }] });
  // Umschalten iPhone/Android: Dialog mit dem anderen Gerät neu aufmachen.
  const alle = document.querySelectorAll(".app-dialog-hg");
  const box = alle[alle.length - 1];
  if (box) box.addEventListener("click", (e) => {
    const r = e.target.closest(".als-app-reiter");
    if (r && r.dataset.geraet !== g) { e.stopPropagation(); alsAppAnleitung(r.dataset.geraet); }
  }, true);
  alsAppStreifenWeg(true);
}

function alsAppStreifenWeg(merken) {
  const s = document.getElementById("als-app-streifen");
  if (s) s.remove();
  if (merken) { try { localStorage.setItem(ALS_APP_ZU, "1"); } catch { /* ignore */ } }
}

// Einmal nach dem Beitritt unten einblenden. Nicht beim SL, nicht am PC,
// nicht wenn schon als App geöffnet, nie wieder nach ✕ oder „So geht's".
function alsAppStreifenPruefen() {
  if (document.getElementById("als-app-streifen")) return;
  if (App.role !== "player" || !App.joined || !alsAppGeraet() || alsAppLaeuftSchon()) return;
  try { if (localStorage.getItem(ALS_APP_ZU) === "1") return; } catch { return; }
  const s = el(`<div id="als-app-streifen" role="note">
    <img src="/static/icon-64.png" alt="">
    <div class="als-app-text"><b>Als App aufs Handy?</b><span>Symbol auf dem Startbildschirm${alsAppGeraet() === "ios" ? ", ohne Browser-Leiste" : ""}.</span></div>
    <button type="button" class="als-app-los" data-act="als-app">So geht's</button>
    <button type="button" class="als-app-zu" aria-label="Nicht mehr zeigen">✕</button></div>`);
  s.querySelector(".als-app-zu").addEventListener("click", () => alsAppStreifenWeg(true));
  document.body.appendChild(s);
}
// Erst ein paar Sekunden nach dem Beitritt (Prüfung alle 6 s) - sonst stapelt
// er sich mit der „Neu in 2.0"-Karte und dem ersten Austeilen.
setInterval(alsAppStreifenPruefen, 6000);
