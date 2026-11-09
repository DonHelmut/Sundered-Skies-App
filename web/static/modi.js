// 🎛 Spielmodus („Was nutzen wir heute?") und 📖 Anleitung für den SL.
// Kalle, 08.11.2026: „Hilfe für den SL, was alles möglich ist" und „Spielmodi –
// was wir alles verwenden möchten, mit Toggle (angreifen oder ohne angreifen:
// nur Karten austeilen für Reihenfolge und wo ist wer)". Aus Varianten gewählt:
// Vorlagen-Kacheln + Einzelschalter (A) und eine Anleitung mit Kapiteln (A).
// Teil der Client-Logik, klassisches <script> nach sl.js/regeln.js; Funktionen
// laufen erst beim Zeichnen bzw. Klicken, die Reihenfolge ist also unkritisch.

// --- Schalter ------------------------------------------------------------------
// Schlüssel wie am Server (FUNKTIONEN in game.py) - plus zustaende/anfragen,
// die schon länger eigene Felder haben (conditionsEnabled/requestsEnabled).
const MODUS_SCHALTER = {
  kampf: [
    ["zonen", "👣 Kampfzonen", "Wer steht wo (Nahkampf … Außer Reichweite)"],
    ["timer", "⏱ Zug-Uhr", "Ring-Uhr pro Zug – aus: Zug endet nur mit ✓ / Weiter"],
    ["angriff", "⚔ Angreifen & Treffer", "Spieler wählen am Handy ihr Ziel, SL trägt Treffer ein"],
    ["wunden", "🩸 Wunden & Angeschlagen", "Wunden-Spalte, Erholen, Auto-K.O., Heilung"],
    ["zustaende", "😵 Zusatz-Zustände", "Verwundbar, Abgelenkt, Am Boden, Betäubt"],
    ["bennies", "🪙 Bennies", "Münzen am Handy, SL-Pool, Erholen per Benny"],
    ["anfragen", "🙋 Spieler-Anfragen", "Handy fragt beim SL an (Benny, Wunde …)"],
  ],
  abend: [
    ["aufnahme", "🎙 Aufnahme & Protokoll", "Mitschrift und Nacherzählung des Abends"],
    ["notizen", "📝 Notizen", "Eigene und Gruppen-Notizen am Handy"],
    ["nachrichten", "✉ Nachrichten & Bilder", "SL flüstert, zeigt Bilder, TV-Bild"],
    ["boegen", "📜 Charakterbögen", "Bogen am Handy, Werte im eigenen Zug"],
    ["regeln", "📖 Regel-Spickzettel", "Regeln nachschlagen am Handy"],
  ],
};

// Vorlagen setzen nur, was sie betreffen - die Zug-Uhr und alles „rund um den
// Abend" bleibt, wie der SL es eingestellt hat.
const MODUS_VORLAGEN = {
  nur: { titel: "🃏 Nur Reihenfolge", text: "Karten austeilen und wo ist wer. Würfeln, Treffer und Wunden macht ihr am Tisch.",
    werte: { zonen: true, angriff: false, wunden: false, zustaende: false, bennies: false, anfragen: false, regeln: false } },
  voll: { titel: "⚔ Voller Kampf", text: "Alles an: Angreifen am Handy, Treffer, Wunden, Bennies, Anfragen.",
    werte: { zonen: true, angriff: true, wunden: true, zustaende: true, bennies: true, anfragen: true, regeln: true } },
};

function modusAktuell() {
  for (const [k, v] of Object.entries(MODUS_VORLAGEN)) {
    if (Object.entries(v.werte).every(([f, an]) => funktionAn(f) === an)) return k;
  }
  return "eigen";
}
function modusName(k = modusAktuell()) {
  return k === "eigen" ? "✎ Eigene Auswahl" : MODUS_VORLAGEN[k].titel;
}

