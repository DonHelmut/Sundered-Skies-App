// Eigene Rückfragen (dialog/frage/hinweis/eingabe) statt Browser-Dialogen –
// die kann der Browser sperren, dann tun Löschen & Co. still nichts (1.4.5).
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// --- Eigene Rückfragen statt confirm()/alert()/prompt() ---------------------
// Nach ein paar Browser-Dialogen bietet der Browser „weitere Dialoge von
// localhost:8000 unterbinden" an. Wer das anklickt, bekommt auf jedes
// confirm() sofort still „Abbrechen" - Entfernen, Abräumen, Löschen taten
// dann einfach nichts mehr (Stefan: „die Steuerung ist bricked"). Eigene
// Dialoge kann der Browser nicht sperren. Sie hängen an <body>, nicht an
// #app - render() würde sie sonst mitten in der Frage wegwischen.
let _dialogZu = null;
function dialog({ text, knoepfe, eingabe = null }) {
  return new Promise((fertig) => {
    if (_dialogZu) _dialogZu(null);                // höchstens einer offen
    const box = el(`<div class="app-dialog-hg" role="dialog" aria-modal="true">
      <div class="app-dialog panel">
        <div class="app-dialog-text">${esc(text).replace(/\n/g, "<br>")}</div>
        ${eingabe ? `<input class="app-dialog-eingabe" maxlength="60" value="${esc(eingabe.vorgabe || "")}">` : ""}
        <div class="app-dialog-knoepfe">${knoepfe.map((k, i) =>
          `<button type="button" class="${k.art || "ghost"}" data-i="${i}">${esc(k.text)}</button>`).join("")}</div>
      </div></div>`);
    const feld = box.querySelector("input");
    const standard = knoepfe.findIndex((k) => k.standard);
    const abbruch = knoepfe.findIndex((k) => k.abbruch);
    const wertVon = (i) => {
      const k = knoepfe[i];
      if (!k) return null;
      if (feld && !k.abbruch) return feld.value.trim() || null;
      return k.wert;
    };
    const zu = (wert) => {
      box.remove();
      document.removeEventListener("keydown", taste, true);
      _dialogZu = null;
      fertig(wert);
    };
    const abbrechen = () => zu(abbruch >= 0 ? knoepfe[abbruch].wert : null);
    function taste(e) {
      // Solange der Dialog offen ist, bekommt die SL-Steuerung keine Tasten
      // (sonst gäbe die Leertaste nebenbei den nächsten Zug frei).
      e.stopImmediatePropagation();
      if (e.key === "Escape") { e.preventDefault(); abbrechen(); }
      else if (e.key === "Enter" && standard >= 0) { e.preventDefault(); zu(wertVon(standard)); }
    }
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) { e.stopPropagation(); zu(wertVon(Number(b.dataset.i))); }
      else if (e.target === box) abbrechen();       // Klick daneben = Abbrechen
    });
    document.addEventListener("keydown", taste, true);
    _dialogZu = zu;
    document.body.appendChild(box);
    if (feld) { feld.focus(); feld.select(); }
    else { const b = box.querySelector(`button[data-i="${standard >= 0 ? standard : 0}"]`); if (b) b.focus(); }
  });
}
// Ja/Nein -> true/false. gefahr: roter Knopf (Löschen, Entfernen …).
const frage = (text, ja = "OK", gefahr = false) => dialog({ text, knoepfe: [
  { text: "Abbrechen", wert: false, abbruch: true },
  { text: ja, wert: true, art: gefahr ? "bad" : "primary", standard: true }] });
const hinweis = (text) => dialog({ text, knoepfe: [{ text: "OK", wert: true, art: "primary", standard: true, abbruch: true }] });
// Texteingabe -> getrimmter Text oder null (Abbrechen/leer).
const eingabe = (text, vorgabe = "", ja = "OK") => dialog({ text, eingabe: { vorgabe }, knoepfe: [
  { text: "Abbrechen", wert: null, abbruch: true },
  { text: ja, art: "primary", standard: true }] });

// Nach einem Update laufen offene Tabs (Laptop, Handys, Beamer) mit dem ALTEN
// Seiten-Code weiter und verbinden sich einfach neu - mit alter Logik. So kam
// „Probe Schnell" trotz Schutz in 1.4.3 wieder rein. Weicht die Server-Version
// ab: einmal neu laden. Hängt danach der Cache, zeigt versionLine() den Hinweis.
function veraltetNeuLaden(serverVersion, eigene) {
  let schon = null;
  try { schon = sessionStorage.getItem("neuGeladenFuer"); } catch { /* egal */ }
  if (!serverVersion || serverVersion === eigene) {
    if (schon) try { sessionStorage.removeItem("neuGeladenFuer"); } catch { /* egal */ }
    return false;
  }
  if (schon === serverVersion) return false;          // schon versucht - nicht im Kreis laden
  try { sessionStorage.setItem("neuGeladenFuer", serverVersion); } catch { /* egal */ }
  location.reload();
  return true;
}

function maybeAutoRejoin() {
  if (App.role === "player" && App.myPlayerId && App.myName) {
    // auto: der Server nimmt das nur von Geräten an, die er kennt (sonst Beitrittsseite).
    wsSend({ type: "join", name: App.myName, characterId: App.myCharacterId, playerId: App.myPlayerId, auto: true });
    App.joined = true;
  }
}
