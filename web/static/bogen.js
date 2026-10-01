// Charakterbogen (Spickzettel) – rechnet mit, speichert beim Verlassen.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// ---------- Charakterbogen (Spickzettel) ----------
// Der Spieler pflegt ihn selbst (Stefan: „nur die Spieler tragen es ein").
// Vier Reiter wie ein kleiner Bogen. Bearbeitet wird ein Entwurf
// (App.bogenEntwurf); erst „Speichern" schickt ihn an den Server.
// Vorschläge fürs Eingabefeld - frei tippbar bleibt es trotzdem, damit auch
// „W6+2" oder „W8-1" gehen (der Server prüft und schreibt es einheitlich).
const WUERFEL = ["W4", "W6", "W8", "W10", "W12", "W12+1", "W12+2"];
const ATTRIBUTE = [["ge", "GE", "Geschicklichkeit"], ["ve", "VE", "Verstand"], ["wi", "WI", "Willenskraft"],
  ["st", "ST", "Stärke"], ["ko", "KO", "Konstitution"]];
const BOGEN_REITER = [["kampf", "Kampf"], ["werte", "Werte"], ["talente", "Talente"], ["zeug", "Ausrüstung"]];

function leererBogen() {
  return { parade: "", robustheit: "", panzer: "", tempo: "", rennen: "",
    attribute: { ge: "", ve: "", wi: "", st: "", ko: "" },
    fertigkeiten: [], waffen: [], talente: [], handicaps: [], ausruestung: [] };
}
function bogenVon(c) {
  const b = c && c.bogen;
  return b ? { ...leererBogen(), ...JSON.parse(JSON.stringify(b)) } : leererBogen();
}
function bogenIstLeer(b) {
  return !b.parade && !b.robustheit && !b.tempo && !b.waffen.length && !b.fertigkeiten.length
    && !Object.values(b.attribute).some(Boolean) && !b.talente.length && !b.handicaps.length && !b.ausruestung.length;
}
const wuerfelWahl = (pfad, wert, breite) =>
  `<input class="wuerfel-feld" list="wuerfel-vorschlaege" data-bogen="${pfad}" value="${esc(wert || "")}" placeholder="6 oder 6+2" inputmode="text"${breite ? ` style="width:${breite}"` : ""}>`;
const bogenFeld = (pfad, wert, platz, breite) =>
  `<input data-bogen="${pfad}" value="${esc(wert || "")}" placeholder="${esc(platz || "")}"${breite ? ` style="width:${breite}"` : ""}>`;

