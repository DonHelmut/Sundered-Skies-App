// Handy bleibt wach, solange gekämpft wird (Kalle 10.11.2026).
// Vorgeschichte: Im Kampf liegt das Handy auf dem Tisch, nach 30 Sekunden geht
// der Bildschirm aus - dann sieht niemand, dass er dran ist, und beim
// Aufwecken muss sich das Handy erst neu verbinden. Bisher stand nur in der
// Anleitung „Bildschirmsperre hochsetzen".
//
// Zwei Wege, weil die App ohne https läuft (http://192.168…):
// 1. navigator.wakeLock - der saubere Weg, geht aber nur auf „sicheren"
//    Seiten (https/localhost), also am Handy meist NICHT.
// 2. Ein winziges, stilles Video in Schleife (wach.mp4, 32×32, 4 KB, mit
//    stiller Tonspur): solange ein Video läuft, schaltet das Handy nicht ab.
//    Abspielen darf der Browser erst nach einer Berührung - darum startet es
//    beim ersten Tipp im Kampf.
// Nur im Kampf: außerhalb soll das Handy normal schlafen (Akku).
// Abschaltbar im ⚙ („☀ Bildschirm anlassen …").

const Wach = { sperre: null, video: null, an: false };

function wachGewollt() {
  try { return localStorage.getItem("wachBleiben") !== "off"; } catch { return true; }
}
function wachSoll() {
  const s = App.state;
  return App.role === "player" && App.joined && !!s && s.round > 0 && wachGewollt()
    && document.visibilityState === "visible";
}

function wachVideo() {
  if (Wach.video) return Wach.video;
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("title", "Bildschirm anlassen");
  v.src = "/static/wach.mp4";
  // Sichtbar im Sinne des Browsers (manche zählen nur sichtbare Videos),
  // für Menschen nicht: 1 Pixel, fast durchsichtig, fängt keine Tipps.
  v.style.cssText = "position:fixed; left:0; bottom:0; width:1px; height:1px; opacity:0.01; pointer-events:none; z-index:-1";
  // Nicht „loop": iPhones halten bei Schleifen kurz an und schlafen dann doch
  // ein. Stattdessen vor dem Ende zurückspringen.
  v.addEventListener("timeupdate", () => { if (v.currentTime > 8) v.currentTime = 0.5; });
  document.body.appendChild(v);
  Wach.video = v;
  return v;
}

async function wachAn() {
  if (Wach.an) return;
  if (navigator.wakeLock) {
    try {
      Wach.sperre = await navigator.wakeLock.request("screen");
      Wach.sperre.addEventListener("release", () => { Wach.sperre = null; Wach.an = false; });
      Wach.an = true;
      return;
    } catch { /* unsichere Seite oder Akku-Sparmodus -> Video */ }
  }
  try {
    await wachVideo().play();
    Wach.an = true;
  } catch { /* noch keine Berührung - der nächste Tipp versucht es wieder */ }
}

function wachAus() {
  Wach.an = false;
  if (Wach.sperre) { try { Wach.sperre.release(); } catch { /* egal */ } Wach.sperre = null; }
  if (Wach.video) { try { Wach.video.pause(); } catch { /* egal */ } }
}

function wachPruefen() {
  if (wachSoll()) wachAn(); else if (Wach.an) wachAus();
}

// Kampfbeginn/-ende kommen als neuer Stand vom Server; ein Takt reicht, statt
// sich in render() einzuhängen. Tipps zählen als Berührung fürs Video.
setInterval(wachPruefen, 3000);
document.addEventListener("visibilitychange", wachPruefen);
document.addEventListener("click", () => { if (!Wach.an) wachPruefen(); }, true);
document.addEventListener("change", (e) => {
  const t = e.target.closest && e.target.closest("[data-act='toggle-wach']");
  if (!t) return;
  try { localStorage.setItem("wachBleiben", t.checked ? "on" : "off"); } catch { /* privates Fenster */ }
  wachPruefen();
});
