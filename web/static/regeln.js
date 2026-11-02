// Regel-Spickzettel am Handy (📖) und die Kurzansicht „Mein Zug".
// Teil der Client-Logik, klassische <script>-Datei mit gemeinsamem globalem
// Bereich (Reihenfolge in index.html zählt: nach protokoll.js, vor start.js).
//
// Warum: am Tisch kamen immer dieselben Fragen („Wie ging nochmal Test?",
// „Was kostet die zweite Aktion?"). Der Angriff-&-Schaden-Tipp im Bogen deckt
// nur das Treffen ab - hier steht der Rest, kurz und zum Aufklappen.
// Begriffe wie in der deutschen Savage-Worlds-Ausgabe; im Zweifel gilt, was
// der SL sagt (steht unten auch so).

const Regeln = {
  offen: false,
  auf: new Set(["zug"]),     // aufgeklappte Abschnitte (überleben das Neuzeichnen)
};

// [Schlüssel, Titel, Inhalt]. Bewusst knapp: ein Blick, nicht das Regelbuch.
const REGEL_ABSCHNITTE = [
  ["zug", "▶ Dein Zug", `<ul>
    <li><b>Bewegen</b> bis zu deinem Tempo (meist 6) und <b>eine Aktion</b> ohne Abzug.</li>
    <li><b>Rennen:</b> Rennwürfel (W6) dazu, dafür −2 auf Aktionen in diesem Zug.</li>
    <li><b>Mehrere Aktionen:</b> bis zu drei. Zwei Aktionen = −2 auf <i>alle</i>, drei = −4.</li>
    <li><b>Freie Aktionen</b> kosten nichts: kurz rufen, etwas fallen lassen, hinwerfen.</li>
    <li><b>Abwarten:</b> Karte aufheben und später <b>eingreifen</b> – auch mitten im Zug eines anderen.</li>
  </ul>`],
  ["wuerfel", "🎲 Würfeln", `<ul>
    <li><b>4</b> oder mehr = Erfolg. Je <b>4 darüber</b> = eine <b>Steigerung</b>.</li>
    <li><b>Ass:</b> Höchstzahl gewürfelt → nochmal würfeln und dazuzählen.</li>
    <li><b>Wild-Würfel</b> (W6) immer mitwürfeln, der höhere zählt (nicht beim Schaden).</li>
    <li><b>Kritischer Patzer:</b> Eigenschaftswürfel <i>und</i> Wild-Würfel zeigen eine 1 – darf nicht mit Benny wiederholt werden.</li>
  </ul>`],
  ["angriff", "⚔ Angriff & Schaden", `<ul>
    <li><b>Nahkampf:</b> Kämpfen gegen die <b>Parade</b>. <b>Fernkampf:</b> Schießen gegen <b>4</b> (mittel −2, weit −4).</li>
    <li><b>Steigerung</b> beim Treffen = <b>+1W6 Schaden</b>.</li>
    <li>Schaden gegen <b>Robustheit</b>: erreicht = Angeschlagen, je 4 darüber = 1 Wunde.</li>
    <li><b>Mehrere gegen einen:</b> +1 je weiterem Angreifer (höchstens +4).</li>
    <li><b>Wilder Angriff:</b> +2 aufs Treffen und den Schaden, dafür bist du bis zu deinem nächsten Zug leichter zu treffen.</li>
    <li><b>Zurückziehen</b> aus dem Nahkampf: jeder angrenzende Gegner bekommt einen freien Angriff.</li>
  </ul>`],
  ["abzuege", "🎯 Zielen, Deckung, gezielte Treffer", `<ul>
    <li><b>Zielen</b> (der ganze Zug, ohne Bewegung): nächster Angriff +2 – oder bis zu 4 Punkte Abzüge ignorieren.</li>
    <li><b>Deckung:</b> leicht −2, mittel −4, schwer −6, fast ganz −8.</li>
    <li><b>Gezielt:</b> Arm/Bein −2, Kopf −4 (dafür +4 Schaden).</li>
    <li><b>Dunkelheit:</b> dämmrig −2, dunkel −4, stockfinster −6.</li>
  </ul>`],
  ["test", "🎭 Tricks & Tests", `<ul>
    <li>Statt anzugreifen den Gegner <b>austricksen</b>: eine passende Fertigkeit gegen ein passendes Attribut des Ziels.</li>
    <li>Zum Beispiel <b>Einschüchtern</b> gegen Willenskraft, <b>Provozieren</b> gegen Verstand, <b>Athletik</b> (Sand in die Augen, Bein stellen) gegen Geschicklichkeit.</li>
    <li><b>Erfolg:</b> Ziel ist <b>Abgelenkt</b> (−2 auf seine Aktionen) <i>oder</i> <b>Verwundbar</b> (alle Aktionen gegen es +2) – bis zum Ende seines nächsten Zugs.</li>
    <li><b>Steigerung:</b> zusätzlich <b>Angeschlagen</b>.</li>
    <li><b>Unterstützen:</b> passender Wurf für einen Verbündeten – Erfolg +1, Steigerung +2 (höchstens +4).</li>
  </ul>`],
  ["angeschlagen", "😵 Angeschlagen & Wunden", `<ul>
    <li><b>Angeschlagen:</b> zu Beginn deines Zugs <b>Willenskraft</b> würfeln. Erfolg = erholt, du handelst normal. Sonst nur freie Aktionen.</li>
    <li>Mit einem <b>Benny</b> bist du jederzeit sofort erholt.</li>
    <li>Jede <b>Wunde</b>: −1 auf alle Würfe und aufs Tempo (höchstens −3).</li>
    <li>Wild Cards sind bei der <b>4. Wunde</b> außer Gefecht, normale Gegner früher.</li>
  </ul>`],
  ["bennies", "🪙 Bennies", `<ul>
    <li>Einen eigenen Wurf <b>wiederholen</b> (das bessere Ergebnis zählt).</li>
    <li>Sofort von <b>Angeschlagen</b> erholen.</li>
    <li><b>Wunden wegstecken:</b> gleich nach dem Treffer Konstitution würfeln – Erfolg und jede Steigerung heben eine Wunde auf.</li>
    <li>Zu Beginn der Runde eine <b>neue Initiative-Karte</b> ziehen.</li>
  </ul>`],
  ["joker", "🃏 Joker", `<ul>
    <li>Handeln, wann du willst – auch zwischen anderen.</li>
    <li><b>+2</b> auf alle Würfe <i>und</i> den Schaden, die ganze Runde.</li>
  </ul>`],
];