// Knopf in der SL-Kopfleiste: zeigt, was gerade gilt (Pille aus dem Mockup).
function modusKopfHtml() {
  return `<button class="ghost modus-kopf" data-act="modus-oeffnen" title="Was nutzen wir heute? Teile der App an- und ausschalten">${esc(modusName())}</button>`;
}

function modusFensterHtml() {
  if (!App.modusFenster) return "";
  const akt = modusAktuell();
  const kachel = (k, titel, text) => `<button type="button" class="modus-kachel${akt === k ? " on" : ""}" data-act="modus-vorlage" data-k="${k}">
      <b>${titel}</b><span>${text}</span></button>`;
  const zeile = ([k, titel, text]) => {
    const an = funktionAn(k);
    return `<button type="button" class="modus-zeile${an ? "" : " aus"}" data-act="modus-schalter" data-k="${k}" role="switch" aria-checked="${an}">
      <span class="mz-text">${titel}<small>${text}</small></span><span class="modus-schalter${an ? " an" : ""}"></span></button>`;
  };
  return `<div class="modus-hg" data-act="modus-zu">
    <div class="modus-fenster panel" data-act="">
      <div class="row spread" style="align-items:center">
        <h3 class="modus-titel">🎛 Was nutzen wir heute?</h3>
        <button class="ghost small" data-act="modus-zu">Schließen</button>
      </div>
      <div class="muted small modus-unter">Gilt für Laptop, Handys und TV. Bleibt gespeichert und lässt sich jederzeit umschalten – auch mitten im Abend.</div>
      <div class="modus-kacheln">
        ${Object.entries(MODUS_VORLAGEN).map(([k, v]) => kachel(k, v.titel, v.text)).join("")}
        ${kachel("eigen", "✎ Eigene Auswahl", "Die Schalter unten einzeln setzen.")}
      </div>
      <div class="modus-spalten">
        <div><div class="modus-gruppe">Kampf</div>
          <div class="modus-zeile fest"><span class="mz-text">🃏 Initiative-Karten<small>Austeilen, Reihenfolge, Joker – immer an</small></span></div>
          ${MODUS_SCHALTER.kampf.map(zeile).join("")}</div>
        <div><div class="modus-gruppe">Rund um den Abend</div>${MODUS_SCHALTER.abend.map(zeile).join("")}</div>
      </div>
      <div class="row spread modus-fuss">
        <span class="muted small">Ausgeschaltetes verschwindet nur – Wunden, Bennies, Notizen bleiben gespeichert.</span>
        <button class="primary" data-act="modus-zu">Fertig</button>
      </div>
    </div>
  </div>`;
}

