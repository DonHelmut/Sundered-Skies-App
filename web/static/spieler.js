// Spieler-Ansicht am Handy (Beitritt, eigene Karte, Zielwahl).
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// ---------- Spieler-Ansicht ----------

function renderPlayer() {
  const s = App.state;
  const mine = s.combatants.find((c) => c.playerId === App.myPlayerId);

  if (!App.joined || !mine) return renderJoin();
  // Für „Weiter als …" beim nächsten Beitritt (auch nach „Verlassen").
  if (mine.characterId && App._gemerkterChar !== mine.characterId) {
    App._gemerkterChar = mine.characterId;
    merkeLetztenCharakter(mine.characterId, mine.name);
    // Auch fürs stille Wiederbeitreten merken: wer am Handy einen NEUEN
    // Charakter angelegt hat, kannte dessen ID bisher nicht. Startete der
    // Laptop neu und der SL klickte „Verwerfen", kam er als namensgleicher
    // Gast ohne Bogen zurück – und Eingetragenes landete nicht mehr am Charakter.
    App.myCharacterId = mine.characterId;
    try { localStorage.setItem("characterId", mine.characterId); } catch { /* privates Fenster */ }
  }

  const isMyTurn = s.activeId === mine.id && s.phase === "running";
  // Der Sekunden-Ring nur bei dem, der WIRKLICH dran ist - bei allen anderen
  // tickte er mit und machte unnoetig Druck. Wer als Naechster kommt, bekommt
  // stattdessen eine Vorwarnung, alle anderen sehen nur, wer gerade dran ist.
  const aktiv = s.combatants.find((c) => c.id === s.activeId);
  const binNaechster = !isMyTurn && !mine.benched && (naechsterAkteur(s) || {}).id === mine.id;
  // Die eigene Figur nie beim Namen nennen: vor der Freigabe stand am eigenen
  // Handy „Vela ist dran", als wäre jemand anderes gemeint.
  const werDran = !aktiv ? ""
    : aktiv.id === mine.id ? "⏳ Du bist dran, sobald der Spielleiter freigibt"
    : (aktiv.kind === "npc" && !aktiv.ally ? "Ein Gegner ist dran" : `${esc(aktiv.name)} ist dran`);
  // Wer dran ist / ob man gleich kommt, steht NUR in der Leiste oben (Kalle,
  // 25.10.2026). Vorher sagten es drei Stellen gleichzeitig: Leiste („du kommst
  // als Nächstes"), Kasten unter der Karte („Gleich bist du dran") und eine
  // Zeile darunter („Warte auf Freigabe"). Unter der Karte bleibt nur die Uhr.
  const timer = s.phase === "running" && isMyTurn
    ? (s.timerEndsAt ? timerRing() : funktionAn("timer") ? `<div class="timer-halt">⏸ Uhr angehalten – würfle in Ruhe</div>` : "")
    : "";

  // Karten-Hinweise („Joker: +2 …", „Berechnend" bei niedriger Karte) erst,
  // wenn die eigene Karte aufgedeckt ist - sonst stand unter der verdeckten
  // Karte schon, was drunter liegt.
  const hints = activeHints(mine, !mine.card || !!mine.revealed).map((h) => `<div class="pill warn" style="margin:4px 2px">${esc(h)}</div>`).join("");

  // Abwarten darf JEDE Figur (SW-Regel) – sinnvoll ansagen kann man es, wenn
  // man gerade dran ist.
  let holdBtn = "";
  if (!mine.held && isMyTurn) holdBtn = `<button data-act="hold" data-id="${mine.id}">Abwarten ⏸</button>`;
  if (mine.held) holdBtn = `<button class="primary big" data-act="intervene" data-id="${mine.id}">Jetzt eingreifen! ⚡</button>`;

  // Dran: der Hauptknopf ist „⚔ Angreifen" (Ziel wählen, der SL entscheidet,
  // man sieht nur das Ergebnis). „Zug beenden" bleibt klein daneben - für Züge
  // ohne Angriff. Ohne Anfragen-System (SL hat es abgeschaltet) wie früher.
  const meinAngriff = (s.requests || []).find((r) => r.kind === "attack" && r.combatantId === mine.id);
  // Eigener Schalter (Kampf-Einstellungen), unabhängig vom Anfragen-System.
  const angriffMoeglich = isMyTurn && s.spielerAngriff !== false && funktionAn("angriff");
  const angriffZiel = meinAngriff && s.combatants.find((c) => c.id === (meinAngriff.detail || {}).targetId);
  const angriffBtn = !angriffMoeglich ? ""
    : meinAngriff
      ? `<div class="angriff-wartet">⚔ Angriff auf <b>${esc(angriffZiel ? angriffZiel.name : "?")}</b> gemeldet – der Spielleiter entscheidet ⏳</div>`
      : `<button class="primary big angriff-knopf" data-act="angriff-waehlen">⚔ Angreifen</button>`;
  const confirmBtn = isMyTurn
    ? (angriffMoeglich
        ? `<button class="ghost" data-act="confirm-turn" title="Zug ohne (weiteren) Angriff beenden">Zug beenden ✓</button>`
        : `<button class="good big" data-act="confirm-turn">Zug bestätigen ✓</button>`)
    : "";
  // Angeschlagen + man ist dran: ein deutlicher Knopf, um sich (nach bestandener
  // Willenskraft- oder Konstitutions-Probe) zu erholen – meldet es dem SL, statt es im Zustand-Menü zu suchen.
  const mySt = mine.status || {};
  // Schon sobald man an der Reihe ist (auch vor der Freigabe durch den SL):
  // Angeschlagen heißt, der Zug beginnt mit der Erholungs-Probe (Willenskraft
  // oder Konstitution - Stefan: am Tisch geht beides).
  const binDran = s.activeId === mine.id;
  // Erholen ist keine Anfrage mehr (gilt sofort) - geht auch ohne Anfragen.
  const canRecover = binDran && funktionAn("wunden") && mySt.shaken && !mySt.out;
  const recoverFreeBtn = canRecover
    ? `<button class="primary big" data-act="player-request" data-kind="status" data-detail='{"shaken":false}' data-label="ist nicht mehr angeschlagen">✓ Geschafft</button>`
    : "";
  const recoverBennyBtn = (canRecover && mine.isWildCard && funktionAn("bennies") && (mine.bennies || 0) > 0)
    ? `<button class="good big" data-act="player-request" data-kind="recover" data-detail='{"benny":true}' data-label="gibt einen Benny aus und ist erholt">🪙 Benny</button>`
    : "";
  const recoverGemeldet = (s.requests || []).some((r) => r.combatantId === mine.id && (r.kind === "recover" || (r.kind === "status" && (r.detail || {}).shaken === false)));
  // Der große Erklär-Kasten („Du bist angeschlagen – würfle zuerst …") ist weg
  // (Kalle, Variante 2B): er sagte dasselbe wie die beiden Knöpfe unten und war
  // fünf Zeilen hoch. Die Frage steht jetzt direkt über den Knöpfen (daumenKnopf).
  // Bleibt nur die Rückmeldung, wenn der Benny-Wunsch beim SL liegt.
  const angeschlagenHinweis = binDran && mySt.shaken && !mySt.out && recoverGemeldet
    ? `<div class="zone-hint center">😵 Erholung an den Spielleiter geschickt ⏳</div>` : "";

  // Nur was der SL schreibt. Angriffsergebnisse („⚔ Daneben …") und Mimis Miau
  // standen hier früher mit drin - das las sich wie ein Kampf-Log, und die
  // eigentlichen SL-Nachrichten gingen darin unter. Beide kommen als Toast.
  // Der Server schickt nur „an alle" und die an mich; der Filter hier ist
  // nur die zweite Sicherung.
  const gmMsgs = s.messages.filter((m) => (m.target === "all" || [].concat(m.target).includes(App.myPlayerId))
    && m.sender !== "mimi" && m.sender !== "kampf");
  const geflustert = (m) => m.target !== "all";
  // Flüstern an mehrere: sagen, wer es noch weiß - sonst redet man am Tisch
  // aneinander vorbei („Hast du das auch gekriegt?").
  const mitwisser = (m) => [].concat(m.target).filter((id) => id !== App.myPlayerId)
    .map((id) => esc(spielerAnzeige(s.players.find((p) => p.id === id))));
  const anWen = (m) => !geflustert(m) ? "An alle"
    : mitwisser(m).length ? `🤫 Nur an dich und ${mitwisser(m).join(", ")}` : "🤫 Nur an dich";
  // Kopfzeile je Nachricht: an wen · Uhrzeit · Lesezeichen (Studio-Runde
  // Notizen, 16.11.2026). Das Lesezeichen merkt den Hinweis als eigene Notiz -
  // vorher ein eigener „📝 Merken"-Knopf unter jedem Text, das war laut.
  const merk = (m) => !(m.text && m.id) ? ""
    : nachrichtGemerkt(m.id) ? `<span class="msg-merk ok" title="Steht in deinen Notizen">${symbolSvg("bookmark-check")}In Notizen</span>`
    : `<button type="button" class="msg-merk" data-act="notiz-merken" data-id="${esc(m.id)}" aria-label="In Notizen merken" title="In Notizen merken">🔖</button>`;
  const msgs = gmMsgs.slice().reverse().slice(0, 8)
    .map((m) => `<div class="msg${geflustert(m) ? " gefluestert" : ""}"><div class="to"><span>${anWen(m)}</span>${m.ts ? `<span class="msg-zeit">${zeitKurz(m.ts)}</span>` : ""}${merk(m)}</div>${m.text ? mehrzeilig(m.text) : ""}${m.imageUrl ? `<img src="${esc(m.imageUrl)}" data-act="open-image" data-url="${esc(m.imageUrl)}">` : ""}</div>`).join("");

  // Blockierendes Banner für jede neue SL-Nachricht.
  const newest = gmMsgs[gmMsgs.length - 1];
  const msgBanner = newest && newest.ts > App.lastSeenMsgTs
    ? `<div class="msg-overlay">
         <div class="msg-card${geflustert(newest) ? " gefluestert" : ""}">
           <div class="muted small">${!geflustert(newest) ? "✉ Nachricht vom Spielleiter an alle"
             : mitwisser(newest).length ? `🤫 Der Spielleiter flüstert dir und ${mitwisser(newest).join(", ")} zu`
             : "🤫 Der Spielleiter flüstert dir zu"}</div>
           ${newest.text ? `<div class="msg-text">${mehrzeilig(newest.text)}</div>` : ""}
           ${newest.imageUrl ? `<img src="${esc(newest.imageUrl)}">` : ""}
           <button class="primary big" data-act="dismiss-msg" data-ts="${newest.ts}" style="margin-top:14px;width:100%">Verstanden</button>
         </div>
       </div>`
    : "";

  // Feste Kopfleiste an (CSS: Abstand oben, Pille nur bei Verbindungsärger).
  document.body.classList.add("mit-kopf");

  // Pausiert („Aus dem Kampf") – keine Karte, klarer Hinweis statt Kartenbereich.
  // Dran und Karte offen: Kurzansicht „Mein Zug" (regeln.js) statt großer Karte.
  const kurz = kurzAnsichtJetzt(s, mine, isMyTurn);
  // Zwischen den Kämpfen (keine Karte oder kein Gegner mehr): ruhige Ansicht
  // statt großer Kartenrückseite (Kalle 02.11.2026). Den größten Teil des
  // Abends wird gespielt, nicht gekämpft.
  const ruhe = !kurz && kampfRuheJetzt(s, mine, isMyTurn);
  App.kampfRuhe = ruhe;
  const cardPanel = kurz
    ? zugPanelHtml(mine, { hints, timer, angeschlagenHinweis, anfragen: playerQuickControls(mine) })
    : ruhe ? ruhePanelHtml(s, mine)
    : mine.benched
    ? `<div class="panel benched-note" style="padding:16px; text-align:center">
         <div style="font-size:1.6rem">⏸</div>
         <div style="font-weight:600; margin-top:4px">Du bist gerade nicht im Kampf.</div>
         <div class="muted small" style="margin-top:4px">Der Spielleiter nimmt dich wieder rein (z. B. zum Rundenende). Solange bekommst du keine Karten.</div>
       </div>`
    : `<div class="panel" style="padding:12px">
      <div class="karten-buehne"><div class="big-card tilt3d" id="bigcard" style="max-width:250px">${cardSlot(mine.id, mine.card, mine.status, "", { open: !!mine.revealed, tappable: !mine.revealed })}</div>
      ${hints ? `<div class="karten-hinweise">${hints}</div>` : ""}
      ${timer ? `<div class="karten-uhr">${timer}</div>` : ""}</div>
      ${angeschlagenHinweis}
      ${playerQuickControls(mine)}
    </div>`;

  // Die Initiative-Reihenfolge erst zeigen, wenn die EIGENE Karte offen ist.
  // Sonst sieht man vor dem Antippen schon die Plaetze der Gegner (deren Karten
  // gelten beim Austeilen sofort als aufgedeckt) und der eigene Aufdeck-Moment
  // verpufft. Ohne Karte (vor dem Austeilen) oder pausiert gibt es nichts zu
  // verraten -> normal anzeigen. Waehrend der Aufdeck-Animation ist das Rendern
  // gesperrt; die Liste erscheint also erst, wenn die Karte fertig liegt.
  const reihenfolgeGesperrt = !mine.benched && !!mine.card && !mine.revealed;
  const orderPanel = renderOrderPanel(false, reihenfolgeGesperrt);

  // Reihenfolge: Eigene Karte → Reihenfolge → Kampfzonen → Aktionen → Zustände.
  // Schmale Leiste, die beim Scrollen oben stehen bleibt: „wer ist dran" war
  // sonst nur ganz oben zu sehen - bei langer Seite scrollt man daran vorbei.
  // Ist man selbst dran, wird sie zum goldenen Balken; der zweite große
  // „Du bist dran!"-Balken darunter sagte dasselbe nochmal und kostete Platz.
  // Kommt man als Nächstes, sagt die Leiste das zuerst und hebt sich ab - das
  // übernimmt den früheren Kasten „Gleich bist du dran" unter der Karte.
  const leisteText = werDran || (s.phase === "gate" ? "Warte auf den Spielleiter …" : "");
  // Auch ohne Text (kurz zwischen zwei Zügen) bleibt die Leiste stehen, mit
  // fester Höhe für alle Zustände - sonst schob jeder Wechsel „X ist dran" →
  // „Gleich bist du dran" → „Du bist dran!" die Karte um 20 px (Messung 15.11.).
  const dranLeiste = s.round && (leisteText || !ruhe)
    ? `<div class="dran-leiste${isMyTurn ? " ich" : binNaechster ? " gleich" : ""}">${isMyTurn ? "▶ Du bist dran!"
        : binNaechster ? `⏳ Gleich bist du dran <span class="dl-wer">· ${esc(werDran)}</span>` : esc(leisteText) || "&nbsp;"}</div>`
    : "";

  // Der Daumen-Knopf: EIN großer Knopf unten, immer an derselben Stelle, der
  // das anbietet, was gerade dran ist - Karte aufdecken, erholen, angreifen,
  // eingreifen. Vorher standen bis zu fünf Knöpfe in der Karte verteilt, und
  // wer weiter unten im Bogen war, musste erst zurückscrollen.
  const daumen = daumenKnopf({ mine, isMyTurn, angriffMoeglich, meinAngriff, angriffZiel, ruhe,
    canRecover: canRecover && !recoverGemeldet, recoverFreeBtn, recoverBennyBtn, confirmBtn, holdBtn, angriffBtn });

  // Goldrand um den ganzen Bildschirm, solange man dran ist (Kalle, Variante
  // 3B): die goldene Leiste oben sah man nur, wenn man oben war - wer im Bogen
  // blätterte, merkte nicht, dass er dran ist. Fest, ohne Animation.
  const dranRahmen = isMyTurn ? `<div class="dran-rahmen"></div>` : "";

  // Reiter statt einer langen Seite (Kalle, 11.11.2026, Vorschlag 5): ⚔ Kampf
  // (Karte, Reihenfolge, Zonen), 📜 Bogen, 📝 Notizen, ✉ Post. Vorher stand
  // alles untereinander, Notizen und Nachrichten erst nach Karte + Zonen ganz
  // unten. In der Kurzansicht „Mein Zug" keine Reiter - da zählt nur der Zug.
  const teile = {
    order: orderPanel,
    zones: mine.benched ? "" : renderZonesPanel(),
    bogen: renderBogen(mine),
    msgs: `<div class="panel"><h2>Nachrichten vom Spielleiter</h2>${msgs || `<div class="muted small">Noch keine Nachrichten.</div>`}</div>`,
    notizen: notizenPanelHtml(),
    geld: geldSeiteHtml(),
  };
  const reiterDa = kurz ? [] : handyReiterListe();
  const reiter = reiterDa.includes(App.handyReiter) ? App.handyReiter : "kampf";
  // Keine Zahl „neu" am ✉: jede Nachricht kommt ohnehin als Banner, das man
  // wegtippen muss - eine Zahl danach wäre nur Lärm.
  // Ab fünf Reitern (mit 💰 Geld) Symbol über Wort wie eine App-Leiste: neben-
  // einander passten „Kampf Bogen Geld Notizen Post" auf 320 px nicht mehr.
  const reiterLeiste = reiterDa.length > 1 ? `<div class="handy-reiter${reiterDa.length >= 5 ? " fuenf" : ""}">${reiterDa.map((k) =>
    `<button type="button" class="${k === reiter ? "an" : ""}" data-act="handy-reiter" data-reiter="${k}">${k === "geld" ? geldReiterLabel() : HANDY_REITER[k]}</button>`).join("")}</div>` : "";
  const kampfTeile = kurz ? ["zones"].filter(bereichAn)
    // Ohne Kampf sagen Reihenfolge und Zonen nichts.
    : ruhe ? []
    : handyBereiche().filter((k) => k === "order" || k === "zones").filter(bereichAn);
  // Ohne Reiter (nur Kampf übrig, z. B. alles andere im 🎛 aus) bleibt die
  // Seite wie sie ist.
  const inhalt = reiter === "kampf" ? kampfTeile.map((k) => teile[k]).join("") : teile[reiter];
  // Zustand steht nicht mehr unter dem Namen (der ist jetzt in der festen
  // Kopfleiste) - nur noch, wenn etwas ist: kein „✓ Gesund" als Dauerzeile.
  const zustand = kopfZustand(mine);
  // Schwebt rechts unter der Leiste statt als eigene Zeile: die Zeile kam bei
  // „Angeschlagen" dazu und ging beim Erholen wieder weg - jedes Mal sprang
  // die ganze Karte (Messung 15.11.2026). Im Kampf hängt sie an der festen
  // Leiste oben; ohne Leiste (Ruhe) bleibt sie eine normale Zeile.
  const zustandDa = !(/kz-ok/.test(zustand) || !/class="kz/.test(zustand));
  const zustandSchwebt = zustandDa && !!dranLeiste;
  const zustandZeile = zustandDa && !zustandSchwebt ? `<div class="zustand-zeile">${zustand}</div>` : "";
  const zustandSchweb = zustandSchwebt ? `<div class="zustand-schweb">${zustand}</div>` : "";

  const wuerfelListe = `<datalist id="wuerfel-vorschlaege">${WUERFEL.map((w) => `<option value="${w}">`).join("")}</datalist>`;

  return `
    ${wuerfelListe}
    ${msgBanner}
    ${dranRahmen}
    ${handyKopfHtml(s, mine)}
    ${reiterLeiste || dranLeiste ? `<div class="handy-oben">${reiterLeiste}${dranLeiste}${zustandSchweb}</div>` : ""}
    ${zustandZeile}
    ${reiter === "kampf" ? cardPanel : ""}
    ${inhalt}
    ${daumen}
  `;
}

// --- Zwischen den Kämpfen -------------------------------------------------------
// Kein Kampf (noch keine Karte, oder alle Gegner weg und Runde durch): statt der großen
// Kartenrückseite die eigenen Werte, „Was bisher geschah", Notizen. Vorher
// stand vor dem ersten Austeilen eine Rückseite da, als läge schon eine Karte.
// „🃏 Kampfansicht" holt für diese Runde die Karte zurück (z. B. Verfolgung
// ohne Gegner im Kampf-Panel).
function feindeImKampf(s) {
  return s.combatants.some((c) => c.kind === "npc" && !c.ally && !c.benched && !(c.status || {}).out);
}
function kampfRuheJetzt(s, mine, isMyTurn) {
  if (mine.benched || isMyTurn || s.activeId === mine.id) return false;
  if (mine.card && App.ruheAus === `${s.round}:${mine.card.id}`) return false;
  // Gegner weg, aber die Runde läuft noch (Spieler sind noch dran): dann
  // weiter Kampfansicht - sonst stand „Gleich bist du dran" über „Gerade kein
  // Kampf". Ruhe erst, wenn die Runde durch ist oder der SL abgeräumt hat.
  return !mine.card || (!feindeImKampf(s) && !s.activeId);
}
function ruhePanelHtml(s, mine) {
  const gleichKampf = !mine.card && feindeImKampf(s);
  const prot = typeof protokollListe === "function" && protokollListe().length;
  return `<div class="panel ruhe">
    <div class="ruhe-titel">${gleichKampf ? "⚔ Gleich geht's los – der Spielleiter teilt aus" : "🌤 Gerade kein Kampf"}</div>
    ${funktionAn("boegen") ? `<div class="zk-werte ruhe-werte">${werteKachelnHtml(mine)}</div>` : ""}
    ${wundAbzugHtml(mine)}
    <div class="row ruhe-knoepfe">
      ${prot ? `<button type="button" class="ghost small" data-act="ruhe-protokoll">📜 Was bisher geschah</button>` : ""}
      ${funktionAn("regeln") ? `<button type="button" class="ghost small" data-act="regeln-oeffnen">📖 Regeln</button>` : ""}
      ${mine.card ? `<button type="button" class="ghost small" data-act="ruhe-aus" title="Karte und Reihenfolge für diese Runde zeigen">🃏 Kampfansicht</button>` : ""}
    </div>
    ${playerQuickControls(mine)}
  </div>`;
}

// Eigene Notizen: hängen am Charakter, nur dieses Handy bekommt sie
// (Server: notizen_setzen / meineNotizen). Seit 1.5.36 einzelne Einträge
// {id, text, thema, erledigt} unter Themen-Reitern mit Haken, ✎ und 🗑 -
// vorher EIN Freitextfeld, das sich anfühlte wie eine .txt bearbeiten (Kalle,
// 04.11.2026, aus Varianten gewählt). Alter Text kommt vom Server schon
// zeilenweise zerlegt an (Thema leer = „Sonstiges"). Dazu gewählt: 👥
// Gruppen-Notizen (sehen alle Spieler), Namen-Vorschläge beim Tippen,
// SL-Nachricht „📝 Merken" und 🔎 Suche.
// Eigene: jede Änderung schickt sofort die ganze Liste; bis der Server sie
// zurückmeldet, gilt die eigene Fassung (sonst blitzte nach dem Löschen kurz
// der alte Stand auf). Gruppe: einzelne Schritte (gruppen_notiz), weil dort
// mehrere Handys gleichzeitig schreiben.
const NOTIZ_THEMEN = [["NSC", "👤"], ["Orte", "🗺"], ["Beute", "💰"], ["Offen", "❓"]];
const NOTIZ_GRUPPE = "\u0001gruppe";   // Reiter „👥 Gruppe" (kein echtes Thema)
const NOTIZ_SUCHE_AB = 4;              // ab so vielen Notizen gibt es die 🔎 (oben im Kopf)
// Feste Themen als Linien-Symbol mit leisem Farbton (Studio-Runde Notizen,
// Kalle 16.11.2026, Vorschlag 2): die bunten Emoji sahen je nach Handy anders
// aus und bissen sich mit den Linien-Symbolen vom Rest der App. Eigene Themen
// behalten ihr Emoji (das wählen die Spieler selbst).
const NOTIZ_THEMA_SYMBOL = { NSC: ["user", "#b0652a"], Orte: ["map-pin", "#4f8a5b"], Beute: ["gem", "#b8901a"],
  Offen: ["circle-help", "#8f6cc4"], "\u0001gruppe": ["users", "#2f7f9a"], "": ["tag", "#8a7a60"] };
// Eigene Themen tragen ihr Emoji vorne im Namen („💎 Seelensteine") - so kommt
// es mit jeder Notiz mit, auch bei Gruppen-Notizen auf fremden Handys, ohne
// eigene Themen-Liste auf dem Server.
const NOTIZ_EMOJI_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*)\s*/u;
function notizThemaTeile(thema) {
  if (!thema) return ["📝", "Sonstiges"];
  const fest = NOTIZ_THEMEN.find(([n]) => n === thema);
  if (fest) return [fest[1], thema];
  const m = NOTIZ_EMOJI_RE.exec(thema);
  return m ? [m[1], thema.slice(m[0].length) || m[1]] : ["🏷", thema];
}
function notizIcon(thema) { return notizThemaTeile(thema)[0]; }
function notizThemaName(thema) { return notizThemaTeile(thema)[1]; }
// Nur Text (Platzhalter, Dialoge): feste Themen ohne Emoji, eigene mit.
function notizThemaText(thema) {
  if (thema === NOTIZ_GRUPPE) return "Gruppe";
  return thema in NOTIZ_THEMA_SYMBOL ? notizThemaName(thema) : `${notizIcon(thema)} ${notizThemaName(thema)}`;
}
// Als Chip: Symbol + Name, Farbton über --tc. Klasse th-roh: symboleEinsetzen
// lässt das Emoji eigener Themen in Ruhe (sonst würde „📜 Aufträge" zur Linie,
// „💎 Seelensteine" bliebe bunt - sähe kaputt aus).
function notizThemaHtml(thema, extra = "") {
  const fest = NOTIZ_THEMA_SYMBOL[thema];
  if (fest) return `<span class="th ${extra}" style="--tc:${fest[1]}">${symbolSvg(fest[0])}${esc(notizThemaText(thema))}</span>`;
  return `<span class="th th-roh ${extra}">${notizIcon(thema)} ${esc(notizThemaName(thema))}</span>`;
}
function notizThemaLabel(thema) { return notizThemaHtml(thema); }
// Uhrzeit kurz: heute „20:31", sonst „14.11." (Gruppen-Notizen, Nachrichten).
function zeitKurz(ts) {
  if (!ts) return "";
  const d = new Date(ts), h = new Date();
  const zwei = (n) => String(n).padStart(2, "0");
  return d.toDateString() === h.toDateString() ? `${zwei(d.getHours())}:${zwei(d.getMinutes())}` : `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.`;
}
function notizSpeicherLesen(schluessel, ersatz) {
  try { const w = JSON.parse(localStorage.getItem(schluessel)); return w == null ? ersatz : w; } catch { return ersatz; }
}
function notizSpeicherSchreiben(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch { /* privates Fenster */ }
}
function notizenListe() {
  let liste = (App.state && App.state.meineNotizen) || [];
  if (!Array.isArray(liste)) liste = String(liste).split("\n").filter((z) => z.trim());   // alter Server
  liste = liste.map((e, i) => typeof e === "string" ? { id: `alt${i}`, text: e.trim(), thema: "", erledigt: false } : e);
  if (App.notizenLokal) {
    if (JSON.stringify(App.notizenLokal) !== JSON.stringify(liste)) return App.notizenLokal;
    App.notizenLokal = null;
  }
  return liste;
}
function gruppenNotizen() {
  const l = App.state && App.state.gruppenNotizen;
  return Array.isArray(l) ? l : [];
}
// Eigene und Gruppen-Notizen zusammen, Gruppe markiert (für Anzeige/Suche).
function notizenAlle() {
  return [...notizenListe().map((e) => ({ ...e, gruppe: false })),
          ...gruppenNotizen().map((e) => ({ ...e, gruppe: true }))];
}
function notizFinden(id, gruppe) {
  return (gruppe ? gruppenNotizen() : notizenListe()).find((e) => e.id === id);
}
function notizenSpeichern(liste) {
  App.notizenLokal = liste;
  gmAction({ type: "notizen_setzen", eintraege: liste });
  render();
}
function gruppenNotizSchicken(schritt) { gmAction({ type: "gruppen_notiz", ...schritt }); }
function notizNeueId() { return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
// Themen für die Reiter: die vier festen, dann eigene (benutzte und frisch
// angelegte - die merkt sich das Handy, sonst wäre ein neues Thema ohne
// Eintrag beim nächsten Neuzeichnen wieder weg).
function notizThemenAlle(liste) {
  const eigene = notizSpeicherLesen("notizEigeneThemen", []);
  const namen = NOTIZ_THEMEN.map(([n]) => n);
  [...eigene, ...liste.map((e) => e.thema)].forEach((t) => { if (t && !namen.includes(t)) namen.push(t); });
  return namen;
}
// Text mit markierten Suchtreffern (erst escapen, dann <mark> drumherum).
function notizMarkiert(text, q) {
  if (!q) return esc(text);
  const klein = text.toLowerCase(), ql = q.toLowerCase();
  let aus = "", pos = 0, i;
  while ((i = klein.indexOf(ql, pos)) >= 0) {
    aus += esc(text.slice(pos, i)) + `<mark>${esc(text.slice(i, i + q.length))}</mark>`;
    pos = i + q.length;
  }
  return aus + esc(text.slice(pos));
}
// Mehrzeiliger Eintrag: erste Zeile fett (z. B. „Rask" und darunter, was man
// über ihn weiß).
function notizTextHtml(text, q) {
  const [kopf, ...rest] = text.split("\n");
  return rest.length
    ? `<span class="ztitel">${notizMarkiert(kopf, q)}</span><span class="zrest">${notizMarkiert(rest.join("\n"), q)}</span>`
    : notizMarkiert(kopf, q);
}
// --- ✨ Namen beim Tippen ------------------------------------------------------
// Namen aus Charakteren und freigegebenen Protokollen (Server, einmal geholt)
// plus großgeschriebene Wörter aus den eigenen/Gruppen-Notizen. Beim Tippen
// des letzten Worts ab 2 Buchstaben bis zu 4 Vorschläge - antippen ersetzt
// das Wort, richtig geschrieben („Rask" statt „Rsk"/„rask").
function notizNamenHolen() {
  if (App.notizNamen || App.notizNamenLaedt) return;
  App.notizNamenLaedt = true;
  fetch("/api/notiz-namen", { cache: "no-store" }).then((r) => r.json())
    .then((l) => { App.notizNamen = Array.isArray(l) ? l : []; })
    .catch(() => { App.notizNamenLaedt = false; });
}
function notizNamenVorschlaege(text) {
  const m = /([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*)$/.exec(text || "");
  if (!m || m[1].length < 2) return [];
  const wort = m[1].toLowerCase();
  const aus = new Map();
  const dazu = (n) => { const k = n.toLowerCase(); if (k.startsWith(wort) && k !== wort && !aus.has(k)) aus.set(k, n); };
  (App.notizNamen || []).forEach(dazu);
  notizenAlle().forEach((e) => (e.text.match(/\b[A-ZÄÖÜ][a-zäöüß]{2,}(?:-[A-ZÄÖÜ]?[a-zäöüß]+)*/g) || []).forEach(dazu));
  return [...aus.values()].slice(0, 4);
}
function notizVorschlagHtml(feld, text) {
  const l = notizNamenVorschlaege(text);
  return l.length ? `<span class="notiz-vtitel">✨</span>${l.map((n) =>
    `<button type="button" class="notiz-vchip" data-act="notiz-name" data-feld="${feld}" data-name="${esc(n)}">${esc(n)}</button>`).join("")}` : "";
}
function notizVorschlagZeigen(feld, text) {
  const box = $(`notiz-vorschlag-${feld}`);
  if (box) box.innerHTML = notizVorschlagHtml(feld, text);
}
// --- Ansicht ---------------------------------------------------------------------
function notizZeileHtml(e, mitThema, q) {
  const ed = App.notizEdit;
  const g = e.gruppe ? "1" : "";
  if (ed && ed.id === e.id && ed.gruppe === e.gruppe) {
    const chips = notizThemenAlle(notizenAlle()).concat([""]).map((t) =>
      `<button type="button" class="notiz-chip${ed.thema === t ? " on" : ""}" data-act="notiz-edit-thema" data-thema="${esc(t)}">${notizThemaLabel(t)}</button>`).join("");
    const h = App.notizHoehe && App.notizHoehe["notiz-edit"];
    return `<li class="zeile bearbeiten" data-id="${esc(e.id)}">
      <textarea id="notiz-edit" rows="2" maxlength="1000" aria-label="Notiz bearbeiten"${h ? ` style="height:${h}px"` : ""}>${esc(ed.text)}</textarea>
      <div class="notiz-vorschlag" id="notiz-vorschlag-edit">${notizVorschlagHtml("edit", ed.text)}</div>
      <div class="notiz-chips klein">${chips}</div>
      <div class="notiz-edit-knoepfe">
        <button type="button" class="ghost small notiz-del" data-act="notiz-loeschen" data-id="${esc(e.id)}" data-gruppe="${g}">🗑 Löschen</button>
        <button type="button" class="ghost small" data-act="notiz-abbrechen">Abbrechen</button>
        <button type="button" class="primary small" data-act="notiz-fertig">✓ Fertig</button>
      </div>
    </li>`;
  }
  const id = esc(e.id);
  const daten = `data-id="${id}" data-gruppe="${g}"`;
  // Keine ✎/🗑 je Zeile mehr (Studio-Runde Notizen, 16.11.2026): Tipp auf den
  // Text bearbeitet, Löschen steht im Bearbeiten-Modus. Die Zeile gehört dem Text.
  const tags = [mitThema && e.thema ? notizThemaHtml(e.thema, "ttag") : "",
    mitThema && e.gruppe ? notizThemaHtml(NOTIZ_GRUPPE, "ttag nur-symbol") : ""].filter(Boolean);
  const wer = e.gruppe && e.von
    ? `<span class="wer"><span class="wer-av">${esc(zoneInitials(e.von))}</span>${esc(e.von)}${e.ts ? ` · ${zeitKurz(e.ts)}` : ""}</span>` : "";
  return `<li class="zeile${e.erledigt ? " erl" : ""}${e.gruppe ? " gruppe" : ""}" data-id="${id}">
    <button type="button" class="haken" data-act="notiz-haken" ${daten} role="checkbox" aria-checked="${!!e.erledigt}" aria-label="Erledigt">${e.erledigt ? "✓" : ""}</button>
    <div class="zt" data-act="notiz-bearbeiten" ${daten} role="button" aria-label="Bearbeiten">${notizTextHtml(e.text, q)}${tags.length ? ` ${tags.join(" ")}` : ""}${wer}</div>
  </li>`;
}
function notizFilterJetzt() {
  const f = App.notizFilter !== undefined ? App.notizFilter : notizSpeicherLesen("notizFilter", null);
  return f === undefined ? null : f;
}
function notizZielGruppe() {
  return notizFilterJetzt() === NOTIZ_GRUPPE || App.notizZiel === "gruppe";
}
function notizenPanelHtml() {
  const alle = notizenAlle();
  const themen = notizThemenAlle(alle);
  let filter = notizFilterJetzt();
  if (filter !== null && filter !== "" && filter !== NOTIZ_GRUPPE && !themen.includes(filter)) filter = null;
  const q = App.notizSuche != null ? App.notizSuche.trim() : "";
  const offenZahl = (pruef) => alle.filter((e) => pruef(e) && !e.erledigt).length;
  // Reiter: „Alle", „👥 Gruppe" + Themen (Kalle wählte Reiter statt Gruppen,
  // 04.11.2026). Der gewählte Reiter filtert die Liste UND ist das Thema für
  // die nächste neue Notiz - so landet sie gleich dort, wo man hinschaut.
  const reiter = (t, label, an) =>
    `<button type="button" class="notiz-reiter${an ? " on" : ""}" data-act="notiz-filter" data-thema="${t === null ? "*" : esc(t)}">${label}</button>`;
  const zahl = (n) => n ? ` <b>${n}</b>` : "";
  const reiterHtml = [reiter(null, `Alle${zahl(offenZahl(() => true))}`, filter === null),
    reiter(NOTIZ_GRUPPE, `${notizThemaHtml(NOTIZ_GRUPPE)}${zahl(offenZahl((e) => e.gruppe))}`, filter === NOTIZ_GRUPPE),
    ...themen.map((t) => reiter(t, `${notizThemaHtml(t)}${zahl(offenZahl((e) => e.thema === t))}`, filter === t)),
    ...(alle.some((e) => !e.thema) ? [reiter("", `${notizThemaHtml("")}${zahl(offenZahl((e) => !e.thema))}`, filter === "")] : []),
    `<button type="button" class="notiz-reiter neu" data-act="notiz-thema-neu" aria-label="Neues Thema" title="Neues Thema">＋</button>`].join("");
  // 🔎 oben rechts im Kopf (nicht mehr als Chip in der Reiterzeile).
  const suchKnopf = alle.length >= NOTIZ_SUCHE_AB
    ? `<button type="button" class="notiz-such${App.notizSuche != null ? " on" : ""}" data-act="${App.notizSuche != null ? "notiz-suche-zu" : "notiz-suche-auf"}" aria-label="Suchen" title="Suchen">🔍</button>` : "";
  // Suche: über alle Themen und die Gruppe, Abgehakte gleich mit aufgeklappt.
  const sicht = q ? alle.filter((e) => `${e.text}\n${e.thema}\n${e.von || ""}`.toLowerCase().includes(q.toLowerCase()))
    : filter === null ? alle
    : filter === NOTIZ_GRUPPE ? alle.filter((e) => e.gruppe)
    : alle.filter((e) => e.thema === filter);
  const offen = sicht.filter((e) => !e.erledigt), erl = sicht.filter((e) => e.erledigt);
  // Abgehakte zugeklappt (nehmen sonst Platz weg, Kalle 04.11.) - offen nur,
  // wenn angetippt, gesucht oder gerade einer davon bearbeitet wird.
  const erlAuf = q || App.notizErlAuf || (App.notizEdit && erl.some((e) => e.id === App.notizEdit.id));
  const mitThema = !!q || filter === null || filter === NOTIZ_GRUPPE;
  const zeile = (e) => notizZeileHtml(e, mitThema, q);
  const leerText = q ? `Nichts gefunden für „${esc(q)}“.`
    : filter === null ? ""
    : filter === NOTIZ_GRUPPE ? "Noch keine Gruppen-Notiz. Alles hier sehen alle Spieler."
    : `Noch nichts unter ${notizThemaHtml(filter)}.`;
  const inhalt = !sicht.length
    ? `<div class="notizen-leer klein">${leerText}</div>`
    : `${offen.length ? `<ul class="zeilen">${offen.map(zeile).join("")}</ul>`
        : `<div class="notizen-leer klein">Alles abgehakt ✓</div>`}
      ${erl.length ? `<button type="button" class="notiz-erl-kopf" data-act="notiz-erl" aria-expanded="${!!erlAuf}">
          <span>✓ ${erl.length} erledigt</span><span class="pfeil">${erlAuf ? "▾" : "▸"}</span></button>
        ${erlAuf ? `<ul class="zeilen erledigt">${erl.map(zeile).join("")}</ul>` : ""}` : ""}`;
  const weg = App.notizWeg;
  const zielGruppe = notizZielGruppe();
  const thema = filter === null || filter === NOTIZ_GRUPPE ? "" : filter;
  const h = App.notizNeu && App.notizHoehe && App.notizHoehe["notiz-neu"];
  const platzhalter = zielGruppe ? `Für alle${thema ? ` unter ${esc(notizThemaText(thema))}` : ""} …`
    : thema ? `Neu unter ${esc(notizThemaText(thema))} …` : "Neue Notiz …";
  // Eingabe als Komposer (Vorschlag 3): ein Feld, darunter „Nur ich | Für alle"
  // in Worten (das 🔒 allein verstand ohne Erklärung keiner) und ein runder
  // ↑-Knopf. Im Gruppe-Reiter ist „Für alle" fest.
  const imGruppenReiter = filter === NOTIZ_GRUPPE;
  return `<div class="panel notizen">
    <div class="notizen-kopf"><h2>📝 Notizen</h2>${alle.length ? `<span class="notizen-zahl">${offenZahl(() => true)}</span>` : ""}${suchKnopf}</div>
    <div class="notiz-neu${zielGruppe ? " gruppe" : ""}">
      <textarea id="notiz-neu" rows="1" maxlength="1000" enterkeyhint="done" aria-label="Neue Notiz"${h ? ` style="height:${h}px"` : ""}
        placeholder="${platzhalter}">${esc(App.notizNeu || "")}</textarea>
      <div class="notiz-neu-fuss">
        <span class="notiz-seg" role="group" aria-label="Für wen">
          <button type="button" class="${zielGruppe ? "" : "on"}" data-act="notiz-ziel" data-ziel="ich"${imGruppenReiter ? " disabled" : ""} title="Nur du siehst diese Notiz">🔒 Nur ich</button>
          <button type="button" class="${zielGruppe ? "on" : ""}" data-act="notiz-ziel" data-ziel="gruppe" title="Alle Spieler sehen und ändern diese Notiz">👥 Für alle</button>
        </span>
        <button type="button" class="primary notiz-plus" data-act="notiz-hinzu" aria-label="Notiz hinzufügen" title="Hinzufügen"${(App.notizNeu || "").trim() ? "" : " disabled"}>${symbolSvg("arrow-up")}</button>
      </div>
    </div>
    <div class="notiz-vorschlag" id="notiz-vorschlag-neu">${notizVorschlagHtml("neu", App.notizNeu)}</div>
    ${App.notizSuche != null
      ? `<div class="notiz-suche">🔍<input id="notiz-suche" type="text" enterkeyhint="search" value="${esc(App.notizSuche)}" placeholder="In allen Notizen suchen …" aria-label="Suchen" autocomplete="off">
          <button type="button" class="notiz-knopf" data-act="notiz-suche-zu" aria-label="Suche schließen">✕</button></div>`
      : `<div class="notiz-reiter-leiste">${reiterHtml}</div>`}
    ${weg ? `<div class="notiz-undo"><span>Notiz gelöscht</span><button type="button" class="ghost small" data-act="notiz-zurueck">↶ Rückgängig</button></div>` : ""}
    ${alle.length ? inhalt
      : `<div class="notizen-leer">Noch nichts notiert.<br><span>NSC-Namen, Orte, Beute, offene Fragen. 🔒 nur du, 👥 alle Spieler.</span></div>`}
  </div>`;
}
// Feld wächst mit dem Text (rows="1" sah sonst nach einer Zeile aus, auch wenn
// drei drinstanden). field-sizing kann Safari noch nicht. Die Höhe merken und
// ins HTML schreiben - sonst setzte das Neuzeichnen das Feld wieder auf klein.
function notizFeldHoehe(el) {
  if (!el) return;
  el.style.height = "auto";
  const h = el.scrollHeight + 2;
  el.style.height = `${h}px`;
  App.notizHoehe = { ...(App.notizHoehe || {}), [el.id]: h };
}
// --- Ändern ------------------------------------------------------------------------
function notizHinzu() {
  const text = (App.notizNeu || "").trim();
  if (!text) return;
  App.notizNeu = "";
  const feld = $("notiz-neu");
  if (feld) { feld.value = ""; notizFeldHoehe(feld); }
  notizVorschlagZeigen("neu", "");
  const f = notizFilterJetzt();
  const thema = f === null || f === NOTIZ_GRUPPE ? "" : f;
  const eintrag = { id: notizNeueId(), text, thema, erledigt: false };
  // Neueste oben: das Eingabefeld steht oben, der Eintrag erscheint gleich darunter.
  if (notizZielGruppe()) {
    // 👥 gilt nur für diese eine Notiz - sonst landete die nächste private
    // Notiz versehentlich bei allen.
    App.notizZiel = "ich";
    gruppenNotizSchicken({ op: "neu", eintrag });
    render();
    return;
  }
  notizenSpeichern([eintrag, ...notizenListe()]);
}
function notizFertig() {
  const ed = App.notizEdit;
  if (!ed) return;
  App.notizEdit = null;
  const text = ed.text.trim();
  const alt = notizFinden(ed.id, ed.gruppe);
  if (!alt) { render(); return; }
  if (!text) { notizLoeschen(ed.id, ed.gruppe); return; }      // leer gespeichert = löschen (mit Rückfrage)
  if (alt.text === text && alt.thema === ed.thema) { render(); return; }
  if (ed.gruppe) { gruppenNotizSchicken({ op: "aendern", id: ed.id, text, thema: ed.thema }); render(); return; }
  notizenSpeichern(notizenListe().map((e) => e.id === ed.id ? { ...e, text, thema: ed.thema } : e));
}
// Löschen mit Rückfrage (Kalle, 09.11.2026 - erst ging es ohne, nur mit
// „↶ Rückgängig"; das übersieht man am Handy aber leicht, und eine
// Gruppennotiz ist dann für alle weg). Das Rückgängig bleibt trotzdem als
// zweites Netz. Danach frisch suchen: während der Rückfrage kann die Liste
// sich geändert haben (Gruppennotizen kommen vom Server).
async function notizLoeschen(id, gruppe) {
  const vorher = notizFinden(id, gruppe);
  if (!vorher) return;
  const kurz = vorher.text.length > 80 ? `${vorher.text.slice(0, 80).trimEnd()} …` : vorher.text;
  const ok = await frage(`Notiz löschen?\n\n„${kurz}“${gruppe ? "\n\n👥 Gruppennotiz – sie verschwindet für alle." : ""}`, "Löschen", true);
  if (!ok) { render(); return; }
  const liste = gruppe ? gruppenNotizen() : notizenListe();
  const i = liste.findIndex((e) => e.id === id);
  if (i < 0) { render(); return; }
  if (App.notizEdit && App.notizEdit.id === id) App.notizEdit = null;
  clearTimeout(App.notizWegTimer);
  App.notizWeg = { eintrag: liste[i], i, gruppe };
  App.notizWegTimer = setTimeout(() => { App.notizWeg = null; render(); }, 7000);
  if (gruppe) { gruppenNotizSchicken({ op: "loeschen", id }); render(); return; }
  notizenSpeichern(liste.filter((e) => e.id !== id));
}
// 💬 SL-Nachricht als eigene Notiz merken (Thema „Offen").
function notizAusNachricht(msgId) {
  const m = ((App.state && App.state.messages) || []).find((x) => x.id === msgId);
  if (!m || !m.text || notizenListe().some((e) => e.quelle === msgId)) return;
  notizenSpeichern([{ id: notizNeueId(), text: m.text.trim().slice(0, 1000), thema: "Offen", erledigt: false, quelle: msgId },
    ...notizenListe()]);
}
function nachrichtGemerkt(msgId) { return notizenListe().some((e) => e.quelle === msgId); }
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === "notiz-neu") {
    App.notizNeu = t.value;
    notizFeldHoehe(t);
    notizVorschlagZeigen("neu", t.value);
    const plus = document.querySelector('[data-act="notiz-hinzu"]');
    if (plus) plus.disabled = !t.value.trim();
  } else if (t.id === "notiz-edit" && App.notizEdit) {
    App.notizEdit.text = t.value;
    notizFeldHoehe(t);
    notizVorschlagZeigen("edit", t.value);
  } else if (t.id === "notiz-suche") {
    App.notizSuche = t.value;
    render();
  }
});
document.addEventListener("focusin", (e) => {
  if (e.target && (e.target.id === "notiz-neu" || e.target.id === "notiz-edit")) notizNamenHolen();
});
// Vorschlag antippen soll das Feld nicht verlassen (sonst klappt am Handy
// die Tastatur zu und wieder auf).
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest && e.target.closest(".notiz-vchip")) e.preventDefault();
});
document.addEventListener("keydown", (e) => {
  if (!e.target || e.isComposing) return;
  // Neue Notiz: Enter = hinzufügen (Handy-Tastatur „Fertig"), Umschalt+Enter = neue Zeile.
  if (e.target.id === "notiz-neu" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); notizHinzu(); }
  // Beim Bearbeiten ist Enter eine neue Zeile (Überschrift + Details);
  // Strg/⌘+Enter speichert, Esc bricht ab.
  if (e.target.id === "notiz-edit") {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); notizFertig(); }
    else if (e.key === "Escape") { e.preventDefault(); App.notizEdit = null; render(); }
  }
  if (e.target.id === "notiz-suche" && e.key === "Escape") { App.notizSuche = null; render(); }
});
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || !t.dataset.act.startsWith("notiz-")) return;
  e.preventDefault();
  const id = t.dataset.id;
  const gruppe = t.dataset.gruppe === "1";
  const thema = t.dataset.thema;
  switch (t.dataset.act) {
    case "notiz-hinzu": notizHinzu(); break;
    case "notiz-filter":
      if (App.notizLangGedrueckt) { App.notizLangGedrueckt = false; break; }
      App.notizFilter = thema === "*" ? null : thema;
      notizSpeicherSchreiben("notizFilter", App.notizFilter);
      render();
      break;
    case "notiz-ziel":
      App.notizZiel = t.dataset.ziel || (App.notizZiel === "gruppe" ? "ich" : "gruppe");
      render();
      break;
    case "notiz-thema-neu": {
      const neu = await notizThemaDialog("");
      if (neu && neu.thema) notizThemaWaehlen(neu.thema);
      break;
    }
    case "notiz-tm-emoji": {
      const f = document.getElementById("tm-emoji");
      if (f) f.value = t.dataset.emoji;
      document.querySelectorAll(".tm-emojis button").forEach((b) => b.classList.toggle("on", b === t));
      break;
    }
    case "notiz-tm-vorschlag": {
      const [emo, name] = [t.dataset.emoji, t.dataset.name];
      if (document.getElementById("tm-emoji")) document.getElementById("tm-emoji").value = emo;
      if (document.getElementById("tm-name")) document.getElementById("tm-name").value = name;
      document.querySelectorAll(".tm-emojis button").forEach((b) => b.classList.toggle("on", b.dataset.emoji === emo));
      break;
    }
    case "notiz-suche-auf":
      App.notizSuche = "";
      render();
      if ($("notiz-suche")) $("notiz-suche").focus();
      break;
    case "notiz-suche-zu": App.notizSuche = null; render(); break;
    case "notiz-erl":
      App.notizErlAuf = !App.notizErlAuf;
      render();
      break;
    case "notiz-haken": {
      const n = notizFinden(id, gruppe);
      if (!n) break;
      if (gruppe) { gruppenNotizSchicken({ op: "aendern", id, erledigt: !n.erledigt }); break; }
      notizenSpeichern(notizenListe().map((x) => x.id === id ? { ...x, erledigt: !x.erledigt } : x));
      break;
    }
    case "notiz-bearbeiten": {
      if (App.notizEdit && (App.notizEdit.id !== id || App.notizEdit.gruppe !== gruppe)) notizFertig();   // anderes offen -> erst speichern
      const n = notizFinden(id, gruppe);
      if (!n) break;
      App.notizEdit = { id, gruppe, text: n.text, thema: n.thema };
      if (App.notizHoehe) delete App.notizHoehe["notiz-edit"];
      render();
      const feld = $("notiz-edit");
      if (feld) {
        notizFeldHoehe(feld);
        feld.focus();
        feld.setSelectionRange(feld.value.length, feld.value.length);
      }
      break;
    }
    case "notiz-edit-thema":
      if (App.notizEdit) { App.notizEdit.thema = thema; render(); }
      break;
    case "notiz-name": {
      // Letztes (angefangenes) Wort durch den Namen ersetzen.
      const feld = $(`notiz-${t.dataset.feld}`);
      if (!feld) break;
      feld.value = feld.value.replace(/([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*)$/, t.dataset.name) + " ";
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      feld.focus();
      feld.setSelectionRange(feld.value.length, feld.value.length);
      break;
    }
    case "notiz-merken": notizAusNachricht(id); break;
    case "notiz-fertig": notizFertig(); break;
    case "notiz-abbrechen": App.notizEdit = null; render(); break;
    case "notiz-loeschen": notizLoeschen(id, gruppe); break;
    case "notiz-zurueck": {
      const weg = App.notizWeg;
      if (!weg) break;
      clearTimeout(App.notizWegTimer);
      App.notizWeg = null;
      if (weg.gruppe) { gruppenNotizSchicken({ op: "neu", eintrag: weg.eintrag, index: weg.i }); render(); break; }
      const liste = notizenListe().slice();
      liste.splice(Math.min(weg.i, liste.length), 0, weg.eintrag);
      notizenSpeichern(liste);
      break;
    }
  }
});
// --- Eigene Themen: Emoji + Name (Kalle 04.11.2026) -------------------------------
// Fertige Vorschläge für Sundered Skies zum Antippen, dazu ein Emoji-Raster;
// eigenes Emoji geht über die Handy-Tastatur im kleinen Feld.
const NOTIZ_THEMA_VORSCHLAEGE = [["💎", "Seelensteine"], ["⚓", "Schiff"], ["📜", "Aufträge"], ["🏴‍☠️", "Fraktionen"],
  ["⚔️", "Feinde"], ["🤝", "Kontakte"], ["🐉", "Kreaturen"], ["🔮", "Magie"], ["🗝️", "Geheimnisse"], ["🧭", "Routen"]];
