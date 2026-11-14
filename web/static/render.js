// Zeichnen: entscheidet je nach Rolle/Zustand, welche Ansicht gebaut wird.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// --- Rendering --------------------------------------------------------------

// Neuen Stand STÜCKWEISE einspielen statt root.innerHTML = html. Vorher wurde
// bei jeder Änderung (irgendwer bekommt eine Wunde) der GANZE Bildschirm
// weggeworfen und neu gebaut: alle Karten-SVGs neu, Joker-/Glimm-Animationen
// starteten von vorn, Bilder wurden neu eingesetzt, und am Handy stand die
// Seite dafür kurz still. Jetzt bleiben unveränderte Knoten stehen; nur
// geänderte Attribute/Texte werden angefasst, Neues eingesetzt, Weggefallenes
// entfernt. Ergebnis wie innerHTML (gleiche Attribute, gleicher Text).
// Zeilen mit Kennung (id, data-cid, data-rkey) werden über die Kennung
// zugeordnet: rutscht eine Figur in der Reihenfolge, wandert IHR Knoten mit,
// statt dass alle Zeilen darunter umgeschrieben werden.
function domAbgleichen(root, html) {
  const t = document.createElement("template");
  // Emoji → Linien-Symbol (symbole.js). Abfrage, weil Tests render.js auch
  // allein laden.
  t.innerHTML = typeof symboleEinsetzen === "function" ? symboleEinsetzen(html) : html;
  kinderAbgleichen(root, t.content);
}
function domKennung(n) {
  if (n.nodeType !== 1) return null;
  const k = n.getAttribute("id") || n.getAttribute("data-cid") || n.getAttribute("data-rkey");
  return k ? n.nodeName + "#" + k : null;
}
function kinderAbgleichen(alt, neu) {
  // Vorhandene Knoten mit Kennung merken - die dürfen umziehen.
  const mitKennung = new Map();
  for (let c = alt.firstChild; c; c = c.nextSibling) {
    const k = domKennung(c);
    if (k && !mitKennung.has(k)) mitKennung.set(k, c);
  }
  let pos = alt.firstChild;
  let n = neu.firstChild;
  while (n) {
    const naechster = n.nextSibling;
    const k = domKennung(n);
    let passend = null;
    if (k) {
      passend = mitKennung.get(k) || null;
      if (passend) mitKennung.delete(k);
    } else if (pos && pos.nodeType === n.nodeType && pos.nodeName === n.nodeName && !domKennung(pos)) {
      passend = pos;
    }
    if (passend) {
      if (passend !== pos) alt.insertBefore(passend, pos);
      knotenAbgleichen(passend, n);
      pos = passend.nextSibling;
    } else {
      alt.insertBefore(n, pos);       // neuer Knoten: aus dem Template übernehmen
    }
    n = naechster;
  }
  // Rest (gibt es im neuen Stand nicht mehr) entfernen.
  while (pos) { const weg = pos; pos = pos.nextSibling; weg.remove(); }
}
function knotenAbgleichen(alt, neu) {
  if (alt.nodeType !== 1) {
    if (alt.nodeValue !== neu.nodeValue) alt.nodeValue = neu.nodeValue;
    return;
  }
  // Attribute angleichen (auch Klassen, die JS nachträglich gesetzt hat:
  // innerHTML hätte sie genauso verworfen).
  for (let i = alt.attributes.length - 1; i >= 0; i--) {
    const a = alt.attributes[i];
    if (!neu.hasAttributeNS(a.namespaceURI, a.localName)) alt.removeAttributeNS(a.namespaceURI, a.localName);
  }
  for (const a of neu.attributes) {
    if (alt.getAttributeNS(a.namespaceURI, a.localName) !== a.value) alt.setAttributeNS(a.namespaceURI, a.name, a.value);
  }
  // Template-Elemente tragen ihren Inhalt in .content, nicht als Kinder.
  if (alt.nodeName === "TEMPLATE") { alt.innerHTML = neu.innerHTML; return; }
  // Sollwerte VOR dem Kinder-Abgleich lesen: der zieht neue Knoten aus dem
  // Template heraus (Text einer <textarea>, <option>s), danach war neu.value
  // leer - sonst kam z. B. die gespeicherte Notiz nach dem Neuladen an und
  // wurde gleich wieder auf "" gesetzt (Feld leer, obwohl der Server sie hatte).
  const sollWert = neu.nodeName === "TEXTAREA" ? neu.textContent
    : neu.nodeName === "INPUT" ? neu.value : null;
  const sollIndex = neu.nodeName === "SELECT" ? neu.selectedIndex : -1;
  kinderAbgleichen(alt, neu);
  // Formularfelder: innerHTML hätte den Wert neu gesetzt. Bei bestehenden
  // Feldern hängt .value aber nicht mehr am Attribut -> selbst setzen.
  // Ein Feld mit Fokus NICHT anfassen (sonst springt der Cursor beim Tippen).
  if (alt === document.activeElement) return;
  const tag = alt.nodeName;
  if (tag === "INPUT") {
    if (alt.type === "checkbox" || alt.type === "radio") { if (alt.checked !== neu.checked) alt.checked = neu.checked; }
    else if (alt.type !== "file" && alt.value !== sollWert) alt.value = sollWert;
  } else if (tag === "TEXTAREA") {
    if (alt.value !== sollWert) alt.value = sollWert;
  } else if (tag === "SELECT") {
    if (alt.selectedIndex !== sollIndex) alt.selectedIndex = sollIndex;
  } else if (tag === "DETAILS") {
    if (alt.open !== neu.open) alt.open = neu.open;
  }
}

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
    const kampf = (App.state.messages || []).filter((m) => m.sender === "kampf" && [].concat(m.target).includes(App.myPlayerId));
    const neu = kampf[kampf.length - 1];
    if (App._lastKampfTs === undefined) App._lastKampfTs = neu ? neu.ts : 0;
    else if (neu && neu.ts > App._lastKampfTs) { App._lastKampfTs = neu.ts; showKampfToast(neu.text, neu.art); }
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
  try { html = (App.role === "gm" ? renderGM() + kontextMenueHtml() : renderPlayer()) + renderTokenPopupOverlay() + bogenAnsichtHtml() + protokollFensterHtml() + regelnFensterHtml(); }
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
    domAbgleichen(root, html);
    root.querySelectorAll("[data-scroll-merk]").forEach((e) => {
      if (scrollMerk[e.dataset.scrollMerk]) e.scrollTop = scrollMerk[e.dataset.scrollMerk];
    });
    document.body.classList.toggle("blatt-offen", !!root.querySelector(".angriff-blatt"));
    // Spieler-Teil im ⚙-Menü (liegt außerhalb von #app) mit auffrischen.
    const sm = $("spieler-menue");
    const meine = App.role === "player" && App.joined ? myCombatant() : null;
    if (sm) sm.innerHTML = meine ? spielerMenueHtml(meine) : "";
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

  protokollKnopfAuffrischen();

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