// --- Anleitung -------------------------------------------------------------------
// Kurz und knapp: was geht, wo es steckt. Kapitel/Schritte mit „f" erscheinen
// nur, wenn der SL diesen Teil (🎛) eingeschaltet hat - die Anleitung soll
// nichts erklären, was gerade gar nicht zu sehen ist.
const ANLEITUNG = [
  { k: "start", titel: "▶ Abend starten", schritte: [
    ["<b>Spieler holen:</b> Panel „Beitritt für Spieler“ – Handys scannen den QR-Code. „🖼 QR-Bild kopieren“ schickt ihn per WhatsApp. Jeder wählt seinen Charakter."],
    ["<b>Nach einem Neustart</b> fragt die App „Letzte Sitzung fortsetzen?“. Erst <b>Fortsetzen</b> drücken – die erste andere Aktion verwirft den gespeicherten Kampf."],
    ["<b>🎛 oben</b>: festlegen, was ihr heute nutzt – z. B. <i>Nur Reihenfolge</i>, wenn ihr am Tisch würfelt."],
    ["<b>🌅 Abend starten</b> (Panel „Aufnahme & Protokoll“): Bennies auffüllen, Aufnahme starten und das letzte Protokoll an die Handys – ein Klick.", "aufnahme"],
    ["<b>TV / Beamer:</b> ☰ Mehr → 📺 TV-Modus öffnen und auf den zweiten Bildschirm ziehen."],
  ], tipp: "Alles, was du nur vorbereitest (Bibliothek, Beitritt, Aufnahme), startet zugeklappt. „▣ Fokus auf den Kampf“ klappt den Rest weg." },
  { k: "runde", titel: "🃏 Runde & Karten", schritte: [
    ["<b>Neue Runde</b> teilt allen eine Karte aus, die Reihenfolge sortiert sich selbst. <kbd>Leertaste</kbd>"],
    ["<b>Freigeben ▶</b> gibt den Zug frei – das Handy zeigt „Du bist dran!“. Die Ring-Uhr läuft (Zeit pro Zug: ⋯ → ⚙ unten in der Leiste).", "timer"],
    ["<b>Freigeben ▶</b> gibt den Zug frei – das Handy zeigt „Du bist dran!“. Ohne Zug-Uhr endet er nur mit ✓.", "!timer"],
    ["<b>Weiter ⏭</b> oder „Zug bestätigen ✓“ – der Nächste ist dran. Spieler können am Handy selbst „Zug beenden“. <kbd>W</kbd>"],
    ["<b>Joker:</b> wer ihn hat, kann am Handy <i>Abwarten</i> und später <i>Jetzt eingreifen!</i>. Vor der nächsten Runde wird automatisch gemischt."],
    ["<b>Falsch geklickt?</b> ↶ im Kampf-Panel macht die letzte Aktion rückgängig – beliebig oft."],
    ["<b>Pausieren:</b> ⋯ an der Figur → ⏸ – sie bekommt keine Karten, bis sie wieder rein darf."],
  ], tipp: "Talente wie <b>Kühler Kopf</b> oder <b>Schnell</b> rechnet die App beim Austeilen selbst – einmal am Charakter eintragen. Gleiche Statisten auf einer Karte: ⋯ → ⚙ → Kampfhilfen." },
  { k: "zonen", titel: "👣 Zonen & Gruppen", f: "zonen", schritte: [
    ["<b>Figuren ziehen</b> und auf eine andere Zone fallen lassen. <kbd>Strg</kbd>+Klick sammelt mehrere, die dann gemeinsam ziehen."],
    ["<b>Spieler</b> bewegen sich am Handy: Zone zweimal antippen – ein Schritt gratis, zwei = 🏃 Rennen, eine Bewegung pro Runde."],
    ["<b>Start:</b> Spieler stehen im Nahbereich, Gegner außer Reichweite."],
    ["<b>Gruppen</b> („die drei Orks“): unter dem Board „+ Neue Gruppe“, Figuren draufziehen – einmal ziehen, alle rücken nach."],
  ] },
  { k: "treffer", titel: "⚔ Treffer & Wunden", f: "wunden", schritte: [
    ["<b>🎯 Treffer</b> in der Leiste: Ziel antippen mit Stärke 😵 / +1 / +2 / +3 – oder direkt im Zonen-Board. <kbd>Z</kbd>", "angriff"],
    ["<b>Gegner am Zug:</b> die Gegnerzug-Karte zeigt die Ziele samt Parade – ein Tipp trägt das Ergebnis ein.", "angriff"],
    ["<b>Spieler greifen an:</b> am Handy „⚔ Angreifen“ und Ziel wählen. Beim SL öffnet sich ein Fenster: Daneben · Kein Schaden · Erfolg · +1/+2/+3.", "angriff"],
    ["<b>Rechtsklick</b> auf eine Figur (Liste oder Board): Treffer, Heilen, Zustände, Bennies direkt an der Maus."],
    ["<b>Angeschlagen:</b> zu Zugbeginn „✓ erholt“ (Probe geschafft) oder 🪙 in der Leiste."],
    ["<b>Wunden-Spalte</b> rechts in der Reihenfolge: 😵, Punkte für Wunden, ☠ raus. Statisten raus bei welcher Wunde: ⋯ → ⚙."],
    ["<b>🧹</b> im Kampf-Panel räumt ausgeschaltete Gegner ab."],
  ], tipp: "Schaden selbst rechnen lassen: ⋯ → ⚙ → „🎯 Schaden eintippen“ – die App vergleicht mit der Robustheit." },
  { k: "bennies", titel: "🪙 Bennies & Anfragen", f: ["bennies", "anfragen", "zustaende"], schritte: [
    ["<b>Panel „Bennies“:</b> Empfänger wählen → 🪙 +1 Benny. Dort auch der SL-Pool und „↻ Bennies auffrischen“ für den Abendbeginn.", "bennies"],
    ["<b>Benny ausgeben</b> tippen Spieler auf die Münzen oben am Handy – du bestätigst.", "bennies"],
    ["<b>Anfragen</b> (Benny, Wunde, Zustand) erscheinen oben im Panel „Anfragen“ – ✓ übernimmt, ✕ lehnt ab.", "anfragen"],
    ["<b>Zusatz-Zustände</b> (Verwundbar, Abgelenkt, Am Boden, Betäubt) über ⋯ an der Figur oder per Rechtsklick.", "zustaende"],
  ] },
  { k: "nachrichten", titel: "✉ Nachrichten & Bilder", f: "nachrichten", schritte: [
    ["<b>Empfänger wählen</b>: alle, ein Spieler (🤫 flüstern) oder mehrere. Text tippen, 🖼 hängt ein Bild an."],
    ["<b>📺 Beamer/TV</b> als Empfänger zeigt ein Bild groß auf dem TV."],
    ["<b>Bild-Archiv:</b> jedes verschickte Bild liegt als Miniatur bereit – 🔁 schickt es nochmal."],
  ] },
  { k: "vorbereiten", titel: "📚 Kämpfe vorbereiten", schritte: [
    ["<b>Bibliothek:</b> Charaktere, Gegner und Verbündete einmal anlegen – mit Bild, Parade, Robustheit, Spielwerten."],
    ["<b>⚔ Kampf vorbereiten</b> (im Kampf-Panel, solange keiner läuft): Gegner + Startzone zusammenstellen, später mit einem Klick einspielen."],
    ["<b>📋 Aus Text einfügen</b> (Bibliothek → Kämpfe): Text aus Gemini & Co. oder Kurzform „pirat 3, chefpirat 1 verdeckt“. Eine .txt lässt sich auch hineinziehen."],
    ["<b>Verdeckte Gegner:</b> ⋯ → 👁 Verdecken – Handys sehen nur einen Tarnnamen."],
  ] },
  { k: "aufnahme", titel: "🎙 Aufnahme & Protokoll", f: "aufnahme", schritte: [
    ["<b>● Aufnehmen</b> im Panel „Aufnahme & Protokoll“. Oben laufen dann Zeit, ⏸ Pause und 📌 Merken für wichtige Momente."],
    ["<b>■ Beenden</b> – die genaue Mitschrift läuft danach von selbst."],
    ["<b>Protokoll:</b> Prompt kopieren, von Claude die Nacherzählung schreiben lassen, im Panel „Protokolle“ einfügen und freigeben – die Handys sehen sie unter „Was bisher geschah“."],
  ], tipp: "Das Mikro mittig auf den Tisch – das bringt mehr als jede Einstellung." },
  { k: "handy", titel: "📱 Am Handy der Spieler", f: ["boegen", "notizen", "regeln"], schritte: [
    ["<b>📜 Charakterbogen</b>: einmal ausfüllen – im eigenen Zug stehen Parade, Robustheit, Waffen und Würfel-Tipps.", "boegen"],
    ["<b>📝 Notizen</b>: eigene (nur man selbst sieht sie) und 👥 Gruppen-Notizen für alle.", "notizen"],
    ["<b>📖 Regeln</b>: Spickzettel für den eigenen Zug.", "regeln"],
  ] },
  { k: "sichern", titel: "🛟 Sichern & Netzwerk", schritte: [
    ["<b>Automatisch:</b> die App sichert etwa stündlich (☰ Mehr → 🛟 Automatische Sicherungen)."],
    ["<b>Anderer Laptop:</b> ☰ Mehr → 💾 Sicherung exportieren, dort ⤵ importieren."],
    ["<b>Handy findet den Laptop nicht:</b> alle im selben WLAN, am Handy Flugmodus an und nur WLAN wieder an. ⓘ im Panel „Beitritt“ hilft weiter."],
  ] },
  { k: "tasten", titel: "⌨ Tasten", tasten: true },
];