const NOTIZ_EMOJIS = ["💎", "⚓", "📜", "🏴‍☠️", "⚔️", "🛡️", "🏰", "🐉", "👑", "💀", "🔮", "🗝️",
  "🧪", "🌋", "🌊", "🌲", "🤝", "⚠️", "⭐", "🎯", "🧭", "🍺", "🐾", "✏️"];
function notizThemaDialog(alt) {
  const [altEmoji, altName] = alt ? notizThemaTeile(alt) : ["", ""];
  const vorhanden = new Set(notizThemenAlle(notizenAlle()).map((t) => notizThemaName(t).toLowerCase()));
  const vorschlaege = alt ? [] : NOTIZ_THEMA_VORSCHLAEGE.filter(([, n]) => !vorhanden.has(n.toLowerCase()));
  const inhalt = `
    ${vorschlaege.length ? `<div class="tm-titel">Vorschläge</div><div class="tm-vorschlaege">${vorschlaege.map(([emo, n]) =>
      `<button type="button" class="notiz-chip" data-act="notiz-tm-vorschlag" data-emoji="${emo}" data-name="${esc(n)}">${emo} ${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="tm-zeile">
      <input id="tm-emoji" class="tm-emoji" maxlength="8" value="${esc(altEmoji === "🏷" ? "" : altEmoji)}" placeholder="🏷" aria-label="Emoji" autocomplete="off">
      <input id="tm-name" maxlength="24" value="${esc(alt ? altName : "")}" placeholder="Name, z. B. Seelensteine" aria-label="Name" autocomplete="off">
    </div>
    <div class="tm-emojis">${NOTIZ_EMOJIS.map((emo) =>
      `<button type="button" class="${emo === altEmoji ? "on" : ""}" data-act="notiz-tm-emoji" data-emoji="${emo}">${emo}</button>`).join("")}</div>
    <div class="tm-hinweis">Eigenes Emoji: kleines Feld antippen, Emoji-Tastatur.</div>`;
  const knoepfe = [{ text: "Abbrechen", wert: null, abbruch: true },
    // „abbruch", damit der Knopf seinen Wert liefert statt lesen() - Esc nimmt
    // trotzdem den ersten (Abbrechen).
    ...(alt ? [{ text: "🗑 Löschen", art: "ghost tm-loeschen", wert: "loeschen", abbruch: true }] : []),
    { text: alt ? "Speichern" : "Anlegen", art: "primary", standard: true }];
  return dialog({ text: alt ? "Thema ändern" : "Neues Thema", inhalt, knoepfe,
    lesen: (box) => {
      const emo = (box.querySelector("#tm-emoji").value || "").trim();
      const name = (box.querySelector("#tm-name").value || "").replace(/\s+/g, " ").trim();
      const nurEmoji = NOTIZ_EMOJI_RE.exec(emo);
      const thema = name ? `${nurEmoji ? nurEmoji[1] + " " : ""}${name}`.slice(0, 30) : "";
      return { thema };
    } }).then((w) => w === "loeschen" ? { loeschen: true } : w);
}
function notizThemaWaehlen(thema) {
  // Gibt es das Thema schon in anderer Schreibweise („nsc" neben „NSC")? Dann
  // das vorhandene nehmen - sonst standen zwei Reiter für dasselbe da.
  const klein = (t) => notizThemaName(t).trim().toLowerCase();
  const gleich = notizThemenAlle(notizenAlle()).find((t) => klein(t) === klein(thema));
  if (gleich) thema = gleich;
  notizSpeicherSchreiben("notizEigeneThemen", [...new Set([...notizSpeicherLesen("notizEigeneThemen", []), thema])]);
  App.notizFilter = thema;
  notizSpeicherSchreiben("notizFilter", thema);
  render();
}
// Thema umbenennen (neu) oder löschen (neu = ""): eigene Notizen in einem
// Rutsch, Gruppen-Notizen Schritt für Schritt (nur die mit diesem Thema).
function notizThemaUmstellen(alt, neu) {
  const eigene = notizenListe();
  if (eigene.some((e) => e.thema === alt)) notizenSpeichern(eigene.map((e) => e.thema === alt ? { ...e, thema: neu } : e));
  gruppenNotizen().filter((e) => e.thema === alt).forEach((e) => gruppenNotizSchicken({ op: "aendern", id: e.id, thema: neu }));
  const liste = notizSpeicherLesen("notizEigeneThemen", []).filter((t) => t !== alt);
  notizSpeicherSchreiben("notizEigeneThemen", neu ? [...new Set([...liste, neu])] : liste);
  App.notizFilter = neu || null;
  notizSpeicherSchreiben("notizFilter", App.notizFilter);
  render();
}
async function notizThemaBearbeiten(alt) {
  if (!alt || NOTIZ_THEMEN.some(([n]) => n === alt)) return;     // feste Themen bleiben
  // Langes Drücken UND Kontextmenü (Android schickt beides) -> nur einmal.
  if (App.notizThemaOffen) return;
  App.notizThemaOffen = true;
  let w;
  try { w = await notizThemaDialog(alt); } finally { App.notizThemaOffen = false; }
  if (!w) return;
  if (w.loeschen) {
    const n = notizenAlle().filter((e) => e.thema === alt).length;
    if (n && !await frage(`Thema „${notizThemaName(alt)}“ löschen?\n\nDie ${n} Notiz${n === 1 ? "" : "en"} bleiben, unter 📝 Sonstiges.`, "Löschen", true)) return;
    notizThemaUmstellen(alt, "");
  } else if (w.thema && w.thema !== alt) notizThemaUmstellen(alt, w.thema);
}
// Lange drücken (Handy) oder Rechtsklick auf einen eigenen Reiter: ändern/löschen.
document.addEventListener("contextmenu", (e) => {
  const t = e.target.closest && e.target.closest('.notiz-reiter[data-act="notiz-filter"]');
  if (!t || !t.dataset.thema || t.dataset.thema === "*" || t.dataset.thema === NOTIZ_GRUPPE) return;
  e.preventDefault();
  notizThemaBearbeiten(t.dataset.thema);
});
document.addEventListener("pointerdown", (e) => {
  const t = e.target.closest && e.target.closest('.notiz-reiter[data-act="notiz-filter"]');
  clearTimeout(App.notizDrueckTimer);
  const th = t && t.dataset.thema;
  if (!t || e.pointerType === "mouse" || !th || th === "*" || th === NOTIZ_GRUPPE || NOTIZ_THEMEN.some(([n]) => n === th)) return;
  App.notizDrueckTimer = setTimeout(() => { App.notizLangGedrueckt = true; notizThemaBearbeiten(t.dataset.thema); }, 550);
});
["pointerup", "pointercancel", "pointermove"].forEach((art) => document.addEventListener(art, (e) => {
  if (art === "pointermove" && Math.abs(e.movementX) + Math.abs(e.movementY) < 4) return;
  clearTimeout(App.notizDrueckTimer);
}));

// Neuladen/Wegwischen mitten im Tippen: Halbfertiges nicht verlieren. Offene
// Bearbeitung und Text im „Neue Notiz"-Feld werden beim Verstecken der Seite
// gespeichert (focusout feuert beim Neuladen nicht zuverlässig).
function notizenSichern() {
  if (App.notizEdit) notizFertig();
  if ((App.notizNeu || "").trim()) notizHinzu();
}
window.addEventListener("pagehide", notizenSichern);
document.addEventListener("visibilitychange", () => { if (document.hidden) notizenSichern(); });
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  if (t.dataset.act === "ruhe-aus") {
    e.preventDefault();
    const mine = myCombatant();
    if (mine && mine.card) App.ruheAus = `${App.state.round}:${mine.card.id}`;
    render();
  } else if (t.dataset.act === "ruhe-protokoll") {
    e.preventDefault();
    Prot.offen = true;
    Prot.wasBisher = true;
    protokollOeffnen();
    render();
  }
});