function regelnOeffnen(abschnitt) {
  Regeln.offen = true;
  if (abschnitt) Regeln.auf.add(abschnitt);
  render();
}

function regelnFensterHtml() {
  if (!Regeln.offen || App.role !== "player") return "";
  const teile = REGEL_ABSCHNITTE.map(([k, titel, inhalt]) => {
    const auf = Regeln.auf.has(k);
    return `<div class="pt-abend${auf ? " auf" : ""}">
      <button type="button" class="pt-kopf" data-act="regeln-auf" data-k="${k}">
        <span class="pt-name">${titel}</span><span class="pt-pfeil">▸</span></button>
      ${auf ? `<div class="pt-text regel-text">${inhalt}</div>` : ""}</div>`;
  }).join("");
  return `<div class="protokoll-hg" data-act="regeln-zu">
    <div class="protokoll-fenster panel" data-act="" data-scroll-merk="regeln">
      <div class="pt-titelzeile"><strong>📖 Regeln kurz</strong>
        <button class="ghost small" data-act="regeln-zu">Schließen</button></div>
      ${teile}
      <div class="muted small" style="margin-top:8px">Im Zweifel entscheidet der Spielleiter.</div>
    </div></div>`;
}

// --- Kurzansicht „Mein Zug" ---------------------------------------------------
// Ist man dran, zählt nur: was kann ich, wie stehe ich, was tippe ich. Statt
// der großen Karte (die liegt da schon offen) stehen oben die eigenen
// Kampfwerte, Waffen mit Würfel-Tipp und alle Abzüge; Reihenfolge, Bogen und
// Nachrichten treten zurück (ein Tipp holt sie). Abschaltbar im ⚙.
function kurzAnsichtAn() {
  try { return localStorage.getItem("zugKurz") !== "off"; } catch { return true; }
}
// „Alles zeigen" gilt nur für DIESEN Zug - beim nächsten ist es wieder kurz.
function zugSchluessel(s, mine) { return `${s.round}:${mine.id}:${mine.card ? mine.card.id : ""}`; }
function kurzAnsichtJetzt(s, mine, isMyTurn) {
  return isMyTurn && kurzAnsichtAn() && !mine.benched && !!mine.revealed
    && App.zugAllesZeigen !== zugSchluessel(s, mine);
}