function renderBogen(mine) {
  if (!mine) return "";
  const reiter = App.bogenReiter || "kampf";
  const edit = !!App.bogenEntwurf;
  const b = edit ? App.bogenEntwurf : bogenVon(mine);
  const leiste = `<div class="reiter">${BOGEN_REITER.map(([k, n]) =>
    `<button class="${k === reiter ? "an" : ""}" data-act="bogen-reiter" data-reiter="${k}">${n}</button>`).join("")}</div>`;
  let inhalt;
  if (!edit && bogenIstLeer(b) && reiter !== "talente") {
    inhalt = `<div class="muted small" style="padding:6px 0">Noch leer. Tippe auf <b>✎ Bearbeiten</b> und trag deine Werte ein – dann hast du sie im Kampf immer griffbereit.</div>`;
    if (reiter === "kampf") inhalt += regelTipp(b);
    return section("bogen", "📜 Mein Charakter", `<div class="bogen">${leiste}${inhalt}<div class="row" style="margin-top:8px"><button class="ghost small" data-act="bogen-bearbeiten">✎ Bearbeiten</button></div></div>`);
  } else if (reiter === "kampf") {
    inhalt = edit
      ? `<div class="bogen-raster">
           <label title="Leer lassen: 2 + halbes Kämpfen">Parade ${bogenFeld("parade", b.parade, autoParade(b) !== null ? `auto ${autoParade(b)}` : "z. B. 7", "4.5em")}</label>
           <label title="Leer lassen: 2 + halbe Konstitution + Panzer">Robustheit ${bogenFeld("robustheit", b.robustheit, autoRobustheit(b) !== null ? `auto ${autoRobustheit(b)}` : "z. B. 8", "4.5em")}</label>
           <label>davon Panzer ${bogenFeld("panzer", b.panzer, "z. B. 2", "4.5em")}</label>
           <label>Tempo ${bogenFeld("tempo", b.tempo, "z. B. 6", "4.5em")}</label>
           <label>Rennen ${wuerfelWahl("rennen", b.rennen)}</label>
         </div>
         <div class="muted small">Parade und Robustheit rechnet die App aus Kämpfen bzw. Konstitution + Panzer, solange du die Felder leer lässt.</div>
         <div class="bogen-titel">Waffen</div>
         ${b.waffen.map((w, i) => `<div class="waffe-block">
           <div class="bogen-reihe">
             <select data-bogen="waffen.${i}.art" title="Nahkampf oder Fernkampf">
               <option value="nah"${w.art !== "fern" ? " selected" : ""}>⚔ Nahkampf</option>
               <option value="fern"${w.art === "fern" ? " selected" : ""}>🏹 Fernkampf</option>
             </select>
             ${bogenFeld(`waffen.${i}.name`, w.name, "Name")}
             <button class="st-btn" data-act="bogen-weg" data-liste="waffen" data-i="${i}" title="Entfernen">✕</button>
           </div>
           <div class="bogen-reihe">
             ${bogenFeld(`waffen.${i}.fertigkeit`, w.fertigkeit, w.art === "fern" ? "Schießen" : "Kämpfen", "8em")}
             ${bogenFeld(`waffen.${i}.schaden`, w.schaden, w.art === "fern" ? "z. B. 2W6" : "z. B. St+W6", "7em")}
             ${bogenFeld(`waffen.${i}.info`, w.info, w.art === "fern" ? "Reichweite 12/24/48" : "Notiz, z. B. Parade +1")}
           </div>
         </div>`).join("")}
         <button class="ghost small" data-act="bogen-dazu" data-liste="waffen">+ Waffe</button>`
      : `<div class="zeile2"><span>Parade</span><b>${b.parade ? esc(b.parade) : (autoParade(b) !== null ? `${autoParade(b)} <span class="auto-wert">automatisch</span>` : "–")}</b></div>
         <div class="zeile2"><span>Robustheit</span><b>${b.robustheit ? esc(b.robustheit) : (autoRobustheit(b) !== null ? `${autoRobustheit(b)} <span class="auto-wert">automatisch</span>` : "–")}${b.panzer ? ` (${esc(b.panzer)})` : ""}</b></div>
         <div class="zeile2"><span>Tempo</span><b>${esc(b.tempo || "–")}${b.rennen ? ` · Rennen ${esc(b.rennen)}` : ""}</b></div>
         ${b.waffen.map((w) => `<div class="zeile2"><span>${w.art === "fern" ? "🏹" : "⚔"} ${esc(w.name)}</span><b>${esc([w.schaden, w.info].filter(Boolean).join(" · "))}</b></div>
           <div class="wuerfel-tipp">${wuerfelTipp(w, b)}</div>`).join("")}`;
  } else if (reiter === "werte") {
    // Fruehere Kuerzel (GE/VE/WI/ST/KO) waren nicht eindeutig - jetzt
    // ausgeschrieben, untereinander statt in fuenf schmalen Kaestchen.
    inhalt = `<div class="attr-liste">${ATTRIBUTE.map(([k, kurz, lang]) =>
        `<div class="attr-zeile"><span>${lang} <span class="muted small">(${kurz})</span></span>
          ${edit ? wuerfelWahl(`attribute.${k}`, b.attribute[k]) : `<b>${esc(b.attribute[k] || "–")}</b>`}</div>`).join("")}</div>
      ${edit ? `<div class="muted small">Nur die Zahl reicht: <b>6</b> wird zu W6, <b>6+2</b> zu W6+2.</div>` : ""}
      <div class="bogen-titel">Fertigkeiten</div>
      ${edit
        ? b.fertigkeiten.map((f, i) => `<div class="bogen-reihe">${bogenFeld(`fertigkeiten.${i}.name`, f.name, "z. B. Kämpfen")}${wuerfelWahl(`fertigkeiten.${i}.wert`, f.wert)}
            <button class="st-btn" data-act="bogen-weg" data-liste="fertigkeiten" data-i="${i}" title="Entfernen">✕</button></div>`).join("")
          + `<button class="ghost small" data-act="bogen-dazu" data-liste="fertigkeiten">+ Fertigkeit</button>`
        : (b.fertigkeiten.length
            ? `<div class="fert">${b.fertigkeiten.map((f) => `<span>${esc(f.name)}</span><span class="w">${esc(f.wert || "–")}</span>`).join("")}</div>`
            : `<div class="muted small">–</div>`)}`;
  } else if (reiter === "talente") {
    // Initiative-Talente (Schnell, Kühler Kopf …) und Glück: wirken direkt aufs
    // Kartenziehen bzw. die Bennies - der Spieler hakt sie hier selbst an.
    const alle = App.state.talents || {};
    const te = App.talentEntwurf;
    const hat = (k) => (edit ? te.talents : (mine.talents || [])).includes(k);
    const glueck = edit ? te : mine;
    const initAnzeige = [
      ...(mine.talents || []).map((t) => (alle[t] || {}).label || t),
      ...(mine.gluck ? ["Glück"] : []), ...(mine.grosses_gluck ? ["Großes Glück"] : []),
    ].map((n) => `<span class="tag">${esc(n)}</span>`).join("");
    const initEdit = Object.keys(alle).map((k) =>
        `<label class="talent-wahl"><input type="checkbox" data-talent="${k}"${hat(k) ? " checked" : ""}> ${esc(alle[k].label)}</label>`).join("")
      + `<label class="talent-wahl"><input type="checkbox" data-talent="gluck"${glueck.gluck ? " checked" : ""}> Glück (+1 Benny)</label>`
      + `<label class="talent-wahl"><input type="checkbox" data-talent="grosses_gluck"${glueck.grosses_gluck ? " checked" : ""}> Großes Glück (+2)</label>`;
    inhalt = `<div class="bogen-titel">Initiative &amp; Glück</div>
      ${edit ? `<div class="talent-raster">${initEdit}</div>`
        : `<div class="chips">${initAnzeige || `<span class="muted small">–</span>`}</div>`}
      <div class="bogen-titel">Talente</div>
      ${edit ? `<textarea data-bogen="talente" rows="4" placeholder="Ein Talent pro Zeile">${esc(b.talente.join("\n"))}</textarea>`
        : `<div class="chips">${b.talente.map((t) => `<span class="tag">${esc(t)}</span>`).join("") || `<span class="muted small">–</span>`}</div>`}
      <div class="bogen-titel">Handicaps</div>
      ${edit ? `<textarea data-bogen="handicaps" rows="3" placeholder="Ein Handicap pro Zeile">${esc(b.handicaps.join("\n"))}</textarea>`
        : `<div class="chips">${b.handicaps.map((t) => `<span class="tag handicap">${esc(t)}</span>`).join("") || `<span class="muted small">–</span>`}</div>`}`;
  } else {
    inhalt = edit
      ? `<textarea data-bogen="ausruestung" rows="6" placeholder="Ein Gegenstand pro Zeile, z. B. Heiltrank ×3">${esc(b.ausruestung.join("\n"))}</textarea>`
      : (b.ausruestung.map((z) => `<div class="zeile2"><span>${esc(z)}</span></div>`).join("") || `<div class="muted small">–</div>`);
  }
  // Regel-Spickzettel nur im Kampf-Reiter und nicht beim Bearbeiten.
  if (reiter === "kampf" && !edit) inhalt += regelTipp(b);
  const knoepfe = edit
    ? `<div class="row" style="margin-top:10px; gap:8px"><button class="primary" data-act="bogen-speichern">✓ Speichern</button>
         <button class="ghost" data-act="bogen-abbrechen">Abbrechen</button></div>`
    : `<div class="row" style="margin-top:8px"><button class="ghost small" data-act="bogen-bearbeiten">✎ Bearbeiten</button></div>`;
  return section("bogen", "📜 Mein Charakter", `<div class="bogen${edit ? " bogen-form" : ""}">${leiste}${inhalt}${knoepfe}</div>`);
}