// Reihenfolge der Bereiche unter der Karte - jeder Spieler stellt sie im ⚙
// selbst ein (Kalle, 25.10.2026), gemerkt auf dem Handy. Standard: Bogen nach
// unten, im Kampf braucht man zuerst Reihenfolge und Zonen.
const HANDY_BEREICHE = { order: "Initiative-Reihenfolge", zones: "Kampfzonen", bogen: "Mein Charakter", msgs: "Nachrichten", notizen: "Notizen" };
// 🎛 Bereiche, die der SL ausgeschaltet hat, gar nicht erst bauen. Die eigene
// Reihenfolge bleibt gemerkt - beim Wiedereinschalten steht alles wie vorher.
const BEREICH_FUNKTION = { zones: "zonen", bogen: "boegen", msgs: "nachrichten", notizen: "notizen", geld: "geld" };
function bereichAn(k) { return !BEREICH_FUNKTION[k] || funktionAn(BEREICH_FUNKTION[k]); }
function handyBereiche() {
  let liste = [];
  try { liste = JSON.parse(localStorage.getItem("handyBereiche") || "[]"); } catch { /* egal */ }
  liste = (Array.isArray(liste) ? liste : []).filter((k) => HANDY_BEREICHE[k]);
  // Neue Bereiche (spätere Versionen) hinten anhängen statt sie zu verlieren.
  ["order", "zones", "bogen", "msgs", "notizen"].forEach((k) => { if (!liste.includes(k)) liste.push(k); });
  return liste;
}
// Die Reiter in fester Reihenfolge; was der SL im 🎛 ausgeschaltet hat, fehlt.
// 💰 Geld seit 18.11.2026 (Kalle wählte den eigenen Reiter statt „unter Notizen").
const HANDY_REITER = { kampf: "⚔ Kampf", bogen: "📜 Bogen", geld: "Geld", notizen: "📝 Notizen", msgs: "✉ Post" };
function handyReiterListe() {
  return Object.keys(HANDY_REITER).filter((k) => k === "kampf" || bereichAn(k));
}