function anleitungKapitelAn(kap) {
  if (!kap.f) return true;
  return [].concat(kap.f).some((f) => funktionAn(f));
}
function anleitungSchrittAn(f) {
  if (!f) return true;
  return f[0] === "!" ? !funktionAn(f.slice(1)) : funktionAn(f);
}

function anleitungHtml() {
  if (!App.anleitung) return "";
  const kapitel = ANLEITUNG.filter(anleitungKapitelAn);
  const akt = kapitel.find((k) => k.k === App.anleitung) || kapitel[0];
  const inhalt = akt.tasten ? tastenTabelleHtml()
    : `<ol class="anl-schritte">${akt.schritte.filter(([, f]) => anleitungSchrittAn(f))
        .map(([text]) => `<li>${text}</li>`).join("")}</ol>
       ${akt.tipp ? `<div class="anl-tipp">💡 ${akt.tipp}</div>` : ""}`;
  return `<div class="modus-hg" data-act="anleitung-zu">
    <div class="modus-fenster anleitung panel" data-act="">
      <div class="row spread" style="align-items:center">
        <h3 class="modus-titel">📖 Anleitung für den Spielleiter</h3>
        <button class="ghost small" data-act="anleitung-zu">Schließen</button>
      </div>
      <div class="muted small modus-unter">Was geht und wo es steckt. Was unter 🎛 ausgeschaltet ist, fehlt hier auch.</div>
      <div class="anl-raster">
        <nav class="anl-nav">${kapitel.map((k) =>
          `<button type="button" class="${k === akt ? "on" : ""}" data-act="anleitung-kapitel" data-k="${k.k}">${k.titel}</button>`).join("")}</nav>
        <div class="anl-inhalt"><h3>${akt.titel}</h3>${inhalt}</div>
      </div>
    </div>
  </div>`;
}