// „Womit würfle ich?" - aus den eigenen Werten für GENAU diese Waffe.
// Beispiel: „Kämpfen W8+1 + Wild-Würfel W6 gegen Parade · Schaden W6+W6".
function wuerfelTipp(w, b) {
  const fern = w.art === "fern";
  const fert = (name) => (b.fertigkeiten.find((f) => f.name.trim().toLowerCase() === String(name).trim().toLowerCase()) || {}).wert;
  // Eigene Angabe an der Waffe hat Vorrang, sonst die uebliche Fertigkeit.
  const wert = fert(w.fertigkeit) || fert(fern ? "schießen" : "kämpfen") || fert(fern ? "schiessen" : "kaempfen") || "";
  const fertName = w.fertigkeit || (fern ? "Schießen" : "Kämpfen");
  // „St+W6" heisst: Stärke-Würfel plus Waffenwürfel - hier gleich einsetzen.
  const st = b.attribute.st;
  const schaden = (w.schaden || "").replace(/\b(St|ST|Stärke|Staerke)\b/g, st || "Stärke");
  const angriff = `${esc(fertName)}${wert ? ` <b>${esc(wert)}</b>` : ""} + Wild-Würfel W6 ${fern ? "gegen <b>4</b>" : "gegen die <b>Parade</b>"}`;
  return `🎲 ${angriff}${schaden ? ` · Schaden <b>${esc(schaden)}</b>` : ""}${
    fern && w.info ? ` · ${esc(w.info)} (mittel −2, weit −4)` : ""}`;
}