// Feste Kopfleiste (Kalle, 11.11.2026, Variante 2C): Bild, Name, Bennies und
// Runde stehen beim Scrollen immer oben. Vorher schwebte nur die „Verbunden"-
// Pille über dem Inhalt, und darunter schien beim Scrollen alles durch. Die
// Verbindung zeigt jetzt der Punkt am Bild; die Pille kommt nur bei Ärger
// (Verbinde neu …) unter der Leiste hervor.
function handyKopfHtml(s, mine) {
  return `<div class="handy-kopf">
    <label class="avatar hk-bild" title="Eigenes Bild wählen/ändern">
      ${mine.image ? `<img src="${esc(mine.image)}" alt="">` : esc(zoneInitials(mine.name))}
      <input type="file" accept="image/*" data-act="pick-char-image" data-id="${mine.id}" style="display:none">
      <span class="hk-punkt"></span>
    </label>
    <span class="hk-name">${esc(mine.name)}</span>
    ${muenzenKopf(mine)}
    <span class="hk-rechts">${rundenZaehler(s)}</span>
  </div>`;
}

function handyBereichSchieben(k, dir) {
  const liste = handyBereiche();
  const i = liste.indexOf(k);
  // Ausgeblendete Bereiche (🎛) überspringen - sonst täte „▲" scheinbar nichts.
  let j = i + dir;
  while (j >= 0 && j < liste.length && !bereichAn(liste[j])) j += dir;
  if (i < 0 || j < 0 || j >= liste.length) return;
  [liste[i], liste[j]] = [liste[j], liste[i]];
  try { localStorage.setItem("handyBereiche", JSON.stringify(liste)); } catch { /* privates Fenster */ }
}