// Eigener Klick-Handler (wie regeln.js/protokoll.js): der große in
// ereignisse.js kennt diese Knöpfe nicht.
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || App.role !== "gm") return;
  const act = t.dataset.act;
  if (act === "modus-oeffnen") {
    App.modusFenster = true; App.anleitung = null;
    document.querySelectorAll(".kopf-menue[open]").forEach((d) => { d.open = false; });
  } else if (act === "modus-zu") App.modusFenster = false;
  else if (act === "modus-vorlage") {
    const v = MODUS_VORLAGEN[t.dataset.k];
    if (v) gmAction({ type: "set_funktionen", werte: v.werte });
    return;                                    // neuer Stand kommt vom Server
  } else if (act === "modus-schalter") {
    gmAction({ type: "set_funktionen", werte: { [t.dataset.k]: !funktionAn(t.dataset.k) } });
    return;
  } else if (act === "anleitung-oeffnen") {
    App.anleitung = App.anleitung || "start"; App.modusFenster = false;
    document.querySelectorAll(".kopf-menue[open]").forEach((d) => { d.open = false; });
  } else if (act === "anleitung-zu") App.anleitung = null;
  else if (act === "anleitung-kapitel") App.anleitung = t.dataset.k;
  else return;
  e.preventDefault();
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || App.role !== "gm") return;
  if (App.modusFenster || App.anleitung) {
    App.modusFenster = false; App.anleitung = null;
    e.stopImmediatePropagation();
    render();
  }
}, true);
