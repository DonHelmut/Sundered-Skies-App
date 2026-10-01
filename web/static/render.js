// Zeichnen: entscheidet je nach Rolle/Zustand, welche Ansicht gebaut wird.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// --- Rendering --------------------------------------------------------------

function render() {
  if (!App.state || !App.role) return;
  const root = $("app");
  Cards.setJokerRunde(App.state.round);      // Joker-Stil bleibt je Runde fest
  Cards.setRueckseite(App.state.rueckseiteBild);   // eigenes Rückseitenbild (⚙ beim SL)

  // Joker-Moment: beim SL sofort, wenn ein Joker gezogen wurde (er sieht alle
  // Karten ohnehin offen). Beim Spieler NICHT hier - das verriet den Joker schon
  // beim Austeilen, bevor irgendwer aufgedeckt hatte. Dort feuert er erst, wenn
  // die Joker-Karte auf diesem Handy umgedreht wird (runReveals/revealBigCard).
  if (App.prevJokerFlash === null) App.prevJokerFlash = App.state.jokerFlash;
  else if (App.state.jokerFlash > App.prevJokerFlash) {
    App.prevJokerFlash = App.state.jokerFlash;
    if (App.role === "gm") triggerJokerMoment();
  }

  // Mimis Miau als kurzer, selbst-verschwindender Toast (nur Spieler).
  if (App.role === "player") {
    const mimi = (App.state.messages || []).filter((m) => m.sender === "mimi" && (m.target === "all" || m.target === App.myPlayerId));
    const latest = mimi[mimi.length - 1];
    if (App._lastMimiTs === undefined) App._lastMimiTs = latest ? latest.ts : 0;
    else if (latest && latest.ts > App._lastMimiTs) { App._lastMimiTs = latest.ts; showMimiToast(latest.text); }
    const kampf = (App.state.messages || []).filter((m) => m.sender === "kampf" && m.target === App.myPlayerId);
    const neu = kampf[kampf.length - 1];
    if (App._lastKampfTs === undefined) App._lastKampfTs = neu ? neu.ts : 0;
    else if (neu && neu.ts > App._lastKampfTs) { App._lastKampfTs = neu.ts; showKampfToast(neu.text); }
  }

  const prevRects = captureRects();
  const prevTokens = captureTokens();
  // Auswahl aufräumen: Figuren, die es nicht mehr gibt, still verwerfen.
  if (App.auswahl.size && App.state.combatants) {
    const da = new Set(App.state.combatants.map((c) => c.id));
    App.auswahl.forEach((id) => { if (!da.has(id)) App.auswahl.delete(id); });
  }
  Cards.renderStart();
  let html;
  try { html = (App.role === "gm" ? renderGM() + kontextMenueHtml() : renderPlayer()) + renderTokenPopupOverlay(); }
  finally { Cards.renderEnde(); }
  // Unveraendert? Dann den Bildschirm NICHT neu aufbauen. Jeder Neuaufbau ersetzt
  // alle Karten: laufende Animationen (Joker, Glanz, Glimmen) starten von vorn,
  // Bilder werden neu eingesetzt, und am Handy steht die Seite dafuer spuerbar
  // kurz still. Viele Server-Updates aendern an DIESER Ansicht gar nichts.
  // (Das Bild-Overlay unten haengt an <body> und wird trotzdem abgeglichen.)
  if (html !== App._letztesHtml || !root.firstChild) {
    App._letztesHtml = html;
    // Scrollbare Blätter (Zielwahl) behalten ihre Position - sonst sprang die
    // Liste bei jedem Server-Update nach oben.
    const scrollMerk = {};
    root.querySelectorAll("[data-scroll-merk]").forEach((e) => { scrollMerk[e.dataset.scrollMerk] = e.scrollTop; });
    root.innerHTML = html;
    root.querySelectorAll("[data-scroll-merk]").forEach((e) => {
      if (scrollMerk[e.dataset.scrollMerk]) e.scrollTop = scrollMerk[e.dataset.scrollMerk];
    });
    document.body.classList.toggle("blatt-offen", !!root.querySelector(".angriff-blatt"));
    // Platz für die fixierte Steuerleiste schaffen - über eine Klasse statt über
    // den CSS-Selektor :has(), damit es auch in älteren Browsern greift.
    document.body.classList.toggle("hat-leiste", !!root.querySelector(".aktionsleiste"));
    const dh = root.querySelector(".daumen-leiste .dl-haupt");
    const dSig = dh ? dh.innerHTML : "";
    if (dSig !== App._daumenSig) { App._daumenSig = dSig; App._daumenSeit = Date.now(); }
    document.body.classList.toggle("ziel-modus", App.role === "gm" && !!App.trefferWahl);
    kontextMenueEinpassen();
    runReveals();
    playFlip(prevRects);
    playTokens(prevTokens);
  }

  // Das Overlay haengt an <body> (nicht im #app-Root) und wird von render()
  // deshalb NICHT automatisch ersetzt -> vorher immer selbst aufraeumen.
  document.querySelectorAll(".overlay-img").forEach((n) => n.remove());
  if (App.overlayImage) {
    document.body.appendChild(el(
      `<div class="overlay-img" data-act="close-overlay">
         <img src="${esc(App.overlayImage)}">
         ${App.overlayName ? `<div class="overlay-name">${esc(App.overlayName)}</div>` : ""}
         <div class="overlay-hint">Tippen zum Schließen</div>
       </div>`
    ));
  }
}