// Spieler-Teil des ⚙-Menüs: was man einmal einstellt, aber nicht im Kampf
// braucht. Stand vorher unten auf der Seite (Ton, Rückseite) bzw. als
// „Verlassen" direkt neben „Runde", wo man leicht draufkam.
// Seit 17.11.2026 (AAA-Runde, Vorschlag 1) ein Blatt von unten statt einer
// schmalen Kiste: vorher Häkchen + Emoji + Farbpunkte ohne Namen, und
// „Spiel verlassen" stand mitten zwischen den Einstellungen. Jetzt Gruppen mit
// Schaltern, Rückseiten gleich als Bild-Kacheln, Farben mit Namen, Verlassen
// ganz unten und abgesetzt. Die alten Knöpfe der Kiste (QR, Als App, Farben,
// Aufdecken, Joker) blendet .einst-blatt aus - sie stehen hier neu.
function einstSchalter(act, an, titel, text, extra) {
  return `<label class="es-zeile es-schalter-zeile"><span class="es-t">${titel}<small>${text}</small></span>${extra || ""}
    <span class="es-sch"><input type="checkbox" data-act="${act}"${an ? " checked" : ""} aria-label="${esc(titel)}"><i></i></span></label>`;
}
function spielerMenueHtml(mine) {
  // Seit den Reitern (11.11.2026) gibt es nur noch im ⚔ Kampf etwas zu
  // sortieren: Reihenfolge und Zonen.
  const liste = handyBereiche().filter((k) => k === "order" || k === "zones").filter(bereichAn);
  const zeilen = liste.map((k, i) => `<div class="es-zeile hb-zeile"><span class="es-t">${HANDY_BEREICHE[k]}</span>
      <button type="button" class="st-btn" data-act="bereich-schieben" data-k="${k}" data-dir="-1"${i === 0 ? " disabled" : ""} title="Nach oben" aria-label="Nach oben">▲</button>
      <button type="button" class="st-btn" data-act="bereich-schieben" data-k="${k}" data-dir="1"${i === liste.length - 1 ? " disabled" : ""} title="Nach unten" aria-label="Nach unten">▼</button></div>`).join("");
  const pfeil = symbolSvg("chevron-right");
  const reveal = revealSetting();
  const farben = SKINS.map((k) => `<button type="button" class="es-farbe${App.skin === k ? " an" : ""}" data-skin="${k}" title="${SKIN_NAMES[k]}">
      <i class="skin-${k}"></i><span>${SKIN_KURZ[k]}</span></button>`).join("");
  return `<div class="es-griff" aria-hidden="true"></div>
    <div class="es-kopf"><h3>Einstellungen</h3><button type="button" class="es-zu" data-act="einst-zu" aria-label="Schließen">✕</button></div>
    ${funktionAn("regeln") ? `<div class="es-karte"><button type="button" class="es-zeile es-link" data-act="regeln-oeffnen">${symbolSvg("book-open")}<span class="es-t">Regeln nachschlagen</span>${pfeil}</button></div>` : ""}
    <div class="es-gruppe">Wenn ich dran bin</div>
    <div class="es-karte">
      ${einstSchalter("toggle-notify", localStorage.getItem("notifyTurn") !== "off", kannVibrieren ? "Vibration & Ton" : "Ton",
        "Kurzer Summer, wenn du dran bist",
        `<button type="button" class="es-test" data-act="ton-testen" title="Lautstärke prüfen – am iPhone muss der Lautlos-Schalter aus sein">Test</button>`)}
      ${einstSchalter("toggle-zug-kurz", kurzAnsichtAn(), "Kurzansicht", "Nur deine Werte und Knöpfe")}
      ${einstSchalter("toggle-wach", wachGewollt(), "Bildschirm anlassen", "Solange gekämpft wird")}
    </div>
    <div class="es-gruppe">Karten</div>
    <div class="es-karte">
      ${rueckseiteWahlHtml(mine, true)}
      <label class="es-zeile"><span class="es-t">Aufdecken</span>
        <select class="es-select" aria-label="Aufdecken">${REVEALS.map((r) =>
          `<option value="${r}"${r === reveal ? " selected" : ""}>${REVEAL_NAMES[r]}</option>`).join("")}</select></label>
      <details class="es-zeile es-joker joker-pick" data-merk="einst-joker"${App.offeneUnter.has("einst-joker") ? " open" : ""}>
        <summary><span class="es-t">Joker-Stile</span><span class="es-wert es-jokerzahl">${jokerZahlText()}</span></summary>
        <div class="joker-checks">${Cards.JOKER_STILE.map((st) =>
          `<label><input type="checkbox" data-joker="${st}"${jokerAuswahlLaden().includes(st) ? " checked" : ""}> ${Cards.JOKER_NAMEN[st]}</label>`).join("")}</div>
      </details>
    </div>
    <div class="es-gruppe">Farbe der App</div>
    <div class="es-karte"><div class="es-farben">${farben}</div></div>
    ${liste.length > 1 ? `<div class="es-gruppe">Reihenfolge im Kampf-Reiter</div><div class="es-karte">${zeilen}</div>` : ""}
    <div class="es-gruppe">Mitspieler holen</div>
    <div class="es-karte">
      <button type="button" class="es-zeile es-link" data-act="qr-gross">${symbolSvg("qr-code")}<span class="es-t">QR-Code zeigen<small>Der Nächste scannt von deinem Handy</small></span>${pfeil}</button>
      <button type="button" class="es-zeile es-link" data-act="als-app">${symbolSvg("download")}<span class="es-t">Als App auf den Startbildschirm</span>${pfeil}</button>
    </div>
    <button type="button" class="es-verlassen" data-act="leave">${symbolSvg("log-in")} Spiel verlassen</button>`;
}