// Parade/Robustheit/Tempo als Kacheln - in „Mein Zug" und in der ruhigen
// Ansicht zwischen den Kämpfen (spieler.js).
function werteKachelnHtml(mine) {
  const b = bogenVon(mine);
  const parade = b.parade || autoParade(b);
  const robust = b.robustheit || autoRobustheit(b);
  const kachel = (name, wert, zusatz = "") => `<div class="zk-kachel"><span>${name}</span><b>${wert ? esc(String(wert)) : "–"}</b>${zusatz}</div>`;
  return kachel("Parade", parade) + kachel("Robustheit", robust, b.panzer && !panzerSchonDrin(b) ? `<i>Panzer ${esc(b.panzer)}</i>` : "")
    + kachel("Tempo", b.tempo, b.rennen ? `<i>Rennen ${esc(b.rennen)}</i>` : "");
}
// Alle Abzüge auf einen Blick: Wunden zählen bis −3.
function wundAbzugHtml(mine) {
  const st = mine.status || {};
  const wundAbzug = Math.min(3, st.wounds || 0);
  return wundAbzug ? `<div class="zk-abzug">−${wundAbzug} auf alle Würfe <span class="muted small">(${st.wounds} Wunde${st.wounds > 1 ? "n" : ""})</span></div>` : "";
}

function zugPanelHtml(mine, extras) {
  const b = bogenVon(mine);
  const kacheln = werteKachelnHtml(mine);
  const abzug = wundAbzugHtml(mine);
  const waffen = b.waffen.map((w) => `<div class="zk-waffe"><div class="zk-wname">${w.art === "fern" ? "🏹" : "⚔"} ${esc(w.name)}</div>
      <div class="wuerfel-tipp">${wuerfelTipp(w, b)}</div></div>`).join("");
  const fert = b.fertigkeiten.filter((f) => f.name && f.wert)
    .map((f) => `<span class="zk-fert">${esc(f.name)} <b>${esc(f.wert)}</b></span>`).join("");
  const leer = bogenIstLeer(b)
    ? `<div class="muted small zk-leer">Trag im Charakterbogen deine Werte ein – dann stehen sie hier, wenn du dran bist.</div>` : "";
  return `<div class="panel zug-kurz">
    <div class="zk-oben">
      <div class="zk-karte">${cardSlot(mine.id, mine.card, mine.status, "", { open: true })}</div>
      <div class="zk-werte">${kacheln}</div>
    </div>
    ${abzug}
    ${extras.hints ? `<div class="center" style="margin-top:6px">${extras.hints}</div>` : ""}
    ${extras.timer ? `<div style="margin-top:8px">${extras.timer}</div>` : ""}
    ${extras.angeschlagenHinweis || ""}
    ${waffen ? `<div class="zk-waffen">${waffen}</div>` : ""}
    ${fert ? `<div class="zk-ferts">${fert}</div>` : ""}
    ${leer}
    <div class="row zk-knoepfe">
      <button type="button" class="ghost small" data-act="regeln-oeffnen">📖 Regeln</button>
      <button type="button" class="ghost small" data-act="zug-alles">Alles zeigen ▾</button>
    </div>
    ${extras.anfragen || ""}
  </div>`;
}

// Eigener Klick-Handler (wie protokoll.js): der große in ereignisse.js kennt
// diese Knöpfe nicht.
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "regeln-zu") { e.preventDefault(); Regeln.offen = false; render(); }
  else if (act === "regeln-oeffnen") { e.preventDefault(); regelnOeffnen(); }
  else if (act === "regeln-auf") {
    e.preventDefault();
    const k = t.dataset.k;
    if (Regeln.auf.has(k)) Regeln.auf.delete(k); else Regeln.auf.add(k);
    render();
  } else if (act === "zug-alles") {
    e.preventDefault();
    const mine = myCombatant();
    if (mine) App.zugAllesZeigen = zugSchluessel(App.state, mine);
    render();
  }
});
document.addEventListener("change", (e) => {
  if (e.target && e.target.dataset && e.target.dataset.act === "toggle-zug-kurz") {
    try { localStorage.setItem("zugKurz", e.target.checked ? "on" : "off"); } catch { /* privates Fenster */ }
    render();
  }
});
