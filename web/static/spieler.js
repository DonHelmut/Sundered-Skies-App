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
  }

  const isMyTurn = s.activeId === mine.id && s.phase === "running";
  const banner = isMyTurn ? `<div class="myturn-banner">Du bist dran!</div>` : "";
  // Der Sekunden-Ring nur bei dem, der WIRKLICH dran ist - bei allen anderen
  // tickte er mit und machte unnoetig Druck. Wer als Naechster kommt, bekommt
  // stattdessen eine Vorwarnung, alle anderen sehen nur, wer gerade dran ist.
  const aktiv = s.combatants.find((c) => c.id === s.activeId);
  const binNaechster = !isMyTurn && !mine.benched && (naechsterAkteur(s) || {}).id === mine.id;
  const werDran = aktiv
    ? (aktiv.kind === "npc" && !aktiv.ally ? "Ein Gegner ist dran" : `${esc(aktiv.name)} ist dran`)
    : "";
  const vorwarnung = binNaechster && s.phase !== "idle"
    ? `<div class="gleich-dran">⏳ Gleich bist du dran – mach dich bereit!</div>` : "";
  const timer = s.phase === "running"
    ? (isMyTurn ? (s.timerEndsAt ? timerRing() : `<div class="timer-halt">⏸ Uhr angehalten – würfle in Ruhe</div>`)
      : `${vorwarnung}<div class="center muted small">${werDran}</div>`)
    : (s.phase === "gate" ? `${vorwarnung}<div class="center muted small">Warte auf Freigabe durch den Spielleiter…</div>` : "");

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
  const angriffMoeglich = isMyTurn && s.spielerAngriff !== false;
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
  const canRecover = binDran && mySt.shaken && !mySt.out;
  const recoverFreeBtn = canRecover
    ? `<button class="primary big" data-act="player-request" data-kind="status" data-detail='{"shaken":false}' data-label="ist nicht mehr angeschlagen">😵➜✓ Erholt (Probe geschafft)</button>`
    : "";
  const recoverBennyBtn = (canRecover && mine.isWildCard && (mine.bennies || 0) > 0)
    ? `<button class="good big" data-act="player-request" data-kind="recover" data-detail='{"benny":true}' data-label="gibt einen Benny aus und ist erholt">🪙➜✓ Benny ausgeben</button>`
    : "";
  const recoverGemeldet = (s.requests || []).some((r) => r.combatantId === mine.id && (r.kind === "recover" || (r.kind === "status" && (r.detail || {}).shaken === false)));
  const angeschlagenHinweis = binDran && mySt.shaken && !mySt.out ? `<div class="angeschlagen-hinweis">
      <div class="ah-titel">😵 Du bist angeschlagen</div>
      <div>Würfle zuerst <b>Willenskraft</b> oder <b>Konstitution</b>. Geschafft? Dann bist du erholt und kannst normal handeln.${
        mine.isWildCard ? " Oder gib einen <b>Benny</b> aus – dann sofort." : ""}</div>
      ${recoverGemeldet ? `<div class="zone-hint">An den Spielleiter geschickt ⏳</div>` : ""}
    </div>` : "";

  const myMsgs = s.messages.filter((m) => m.target === "all" || m.target === App.myPlayerId);
  const msgs = myMsgs.slice().reverse().slice(0, 8)
    .map((m) => `<div class="msg"><div class="to">${m.sender === "mimi" ? "🐈 Mimi" : m.sender === "kampf" ? "⚔ Kampf" : "Spielleiter"}</div>${m.text ? mehrzeilig(m.text) : ""}${m.imageUrl ? `<img src="${esc(m.imageUrl)}" data-act="open-image" data-url="${esc(m.imageUrl)}">` : ""}</div>`).join("");

  // Blockierendes Banner NUR für echte SL-Nachrichten (Mimis Miau ist ein Toast).
  const gmMsgs = myMsgs.filter((m) => m.sender !== "mimi" && m.sender !== "kampf");
  const newest = gmMsgs[gmMsgs.length - 1];
  const msgBanner = newest && newest.ts > App.lastSeenMsgTs
    ? `<div class="msg-overlay">
         <div class="msg-card">
           <div class="muted small">${newest.sender === "mimi" ? "🐈 Nachricht von Mimi" : "✉ Nachricht vom Spielleiter"}</div>
           ${newest.text ? `<div class="msg-text">${mehrzeilig(newest.text)}</div>` : ""}
           ${newest.imageUrl ? `<img src="${esc(newest.imageUrl)}">` : ""}
           <button class="primary big" data-act="dismiss-msg" data-ts="${newest.ts}" style="margin-top:14px;width:100%">Verstanden</button>
         </div>
       </div>`
    : "";

  const playerTag = mine.playerName && mine.playerName !== mine.name
    ? `<div class="muted small">Spieler: ${esc(mine.playerName)}</div>` : "";

  // Pausiert („Aus dem Kampf") – keine Karte, klarer Hinweis statt Kartenbereich.
  const cardPanel = mine.benched
    ? `<div class="panel benched-note" style="padding:16px; text-align:center">
         <div style="font-size:1.6rem">⏸</div>
         <div style="font-weight:600; margin-top:4px">Du bist gerade nicht im Kampf.</div>
         <div class="muted small" style="margin-top:4px">Der Spielleiter nimmt dich wieder rein (z. B. zum Rundenende). Solange bekommst du keine Karten.</div>
         ${bigStatusDisplay(mine)}
       </div>`
    : `<div class="panel" style="padding:12px">
      <div class="big-card tilt3d" id="bigcard" style="max-width:250px">${cardSlot(mine.id, mine.card, mine.status, "", { open: !!mine.revealed, tappable: !mine.revealed })}</div>
      ${bigStatusDisplay(mine)}
      ${hints ? `<div class="center" style="margin-top:6px">${hints}</div>` : ""}
      ${s.phase !== "idle" ? `<div style="margin-top:8px">${timer}</div>` : ""}
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
  const orderPanel = reihenfolgeGesperrt
    ? section("order", "Initiative-Reihenfolge",
      `<div class="order-locked">🂠 Deck erst deine Karte auf –<br>dann siehst du die Reihenfolge.</div>`)
    : renderOrderPanel(false);

  // Reihenfolge: Eigene Karte → Reihenfolge → Kampfzonen → Aktionen → Zustände.
  // Schmale Leiste, die beim Scrollen oben stehen bleibt: „wer ist dran" war
  // sonst nur ganz oben zu sehen - bei langer Seite scrollt man daran vorbei.
  const dranLeiste = s.round && werDran
    ? `<div class="dran-leiste${isMyTurn ? " ich" : ""}">${isMyTurn ? "▶ Du bist dran!" : esc(werDran)}${
        binNaechster && !isMyTurn ? " · du kommst als Nächstes" : ""}</div>`
    : "";

  // Der Daumen-Knopf: EIN großer Knopf unten, immer an derselben Stelle, der
  // das anbietet, was gerade dran ist - Karte aufdecken, erholen, angreifen,
  // eingreifen. Vorher standen bis zu fünf Knöpfe in der Karte verteilt, und
  // wer weiter unten im Bogen war, musste erst zurückscrollen.
  const daumen = daumenKnopf({ mine, isMyTurn, angriffMoeglich, meinAngriff, angriffZiel,
    canRecover: canRecover && !recoverGemeldet, recoverFreeBtn, recoverBennyBtn, confirmBtn, holdBtn, angriffBtn });

  const wuerfelListe = `<datalist id="wuerfel-vorschlaege">${WUERFEL.map((w) => `<option value="${w}">`).join("")}</datalist>`;

  return `
    ${wuerfelListe}
    ${msgBanner}
    ${dranLeiste}
    <div class="row spread" style="margin-bottom:6px">
      <div class="row tight" style="align-items:center">
        <label class="avatar big" title="Eigenes Bild wählen/ändern" style="cursor:pointer">
          ${mine.image ? `<img src="${esc(mine.image)}" alt="">` : esc(zoneInitials(mine.name))}
          <input type="file" accept="image/*" data-act="pick-char-image" data-id="${mine.id}" style="display:none">
        </label>
        <div><h1 style="margin:0; font-size:1.25rem">${esc(mine.name)}</h1>${playerTag}</div>
      </div>
      <div class="row tight" style="align-items:center">
        ${rundenZaehler(s)}
        <button class="ghost small" data-act="leave">Verlassen</button>
      </div>
    </div>
    ${banner}
    ${cardPanel}
    ${renderBogen(mine)}
    ${orderPanel}
    ${mine.benched ? "" : renderZonesPanel()}
    <label class="row tight" style="align-items:center; justify-content:center; margin-top:10px; cursor:pointer">
      <input type="checkbox" data-act="toggle-notify" ${localStorage.getItem("notifyTurn") !== "off" ? "checked" : ""} style="width:auto">
      <span class="small muted">🔔 ${kannVibrieren ? "Vibration/Ton" : "Ton"}, wenn ich dran bin</span>
      <button class="ghost small" data-act="ton-testen" title="Lautstärke prüfen – am iPhone muss der Lautlos-Schalter aus sein">▶ Test</button>
    </label>
    ${rueckseiteWahlHtml(mine)}
    ${msgs ? `<div class="panel"><h2>Nachrichten vom Spielleiter</h2>${msgs}</div>` : ""}
    ${daumen}
  `;
}

// Was der große Knopf unten gerade anbietet - in dieser Reihenfolge: wer
// abwartet, will eingreifen; angeschlagen heißt erst erholen; dann der Zug
// selbst; ansonsten die eigene Karte aufdecken. Nichts zu tun: keine Leiste.
function daumenKnopf(o) {
  const { mine, isMyTurn, angriffMoeglich, meinAngriff, angriffZiel } = o;
  let haupt = "", neben = "", blatt = "";
  // Sofort zeigen, dass „Erholt" angekommen ist - nicht erst, wenn der Server
  // antwortet. Vorher blieb der Knopf kurz unverändert, dann stand an GENAU
  // der Stelle „Angreifen": wer nochmal tippte, griff ungewollt an.
  const erholWartet = App.erholGetippt && App.erholGetippt.id === mine.id && Date.now() - App.erholGetippt.t < 4000;
  if (mine.held) {
    haupt = o.holdBtn;                                  // „Jetzt eingreifen! ⚡"
  } else if (o.canRecover && erholWartet) {
    haupt = `<div class="angriff-wartet">✓ Erholung gemeldet ⏳</div>`;
  } else if (o.canRecover) {
    haupt = o.recoverFreeBtn; neben = o.recoverBennyBtn;
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
  } else if (mine.card && !mine.revealed && !mine.benched) {
    haupt = `<button class="primary big" data-act="daumen-aufdecken">🂠 Karte aufdecken</button>`;
  }
  if (!haupt) return "";
  return `${blatt}<div class="aktionsleiste daumen-leiste">
    <div class="dl-haupt">${haupt}</div>${neben ? `<div class="dl-neben">${neben}</div>` : ""}
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
      <div class="join-links">
        ${letzter ? `<button class="ghost small" data-act="join-modus" data-modus="weiter">← zurück</button>` : ""}
        <button class="ghost small" data-act="join-als" data-id="" title="Ohne eigene Figur mitschauen">👁 Nur zuschauen</button>
      </div>`;
  } else {
    // Klar sagen, dass hier ein Charakter ENTSTEHT - „Beitreten" allein las
    // sich beim ersten Start, als fehle die Charakterwahl (Stefan).
    inhalt = `
      <div class="join-titel">➕ Neuen Charakter erstellen</div>
      ${s.roster.length ? "" : `<div class="muted small" style="margin-bottom:8px">Noch keine Charaktere da – leg deinen an. Werte trägst du danach im Charakterbogen ein.</div>`}
      <label class="field"><span>Name des Charakters</span>
        <input id="joinneu" value="${esc(E.neuName)}" placeholder="z. B. Tessa" maxlength="40" autocomplete="off" enterkeyhint="go"></label>
      ${spielerFeld}
      <button class="primary big" data-act="join-neu" style="width:100%">Charakter erstellen &amp; beitreten</button>
      ${s.roster.length ? `<div class="join-links"><button class="ghost small" data-act="join-modus" data-modus="liste">← zur Liste</button></div>` : ""}`;
  }
  return `
    <h1 class="center">Sundered Skies · Beitreten</h1>
    <div class="panel join-form">
      ${fehler}
      ${inhalt}
    </div>
    ${handyTipp()}
    <div class="center muted small">Nichts zu installieren – läuft direkt im Browser.</div>
    <div class="center muted small" style="margin-top:4px; opacity:0.75">Inoffizielles Fanprojekt für Savage Worlds: Sundered Skies.</div>
  `;
}

// Vorbeugen statt mitten im Kampf suchen: faellt beim Gastgeber das Internet
// aus, springen Handys still auf Mobilfunk und verlieren den Spieltisch. Nur auf
// Touch-Geraeten zeigen – am Laptop waere „Flugmodus" verwirrend.
function handyTipp() {
  let touch = false;
  try { touch = window.matchMedia("(pointer: coarse)").matches; } catch { /* egal */ }
  if (!touch) return "";
  return `<div class="panel verbindungs-tipp">
      <div class="verbindungs-tipp-titel">📶 Tipp für ein stabiles Spiel</div>
      <div><b>Flugmodus an</b> und danach nur <b>WLAN</b> wieder einschalten – oder
      mobile Daten aus.</div>
      <div class="muted small">Sonst springt das Handy bei Internet-Aussetzern im WLAN
      still auf Mobilfunk und verliert den Spieltisch.</div>
    </div>`;
}