// Was der große Knopf unten gerade anbietet - in dieser Reihenfolge: wer
// abwartet, will eingreifen; angeschlagen heißt erst erholen; dann der Zug
// selbst; ansonsten die eigene Karte aufdecken. Nichts zu tun: keine Leiste.
function daumenKnopf(o) {
  const { mine, isMyTurn, angriffMoeglich, meinAngriff, angriffZiel } = o;
  let haupt = "", neben = "", blatt = "", gleich = false, frage = "";
  // Sofort zeigen, dass „Erholt" angekommen ist - nicht erst, wenn der Server
  // antwortet. Vorher blieb der Knopf kurz unverändert, dann stand an GENAU
  // der Stelle „Angreifen": wer nochmal tippte, griff ungewollt an.
  const erholWartet = App.erholGetippt && App.erholGetippt.id === mine.id && Date.now() - App.erholGetippt.t < 4000;
  if (mine.held) {
    haupt = o.holdBtn;                                  // „Jetzt eingreifen! ⚡"
  } else if (o.canRecover && erholWartet) {
    haupt = `<div class="angriff-wartet">✓ Erholung gemeldet ⏳</div>`;
  } else if (o.canRecover) {
    // Zwei gleichwertige Wege (Probe oder Benny): gleich große Knöpfe. Als
    // kleiner Neben-Knopf war „Benny ausgeben" winzig und „Erholt" dreizeilig.
    // Dritter Weg „Nicht geschafft" (Bedienbarkeit 15.11.2026, Vorschlag 6):
    // vorher gab es keinen Knopf dafür - wer die Probe verpatzte, wusste nicht,
    // was er tippen soll. Angeschlagen bleibt, der Zug ist vorbei.
    const nicht = `<button class="ghost big" data-act="confirm-turn" title="Probe verpatzt: bleibt angeschlagen, Zug ist vorbei">✗ Nicht geschafft</button>`;
    haupt = `<span class="dl-drei">${o.recoverFreeBtn}${nicht}${o.recoverBennyBtn || ""}</span>`;
    frage = `😵 Willenskraft oder Konstitution geschafft?`;
  } else if (isMyTurn && meinAngriff) {
    // Kein „Zug beenden" daneben: sonst endet der Zug, bevor der SL entschieden hat.
    haupt = `<div class="angriff-wartet">⚔ Angriff auf <b>${esc(angriffZiel ? angriffZiel.name : "?")}</b> – der Spielleiter entscheidet ⏳</div>`;
  } else if (isMyTurn && angriffMoeglich) {
    haupt = App.angriffWahl
      ? `<button class="ghost big" data-act="angriff-waehlen">✕ Angriff abbrechen</button>`
      : o.angriffBtn;
    neben = App.angriffWahl ? "" : o.confirmBtn + o.holdBtn;
    // Die Ziele direkt über dem Daumen - vorher standen sie oben in der Karte,
    // und das Hinscrollen klappte am Handy nicht immer.
    // Beim Angreifen gehört der ganze Bildschirm der Zielwahl (Stefan): im
    // halbhohen Streifen über dem Daumen scrollte bei vielen Figuren die Seite
    // mit den Zonen dahinter mit, und es hakte.
    if (App.angriffWahl) blatt = `<div class="angriff-blatt" data-scroll-merk="angriff">${angriffWahlHtml(mine)}</div>`;
  } else if (isMyTurn) {
    haupt = o.confirmBtn; neben = o.holdBtn;
  } else if (mine.card && !mine.revealed && !mine.benched && !o.ruhe) {
    haupt = `<button class="primary big" data-act="daumen-aufdecken">🂠 Karte aufdecken</button>`;
  }
  if (!haupt) return "";
  return `${blatt}<div class="aktionsleiste daumen-leiste${gleich ? " gleich" : ""}${frage ? " mit-frage" : ""}">
    ${frage ? `<div class="dl-frage">${frage}</div>` : ""}<div class="dl-haupt">${haupt}</div>${neben ? `<div class="dl-neben">${neben}</div>` : ""}
  </div>`;
}