// Kurzregeln zu Angriff und Schaden (Savage Worlds, wie in Sundered Skies).
// Setzt die eigenen Werte ein, wo der Bogen sie kennt - sonst allgemein.
function regelTipp(b) {
  const fert = (name) => (b.fertigkeiten.find((f) => f.name.trim().toLowerCase() === name) || {}).wert;
  const kaempfen = fert("kämpfen") || fert("kaempfen");
  const schiessen = fert("schießen") || fert("schiessen");
  const st = b.attribute.st;
  const w = (x, allg) => (x ? `<b>${esc(x)}</b>` : allg);
  const parade = b.parade || autoParade(b);
  const robust = b.robustheit || autoRobustheit(b);
  return `<details class="regel-tipp"${App.regelOffen ? " open" : ""}>
    <summary>❔ So geht Angriff &amp; Schaden</summary>
    <div class="regel-block"><b>1 · Treffen</b>
      <ul>
        <li><b>Nahkampf:</b> ${w(kaempfen && `Kämpfen ${kaempfen}`, "Kämpfen")} würfeln – erreichen oder übertreffen der <b>Parade</b> des Gegners = Treffer.</li>
        <li><b>Fernkampf:</b> ${w(schiessen && `Schießen ${schiessen}`, "Schießen")} gegen <b>4</b>. Mittlere Reichweite −2, weite −4, Deckung zieht ab.</li>
        <li>Als Wild Card würfelst du den <b>Wild-Würfel (W6)</b> mit, der höhere zählt. Jede gewürfelte Höchstzahl darf nochmal (<b>Ass</b>).</li>
        <li><b>4 oder mehr darüber</b> (Steigerung) = <b>+1W6 Schaden</b>.</li>
      </ul></div>
    <div class="regel-block"><b>2 · Schaden</b>
      <ul>
        <li><b>Nahkampf:</b> ${w(st && `Stärke ${st}`, "Stärke")} + Waffenwürfel (z. B. St+W6). <b>Fernkampf:</b> fester Waffenschaden (z. B. 2W6). Kein Wild-Würfel beim Schaden.</li>
        <li>Verglichen wird mit der <b>Robustheit</b> des Ziels:
          erreicht = <b>Angeschlagen</b>, je 4 darüber = <b>1 Wunde</b>.
          Ist das Ziel schon angeschlagen, wird aus „Angeschlagen" eine Wunde.</li>
        <li>Normale Gegner (Statisten) sind bei der <b>${App.state.statistenKo || 3}. Wunde</b> draußen, Wild Cards (Spieler, Bosse) bei der <b>4.</b></li>
      </ul></div>
    ${parade || robust ? `<div class="regel-block"><b>Deine Werte</b>
      <ul>${parade ? `<li><b>Parade ${esc(String(parade))}</b> – so schwer ist es, dich im Nahkampf zu treffen.</li>` : ""}
        ${robust ? `<li><b>Robustheit ${esc(String(robust))}</b> – so viel Schaden steckst du weg, bevor du angeschlagen bist.</li>` : ""}</ul></div>` : ""}
    <div class="regel-block"><b>Gut zu wissen</b>
      <ul>
        <li><b>Joker:</b> +2 auf alle Würfe <i>und</i> den Schaden.</li>
        <li>Jede eigene Wunde: <b>−1</b> auf alle Würfe.</li>
        <li><b>Mehrere gegen einen:</b> +1 pro zusätzlichem Angreifer (höchstens +4).</li>
        <li><b>Wilder Angriff:</b> +2 aufs Treffen und den Schaden, dafür −2 Parade bis zum nächsten Zug.</li>
        <li><b>Benny für Wunden:</b> sofort nach dem Treffer Konstitution würfeln – Erfolg und jede Steigerung heben je eine Wunde auf.</li>
      </ul></div>
    <div class="muted small">Im Zweifel entscheidet der Spielleiter.</div>
  </details>`;
}