// Beitritt in EINEM Tippen. Wer hier schon mal gespielt hat, bekommt seinen
// Charakter groß vorgeschlagen; sonst eine Liste großer Knöpfe (antippen =
// beigetreten). Früher: Auswahlliste + zwei Namensfelder - der Name des neuen
// Charakters landete gern im falschen Feld, dann kam nur ein alert() und
// nichts beim Server an („konnte keinen neuen Char erstellen", 1.1). Was
// getippt ist, steht in App.joinEntwurf und übersteht jedes Neuzeichnen.
function letzterCharakter() {
  const roster = (App.state && App.state.roster) || [];
  let m = null;
  try { m = JSON.parse(localStorage.getItem("letzterCharakter") || "null"); } catch { /* egal */ }
  const id = (m && m.id) || App.myCharacterId;
  return roster.find((r) => r.id === id)
    // ID weg (Sicherung eingespielt, Charakter neu angelegt): am Namen erkennen.
    || (m && m.name && roster.find((r) => (r.name || "").trim().toLowerCase() === m.name.trim().toLowerCase()))
    || null;
}
// Spielt diesen Charakter gerade jemand anderes (verbundenes Gerät)? Dann nicht
// anbieten - der Server lehnt den Beitritt sonst ab (wie charakter_aktiv_belegt).
function charakterBelegt(charId) {
  const s = App.state || {};
  const c = (s.combatants || []).find((x) => x.characterId === charId && x.playerId && x.playerId !== App.myPlayerId);
  const p = c && (s.players || []).find((x) => x.id === c.playerId);
  return !!(p && p.connected);
}
function merkeLetztenCharakter(id, name) {
  try { localStorage.setItem("letzterCharakter", JSON.stringify({ id: id || null, name: name || "" })); } catch { /* egal */ }
}
function joinAvatar(r) {
  const k = zoneInitials(r.name);
  return `<span class="avatar join-av">${r.image ? `<img src="${esc(r.image)}" alt="">`
    : `<span class="av-init${k.length > 2 ? " eng" : ""}">${esc(k)}</span>`}</span>`;
}