// Auf-/Zugeklappt merken - sonst klappte ihn jedes Update vom Tisch wieder zu.
document.addEventListener("toggle", (e) => {
  if (e.target.classList && e.target.classList.contains("regel-tipp")) App.regelOffen = e.target.open;
}, true);

// Wie der Server (wuerfel_wert): W4-W12, optional mit Zuschlag; beim Schaden
// auch mehrere Wuerfel. Rot markieren statt stillschweigend verwerfen.
const WUERFEL_PRUEFUNG = /^(\d{0,2})[wWdD]?(4|6|8|10|12)\s*([+-]\s*\d{1,2})?$/;
// Aus „W8" bzw. „W12+1" die Bestandteile holen (fuer Parade/Robustheit).
function wuerfelTeile(wert) {
  const m = WUERFEL_PRUEFUNG.exec(String(wert || "").trim().replace(/\s+/g, ""));
  if (!m) return null;
  return { seiten: parseInt(m[2], 10), plus: parseInt((m[3] || "0").replace(/\s+/g, ""), 10) || 0 };
}

// Savage Worlds: Parade = 2 + halbes Kaempfen, Robustheit = 2 + halbe
// Konstitution + Panzerung. Ein Plus zaehlt nur oberhalb von W12 mit (W12+1).
// Die App rechnet das nur, wenn der Spieler das Feld LEER laesst - wer eigene
// Werte eintraegt (Talente, Ausruestung), behaelt sie.
function halberWuerfel(wert) {
  const t = wuerfelTeile(wert);
  if (!t) return null;
  return t.seiten / 2 + (t.seiten === 12 ? t.plus : 0);
}
function autoParade(b) {
  const h = halberWuerfel((b.fertigkeiten.find((f) => /^k(ä|ae)mpfen$/i.test(f.name.trim())) || {}).wert);
  return h === null ? null : 2 + h;
}
function autoRobustheit(b) {
  const h = halberWuerfel(b.attribute.ko);
  if (h === null) return null;
  const panzer = parseInt(b.panzer, 10);
  return 2 + h + (isNaN(panzer) ? 0 : panzer);
}

function wuerfelNorm(text, mehrere) {
  const roh = String(text || "").trim().replace(/\s+/g, "");
  if (!roh) return "";
  const m = WUERFEL_PRUEFUNG.exec(roh);
  if (!m) return null;                       // null = unbrauchbar
  let anzahl = m[1];
  if (["", "0", "1"].includes(anzahl)) anzahl = "";
  else if (!mehrere) return null;            // mehrere Würfel nur beim Schaden
  return `${anzahl}W${m[2]}${(m[3] || "").replace(/\s+/g, "")}`;
}

function wuerfelFeldPruefen(t) {
  const pfad = t.getAttribute("data-bogen") || "";
  if (!t.classList.contains("wuerfel-feld")) return;
  const wert = wuerfelNorm(t.value, /schaden/.test(pfad));
  t.classList.toggle("ungueltig", wert === null);
}

// Beim Verlassen des Felds sauber schreiben: aus „6" wird sichtbar „W6", aus
// „w8 +1" wird „W8+1". Der Spieler soll das „W" nicht tippen müssen.
function wuerfelFeldAufraeumen(t) {
  if (!t.classList || !t.classList.contains("wuerfel-feld")) return;
  const wert = wuerfelNorm(t.value, /schaden/.test(t.getAttribute("data-bogen") || ""));
  if (wert !== null && wert !== t.value) {
    t.value = wert;
    bogenEingabe(t);
    t.classList.remove("ungueltig");
  }
}
document.addEventListener("focusout", (e) => {
  if (e.target.closest && e.target.closest(".bogen-form")) wuerfelFeldAufraeumen(e.target);
}, true);

// Eingabe im Entwurf mitschreiben (Pfad wie „waffen.0.name").
function bogenEingabe(t) {
  const pfad = t.getAttribute("data-bogen");
  if (!pfad || !App.bogenEntwurf) return;
  const teile = pfad.split(".");
  if (["talente", "handicaps", "ausruestung"].includes(pfad)) {
    App.bogenEntwurf[pfad] = t.value.split("\n").map((z) => z.trim()).filter(Boolean);
    return;
  }
  let ziel = App.bogenEntwurf;
  for (let i = 0; i < teile.length - 1; i++) ziel = ziel[teile[i]];
  ziel[teile[teile.length - 1]] = t.value;
}
document.addEventListener("input", (e) => {
  if (!e.target.closest || !e.target.closest(".bogen-form")) return;
  bogenEingabe(e.target);
  wuerfelFeldPruefen(e.target);
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.closest || !t.closest(".bogen-form")) return;
  const k = t.getAttribute("data-talent");
  if (k && App.talentEntwurf) {
    if (k === "gluck" || k === "grosses_gluck") App.talentEntwurf[k] = t.checked;
    else {
      const l = App.talentEntwurf.talents.filter((x) => x !== k);
      if (t.checked) l.push(k);
      App.talentEntwurf.talents = l;
    }
    return;
  }
  bogenEingabe(t);
});
// Solange im Bogen getippt wird, NICHT neu aufbauen (sonst waeren Fokus und
// Cursor weg, sobald irgendwer am Tisch etwas tut). Nach dem Verlassen des
// Felds den zurueckgehaltenen Stand nachholen.
function tipptImBogen() {
  const a = document.activeElement;
  // Auch das Schadensfeld der Treffer-Auswahl (SL): sonst wäre die Eingabe
  // bei jedem Server-Update weg.
  // Und die Beitrittsseite: kam dort ein Update (jemand anderes trat bei),
  // verlor man mitten im Tippen Fokus und Tastatur.
  return !!(a && a.closest && a.closest(".bogen-form, .al-treffer, .angriff-popup, .join-form, .kampf-bau") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "treffer-schaden") App.trefferSchaden = e.target.value;
  if (e.target && e.target.id === "joinneu") App.joinEntwurf.neuName = e.target.value;
  if (e.target && e.target.id === "kb-name" && App.kampfEntwurf) App.kampfEntwurf.name = e.target.value;
  if (e.target && e.target.id === "kb-notiz" && App.kampfEntwurf) App.kampfEntwurf.note = e.target.value;
  if (e.target && e.target.id === "joinname") App.joinEntwurf.spielerName = e.target.value;
  // Angriffs-Fenster: Vorschlag sofort neu rechnen (einmal neu zeichnen, Fokus
  // und Cursor danach wiederherstellen).
  if (e.target && e.target.id === "angriff-schaden") {
    App.angriffSchaden = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const neu = $("angriff-schaden");
    if (neu) { neu.focus(); try { neu.setSelectionRange(pos, pos); } catch { /* type=number */ } }
  }
});
// ABER nicht, solange Finger/Maus noch unten sind: Tippt man vom Feld direkt
// auf einen Knopf (Reiter, Speichern), verliert das Feld den Fokus schon beim
// Herunterdruecken. Ein Neuaufbau in diesem Moment tauschte den Knopf unter
// dem Finger aus - der Klick ging ins Leere. Darum erst nach dem Loslassen.
let zeigerUnten = false;
function bogenNachholen() {
  if (App.bogenWartet && !tipptImBogen() && !zeigerUnten && !blattScrollt()) { App.bogenWartet = false; render(); }
}
// Scrollt der Spieler gerade in der Zielwahl? Dann nicht neu aufbauen - ein
// Neuaufbau mitten im Schwung stoppt das Scrollen (das „Hängen").
function blattScrollt() {
  return !!(App._blattScrollZeit && Date.now() - App._blattScrollZeit < 700);
}
document.addEventListener("scroll", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("angriff-blatt")) App._blattScrollZeit = Date.now();
}, true);
document.addEventListener("pointerdown", () => { zeigerUnten = true; }, true);
// Beitritt: „Los" auf der Handy-Tastatur tritt direkt bei.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.id === "joinneu") { e.preventDefault(); e.target.blur(); doJoin(null, true); }
});
const zeigerOben = () => { zeigerUnten = false; setTimeout(bogenNachholen, 60); };
document.addEventListener("pointerup", zeigerOben, true);
document.addEventListener("pointercancel", zeigerOben, true);
document.addEventListener("focusout", () => setTimeout(bogenNachholen, 0));