function renderJoin() {
  document.body.classList.remove("mit-kopf");
  const s = App.state;
  const E = App.joinEntwurf;
  const fehler = App.joinFehler
    ? `<div class="pill bad" style="display:block; line-height:1.5; margin-bottom:10px">${esc(App.joinFehler)}</div>`
    : "";
  let letzter = letzterCharakter();
  if (letzter && charakterBelegt(letzter.id)) letzter = null;   // gerade woanders im Spiel
  // Ohne Charakterliste (erster Abend) gleich das Namensfeld.
  let modus = !s.roster.length ? "neu" : (E.modus || (letzter ? "weiter" : "liste"));
  if (modus === "weiter" && !letzter) modus = "liste";
  const spielerFeld = `<label class="field join-spieler"><span>Dein Name <small class="muted">(optional)</small></span>
      <input id="joinname" value="${esc(E.spielerName)}" placeholder="z. B. Stefan" maxlength="40" autocomplete="off"></label>`;

  // Neuen Charakter erstellen: ein eigener, großer Knopf unter der Auswahl -
  // als kleiner Link bzw. gestrichelte Kachel wurde er übersehen (Stefan).
  const neuKnopf = `<div class="join-oder"><span>oder</span></div>
      <button class="big join-erstellen" data-act="join-modus" data-modus="neu">
        <span class="join-plus">＋</span><span>Neuen Charakter erstellen</span></button>`;
  let inhalt;
  if (modus === "weiter") {
    inhalt = `
      <button class="primary big join-weiter" data-act="join-als" data-id="${letzter.id}">
        ${joinAvatar(letzter)}<span>Weiter als <b>${esc(letzter.name)}</b></span></button>
      <div class="join-links"><button class="ghost small" data-act="join-modus" data-modus="liste">Anderen Charakter wählen …</button></div>
      ${neuKnopf}`;
  } else if (modus === "liste") {
    const knoepfe = s.roster.map((r) => charakterBelegt(r.id)
      ? `<div class="join-char belegt" title="Spielt gerade jemand anderes">${joinAvatar(r)}<span class="join-char-name">${esc(r.name)}<small>wird gespielt</small></span></div>`
      : `<button class="join-char${letzter && letzter.id === r.id ? " zuletzt" : ""}" data-act="join-als" data-id="${r.id}">
        ${joinAvatar(r)}<span class="join-char-name">${esc(r.name)}</span></button>`).join("");
    const frei = s.roster.some((r) => !charakterBelegt(r.id));
    inhalt = `
      <div class="join-titel">Charakter wählen</div>
      <div class="muted small" style="margin-bottom:8px">${frei ? "Antippen – schon bist du drin." : "Alle Charaktere sind vergeben – erstell dir einen neuen."}</div>
      <div class="join-liste">${knoepfe}</div>
      ${neuKnopf}
      ${spielerFeld}
      ${letzter ? `<div class="join-links"><button class="ghost small" data-act="join-modus" data-modus="weiter">← zurück</button></div>` : ""}`;
    // „Nur zuschauen" gibt es nicht mehr: der „Gast" landete als Figur in
    // Reihenfolge und Zonen (Kalle). Zuschauen geht über die TV-Ansicht.
  } else {
    // Klar sagen, dass hier ein Charakter ENTSTEHT - „Beitreten" allein las
    // sich beim ersten Start, als fehle die Charakterwahl (Stefan).
    inhalt = `
      <div class="join-titel">Neuen Charakter erstellen</div>
      ${s.roster.length ? "" : `<div class="muted small" style="margin-bottom:8px">Noch keine Charaktere da – leg deinen an. Werte trägst du danach im Charakterbogen ein.</div>`}
      <label class="field"><span>Name des Charakters</span>
        <input id="joinneu" value="${esc(E.neuName)}" placeholder="z. B. Tessa" maxlength="40" autocomplete="off" enterkeyhint="go"></label>
      ${spielerFeld}
      <button class="primary big" data-act="join-neu" style="width:100%">Charakter erstellen &amp; beitreten</button>
      ${s.roster.length ? `<div class="join-links"><button class="ghost small" data-act="join-modus" data-modus="liste">← zur Liste</button></div>` : ""}`;
  }
  // Erster Eindruck (Kalle, 14.11.2026, Studio-Runde 3A): Kartenkunst als
  // Bühne + Wortmarke statt einer Georgia-Überschrift über einem Formular.
  // Die Bühne ist ein fester Block (feste Höhe) – nichts rückt, wenn das Bild
  // lädt; es liegt als Hintergrund drin.
  return `
    <div class="join-buehne" aria-hidden="true">
      <div class="join-buehne-bild"></div>
      <div class="join-marke"><div class="wortmarke">Sundered Skies</div>
        <div class="zier"><span>Initiative</span></div></div>
    </div>
    <h1 class="sr-only">Sundered Skies Initiative – Beitreten</h1>
    <div class="panel join-form">
      ${fehler}
      ${inhalt}
    </div>
    ${handyTipp()}
    <div class="join-fuss">Nichts zu installieren – läuft direkt im Browser.<br>
      Inoffizielles Fanprojekt für Savage Worlds: Sundered Skies.</div>
  `;
}

// Vorbeugen statt mitten im Kampf suchen: faellt beim Gastgeber das Internet
// aus, springen Handys still auf Mobilfunk und verlieren den Spieltisch. Nur auf
// Touch-Geraeten zeigen – am Laptop waere „Flugmodus" verwirrend.
function handyTipp() {
  let touch = false;
  try { touch = window.matchMedia("(pointer: coarse)").matches; } catch { /* egal */ }
  if (!touch) return "";
  // Eine Zeile statt eigenem Kasten (Studio-Runde 3A); die Begründung steht
  // im title und in der SL-Anleitung.
  return `<div class="verbindungs-tipp" title="Sonst springt das Handy bei Internet-Aussetzern im WLAN still auf Mobilfunk und verliert den Spieltisch.">
      <span>📶</span><span><b>Flugmodus an, dann nur WLAN</b> – oder mobile Daten aus. So bleibt die Verbindung stabil.</span>
    </div>`;
}
