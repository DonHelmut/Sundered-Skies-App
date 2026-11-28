// 💰 Geld: Börse je Charakter + 👥 Gruppenkasse (Kalle, 18.11.2026, Variante B
// „eigener Reiter Geld"). Mockups: Projektordner screenshots/geld/B-runde3/.
//
// Währung im Himmel nach der Barriere, wie Bargeld in drei Sorten:
//   Fater  – schwarzer Seelenstein, unheimlich viel wert („eine Milliarde")
//   Lose   – Scheine mit festem Wert (1/2 … 1/100.000 Fater). Man BEZAHLT
//            damit. Kein Glücksspiel (der erste Entwurf hatte „Einlösen –
//            Gewinn/Niete", Kalle: „das ist kein Gamble").
//   Münzen – Kleingeld; Name stellt der SL ein (App.state.muenzName).
// Die App rechnet nicht um – Kalle kennt den Kurs selbst nicht. Sie zählt nur.
//
// Eingabe ohne Tastatur, wo es geht (Bedienbarkeit zuerst): Münzen über einen
// eigenen Zahlenblock (die Handy-Tastatur schob sonst das Blatt hoch), Lose
// werden nur angetippt, nie als Bruch getippt, Fater mit − / +.
// Wörter (Kalle: „Bekommen" klang falsch): Börse „Bezahlen", Gruppenkasse
// „Herausnehmen / Einlegen", SL „Abziehen / Geben".
// Neues Geld kommt NUR vom SL. Die Börse hatte anfangs „Einstecken" (+ aus dem
// Nichts); Kalle 20.11.2026: „Spieler können sich selber Geld geben – macht
// keinen Sinn." Spieler bewegen nur, was schon da ist (der Server prüft das
// auch, Game.geld_spieler).

const LOS_WERTE = [2, 5, 10, 100, 1000, 10000, 100000];
const GELD_STEINTEXT = "Seelenstein – ändert ein Schicksal";

App.geld = { konto: "ich", blatt: null, vlOffen: new Set() };

function muenzName() { return (App.state && App.state.muenzName) || "Münzen"; }
function nennerText(n) { return n >= 1000 ? Number(n).toLocaleString("de-DE") : String(n); }

// --- Symbole (SVG) -------------------------------------------------------------
// Die Verläufe liegen EINMAL im Dokument (geldDefs) statt in jedem Symbol:
// gleiche IDs bei jedem Neuzeichnen, sonst wäre jedes HTML anders und der
// DOM-Abgleich müsste jedes Mal alles neu bauen.
(function geldDefs() {
  const svg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <radialGradient id="gf-schein" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="#a99cff" stop-opacity=".5"/><stop offset=".6" stop-color="#6a58c8" stop-opacity=".14"/><stop offset="1" stop-color="#6a58c8" stop-opacity="0"/></radialGradient>
    <radialGradient id="gf-stein" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#5d576f"/><stop offset=".3" stop-color="#25212f"/><stop offset=".72" stop-color="#0b0a10"/><stop offset="1" stop-color="#020203"/></radialGradient>
    <linearGradient id="gf-rauch" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#8d889c" stop-opacity=".75"/><stop offset=".6" stop-color="#8d889c" stop-opacity=".3"/><stop offset="1" stop-color="#8d889c" stop-opacity="0"/></linearGradient>
    <filter id="gf-weich" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2"/></filter>
    <filter id="gf-glut" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1"/></filter>
    <clipPath id="gf-form"><path d="M31 18c11-1 19 8 19 20 0 11-8 19-18 19-11 0-19-7-18-19 1-11 7-19 17-20z"/></clipPath>
    <radialGradient id="gm-bronze" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#f6dcb6"/><stop offset=".35" stop-color="#c88c55"/><stop offset=".8" stop-color="#7d4d24"/><stop offset="1" stop-color="#5b3616"/></radialGradient>
  </defs></svg>`;
  const setzen = () => document.body.insertAdjacentHTML("afterbegin", svg);
  if (document.body) setzen(); else document.addEventListener("DOMContentLoaded", setzen);
})();

// Fater nach Kalles Bild: schwarzer Glanzstein, Rauch, violett glühende Adern,
// Lichtfunke. Klein (< 30 px) ohne Rauch und Schein - sonst nur Matsch.
// Der Rauch „atmet" über opacity/transform (kein animierter filter, s. CLAUDE.md).
function faterSvg(px) {
  const klein = px < 30;
  return `<svg class="g-fater" width="${px}" height="${px}" viewBox="0 0 64 64" aria-hidden="true">
${klein ? "" : `<circle cx="32" cy="40" r="27" fill="url(#gf-schein)"/>
<g class="g-rauch" filter="url(#gf-weich)" fill="none" stroke="url(#gf-rauch)" stroke-linecap="round">
<path d="M22 26c-6-4-2-9-6-13s1-8-2-12" stroke-width="4"/><path d="M41 23c5-4 1-8 5-12s-1-7 2-10" stroke-width="3.5"/><path d="M31 19c-3-5 3-7 0-12" stroke-width="3"/></g>`}
<path d="M31 18c11-1 19 8 19 20 0 11-8 19-18 19-11 0-19-7-18-19 1-11 7-19 17-20z" fill="url(#gf-stein)"/>
<g clip-path="url(#gf-form)" fill="none" stroke-linecap="round">
<g stroke="#9d8cff" stroke-width="2.4" opacity=".55" filter="url(#gf-glut)"><path d="M18 42c5-5 9-1 14-6s8-3 11-1"/><path d="M23 50c5-3 9 1 14-4"/></g>
<g stroke="#d6ceff" stroke-width=".8" opacity=".75"><path d="M18 42c5-5 9-1 14-6s8-3 11-1"/><path d="M23 50c5-3 9 1 14-4"/><path d="M39 26c-3 3-1 6-5 8"/></g></g>
<ellipse cx="25" cy="27" rx="6.5" ry="3.4" fill="#fff" opacity=".42" transform="rotate(-30 25 27)" filter="url(#gf-glut)"/>
<g transform="translate(25.5 26.5)"><circle r="${klein ? 4 : 6}" fill="#eef0ff" opacity=".5" filter="url(#gf-glut)"/>
<path d="M0-9 1-1 9 0 1 1 0 9-1 1-9 0-1-1z" fill="#fff" transform="scale(${klein ? 0.75 : 1})"/></g></svg>`;
}
function muenzeSvg(px, stil = "") {
  return `<svg class="g-muenze" width="${px}" height="${px}" viewBox="0 0 32 32" aria-hidden="true"${stil ? ` style="${stil}"` : ""}>
<circle cx="16" cy="17" r="13.5" fill="#3a220c" opacity=".35"/><circle cx="16" cy="16" r="13.5" fill="url(#gm-bronze)"/>
<circle cx="16" cy="16" r="10.3" fill="none" stroke="#5e3a18" stroke-opacity=".55"/>
<circle cx="16" cy="16" r="12.6" fill="none" stroke="#ffe7c2" stroke-opacity=".35" stroke-width=".7" stroke-dasharray="1 1.4"/>
<path d="M16 9.5c3 0 5 2.8 5 6.6 0 3.4-2.3 6-5 6s-5-2.6-5-6c0-3.8 2-6.6 5-6.6z" fill="#6a4320" opacity=".55"/>
<path d="M14 12.5c.8-.9 1.8-1.2 2.6-1.1" stroke="#ffe9c9" stroke-opacity=".7" stroke-width=".9" fill="none" stroke-linecap="round"/></svg>`;
}
function muenzStapel(px = 34) {
  return `<span class="g-stapel">${[0, 1, 2].map((i) => muenzeSvg(px, `left:${4 + i * 7}px;top:${18 - i * 8}px`)).join("")}</span>`;
}
// Los = Schein auf Pergament mit Goldrand, Wert als Bruch.
function losHtml(nenner, klasse = "", extra = "") {
  return `<span class="g-los${klasse ? " " + klasse : ""}"${extra}><sup>1</sup><i>⁄</i><sub>${nennerText(nenner)}</sub></span>`;
}
function losFacher(werte) {
  // Keine Lose: ein leerer Schein (ohne Wert - ein „1/1.000" sah aus, als läge eins da).
  if (!werte.length) return `<span class="g-facher leer"><span class="g-los blanko"></span></span>`;
  const w = werte.slice(0, 3);
  const mitte = (w.length - 1) / 2;
  return `<span class="g-facher">${w.map((n, i) =>
    losHtml(n, "", ` style="transform:rotate(${(i - mitte) * 14}deg) translateX(${(i - mitte) * 6}px)"`)).join("")}</span>`;
}

// --- Daten -----------------------------------------------------------------------
function geldLeer() { return { stand: { fater: 0, lose: {}, muenzen: 0 }, verlauf: [] }; }
function geldKonto(konto) {
  const s = App.state || {};
  if (konto === "gruppe") return s.gruppenkasse || geldLeer();
  if (konto === "ich") return s.meinGeld || geldLeer();
  return (s.geldAlle && s.geldAlle[konto]) || geldLeer();   // SL: Charakter-ID
}
function loseListe(stand) {   // [[nenner, anzahl]] - wertvollste zuerst
  return Object.entries(stand.lose || {}).map(([k, v]) => [Number(k), v]).filter(([k, v]) => k && v).sort((a, b) => a[0] - b[0]);
}
function geldBestand(stand, art, nenner) {
  return art === "los" ? (stand.lose || {})[String(nenner)] || 0 : stand[art] || 0;
}
function loseZusammen(stand) { return loseListe(stand).reduce((s, [, n]) => s + n, 0); }
function loseKurz(stand) {
  const l = loseListe(stand);
  if (!l.length) return "Noch keine Lose";
  return l.map(([k, n]) => `${n > 1 ? `${n}× ` : ""}${k === 2 ? "½" : `1/${nennerText(k)}`}`).join(" · ");
}
function geldMenge(e) {   // „+2 [Los]", „−12 [Münze]"
  const z = e.n > 0 ? "+" : "−";
  const n = Math.abs(e.n);
  const sym = e.art === "fater" ? faterSvg(18) : e.art === "los" ? losHtml(e.nenner, "klein") : muenzeSvg(16);
  return `<span class="g-menge ${e.n > 0 ? "plus" : "minus"}">${z}${e.art === "los" && n === 1 ? "" : n}${e.art === "los" && n > 1 ? "×" : ""} ${sym}</span>`;
}
function geldZeit(ts) {
  if (!ts) return "";
  const d = new Date(ts), h = new Date();
  const uhr = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const tage = Math.round((new Date(h.toDateString()) - new Date(d.toDateString())) / 864e5);
  return tage === 0 ? `heute ${uhr}` : tage === 1 ? `gestern ${uhr}` : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
// Eingeklappt nur die letzten 3 (Kalle 22.11.2026: „Verlauf wird zu lang").
// Der Schalter sitzt in der Überschrift ÜBER der Liste (Kalles Wahl A): beim
// Aufklappen wächst die Liste nach unten, der Schalter bleibt unter dem Finger.
// key: welches Konto (Handy „ich"/„gruppe", SL „sl-<id>"), offen gilt je Konto.
const GELD_VL_KURZ = 3;
function geldVlKnopf(liste, key) {
  const n = (liste || []).length;
  if (n <= GELD_VL_KURZ) return "";
  const offen = App.geld.vlOffen.has(key);
  return `<button type="button" class="g-vl-knopf" data-act="geld-vl" data-k="${esc(key)}" aria-expanded="${offen}">${offen ? "Weniger ▴" : `Alle ${n} ▾`}</button>`;
}
function geldVerlaufHtml(liste, mitWem, key) {
  const alle = [...(liste || [])].reverse();
  if (!alle.length) return `<div class="g-leer">Noch keine Buchung.</div>`;
  const zeilen = App.geld.vlOffen.has(key) ? alle : alle.slice(0, GELD_VL_KURZ);
  return `<ul class="g-verlauf">${zeilen.map((e) => {
    const text = e.wofuer || (e.n > 0 ? "Eingesteckt" : "Bezahlt");
    const wer = e.vonId === "sl" ? "SL" : zoneInitials(e.von || "?");
    return `<li><span class="g-ini">${esc(wer)}</span><span class="g-vt">${esc(text)}<small>${mitWem && e.von ? `${esc(e.von)} · ` : ""}${geldZeit(e.ts)}</small></span>${geldMenge(e)}</li>`;
  }).join("")}</ul>`;
}

// --- Handy: Reiter „Geld" ---------------------------------------------------------
function geldReiterLabel() { return `${faterSvg(18)} Geld`; }

function geldTruheHtml(stand, act, ziel, kasse = false) {
  const zeile = (art, bild, zahl, name, unter) => `<button type="button" class="g-zeile" data-act="${act}" data-art="${art}"${ziel ? ` data-ziel="${esc(ziel)}"` : ""}>
      <span class="g-bild${Number(String(zahl).replace(/\D/g, "")) ? "" : " null"}">${bild}</span><span class="g-txt"><b>${rollZahl(`g-${act}-${ziel || App.geld.konto || "ich"}-${art}`, zahl)}<em>${esc(name)}</em></b><small>${esc(unter)}</small></span><span class="g-pf" aria-hidden="true">›</span></button>`;
  const lose = loseListe(stand);
  const zahl = loseZusammen(stand);
  // Gruppenkasse sichtbar anders (Bedienbarkeit 25.11.2026): Börse und Kasse
  // sahen gleich aus - man verwechselte leicht, wessen Geld man ausgibt.
  return `<div class="g-truhe${kasse ? " g-kasse" : ""}">
    ${kasse ? `<div class="g-kasse-kopf">👥 Gruppenkasse · gehört allen</div>` : ""}
    ${zeile("fater", faterSvg(62), stand.fater || 0, "Fater", GELD_STEINTEXT)}
    ${zeile("los", losFacher(lose.map(([k]) => k)), zahl, zahl === 1 ? "Los" : "Lose", loseKurz(stand))}
    ${zeile("muenzen", muenzStapel(), (stand.muenzen || 0).toLocaleString("de-DE"), muenzName(), "Kleingeld")}
  </div>`;
}

function geldSeiteHtml() {
  if (!App.state.meinGeld) {
    return `<div class="panel"><div class="muted">Erst einem Charakter beitreten – die Börse gehört zum Charakter.</div></div>`;
  }
  const konto = App.geld.konto === "gruppe" ? "gruppe" : "ich";
  const k = geldKonto(konto);
  return `<div class="g-seite">
    <div class="g-seg" role="tablist">
      <button type="button" class="${konto === "ich" ? "on" : ""}" data-act="geld-konto" data-k="ich" role="tab" aria-selected="${konto === "ich"}">Meine Börse</button>
      <button type="button" class="${konto === "gruppe" ? "on" : ""}" data-act="geld-konto" data-k="gruppe" role="tab" aria-selected="${konto === "gruppe"}">👥 Gruppenkasse</button>
    </div>
    ${geldTruheHtml(k.stand, "geld-auf", undefined, konto === "gruppe")}
    <div class="g-ueber">Verlauf${geldVlKnopf(k.verlauf, konto)}</div>
    ${geldVerlaufHtml(k.verlauf, konto === "gruppe", konto)}
  </div>`;
}

// --- Blatt (Handy + SL) -------------------------------------------------------------
// App.geld.blatt = { art, betrag, anzahl, nenner, quelle, wofuer }
//   quelle beim Los: "eigen" (aus der Börse/Kasse), "neu" (Wert aus dem Raster,
//   nur SL), "kasse" (Spieler, Gruppenkasse: Los in der Kasse)
// SL: zusätzlich ziele (Set aus Charakter-IDs / "gruppe").
function geldBlattAuf(art, ziel) {
  App.geld.blatt = { art, betrag: "", anzahl: 1, nenner: null, quelle: null, wofuer: "" };
  if (App.role === "gm") App.geld.blatt.ziele = new Set(ziel ? [ziel] : []);
  render();
}
function geldBlattZu() { App.geld.blatt = null; render(); }

function geldMenge2(b) {   // ausgewählte Menge
  if (b.art === "muenzen") return parseInt(b.betrag, 10) || 0;
  return b.anzahl || 0;
}
function slZiele() {   // Wer steht in der SL-Liste? (Charaktere am Tisch, sonst alle)
  const s = App.state;
  const amTisch = new Set((s.combatants || []).filter((c) => c.characterId).map((c) => c.characterId));
  const roster = (s.roster || []).filter((r) => r && r.id);
  const da = roster.filter((r) => amTisch.has(r.id) || hatGeld(geldKonto(r.id).stand));
  return da.length ? da : roster;
}
function hatGeld(st) { return !!(st.fater || st.muenzen || loseZusammen(st)); }

function geldBlattHtml() {
  const b = App.geld.blatt;
  if (!b || !App.state) return "";
  if (App.role !== "gm" && !App.state.meinGeld) return "";
  const sl = App.role === "gm";
  const konto = sl ? null : (App.geld.konto === "gruppe" ? "gruppe" : "ich");
  const eigen = sl ? null : geldKonto("ich").stand;
  const kasse = geldKonto("gruppe").stand;
  const hier = sl ? (b.ziele.size === 1 ? geldKonto([...b.ziele][0]).stand : null) : geldKonto(konto).stand;
  const name = b.art === "fater" ? "Fater" : b.art === "los" ? "Lose" : muenzName();
  const bild = b.art === "fater" ? faterSvg(40) : b.art === "los" ? losFacher(loseListe(hier || eigen || kasse).map(([k]) => k)) : muenzStapel(30);
  const habe = (st) => b.art === "los" ? `${loseZusammen(st)} ${loseZusammen(st) === 1 ? "Los" : "Lose"}` : `${geldBestand(st, b.art).toLocaleString("de-DE")} ${name}`;
  const unter = sl ? (hier ? `Hat ${habe(hier)}` : `${b.ziele.size || "Kein"} Ziel${b.ziele.size === 1 ? "" : "e"} gewählt`)
    : konto === "ich" ? `Du hast ${habe(eigen)}` : `In der Kasse: ${habe(kasse)}`;
  const n = geldMenge2(b);

  // Ziel-Chips (nur SL): Kasse, jeder Charakter, „Jeden".
  const ziele = sl ? (() => {
    const leute = slZiele();
    const chip = (id, text) => `<button type="button" class="g-chip${b.ziele.has(id) ? " on" : ""}" data-act="geld-sl-ziel" data-ziel="${esc(id)}">${text}</button>`;
    const alle = leute.length && leute.every((r) => b.ziele.has(r.id));
    return `<div class="g-chips">${chip("gruppe", "👥 Kasse")}${leute.map((r) => chip(r.id, esc(r.name))).join("")}
      <button type="button" class="g-chip jeder${alle ? " on" : ""}" data-act="geld-sl-jeden">Jeden</button></div>`;
  })() : "";

  let mitte = "";
  if (b.art === "muenzen") {
    mitte = `<div class="g-anzeige">${n ? n.toLocaleString("de-DE") : "0"}<small>${esc(muenzName())}</small></div>
      <div class="g-tasten">${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((t) => `<button type="button" data-act="geld-taste" data-t="${t}">${t}</button>`).join("")}
        <button type="button" class="leise" data-act="geld-taste" data-t="C" aria-label="Löschen">C</button>
        <button type="button" data-act="geld-taste" data-t="0">0</button>
        <button type="button" class="leise" data-act="geld-taste" data-t="⌫" aria-label="Zurück">⌫</button></div>`;
  } else if (b.art === "fater") {
    mitte = `<div class="g-buehne">${faterSvg(104)}<small>„Ein Stein, der ein Schicksal wendet.“</small></div>
      ${stepperHtml(b.anzahl)}`;
  } else {
    // Lose: antippen statt tippen.
    const ablage = (titel, hinweis, st, quelle) => {
      const l = loseListe(st);
      return `<div class="g-ueber">${titel}<i>${l.length ? hinweis : ""}</i></div>
        <div class="g-ablage">${l.length ? l.map(([k, anz]) => {
          const an = b.quelle === quelle && b.nenner === k;
          return `<button type="button" class="g-los-platz" data-act="geld-los" data-quelle="${quelle}" data-n="${k}" aria-label="Los 1/${k}, ${anz} Stück">
            ${losHtml(k, "gross" + (an ? (quelle === "eigen" && konto === "gruppe" ? " wahl" : " weg") : ""))}
            ${an && anz > 1 ? `<span class="g-anz sel">${b.anzahl} von ${anz}</span>` : anz > 1 ? `<span class="g-anz">×${anz}</span>` : ""}</button>`;
        }).join("") : `<span class="g-ablage-leer">Keine Lose</span>`}</div>`;
    };
    const raster = (titel) => `<div class="g-ueber">${titel}<i>Wert antippen</i></div>
      <div class="g-losraster">${LOS_WERTE.map((k) => `<button type="button" data-act="geld-los" data-quelle="neu" data-n="${k}" aria-label="Los 1/${k}">${losHtml(k, "gross" + (b.quelle === "neu" && b.nenner === k ? " wahl" : ""))}</button>`).join("")}
        ${(() => {
          const eigenerWert = b.quelle === "neu" && b.nenner && !LOS_WERTE.includes(b.nenner);
          return `<button type="button" data-act="geld-los-anderer" aria-label="Anderer Wert">${eigenerWert ? losHtml(b.nenner, "gross wahl") : `<span class="g-los gross anderer">1⁄…</span>`}</button>`;
        })()}</div>`;
    if (sl) mitte = (hier ? ablage("Hat", "antippen zum Abziehen", hier, "eigen") : "") + raster(hier ? "Oder Wert wählen" : "Welches Los?");
    else if (konto === "ich") mitte = ablage("Deine Lose", "antippen zum Bezahlen", eigen, "eigen");
    else mitte = ablage("In der Kasse", "antippen zum Herausnehmen", kasse, "kasse") + ablage("Aus deiner Börse einlegen", "antippen", eigen, "eigen");
    if (b.nenner) mitte += stepperHtml(b.anzahl);
  }

  // Knöpfe: was geht, steht da; was nicht reicht, ist ausgegraut (mit Grund).
  const los = b.art === "los" ? losHtml(b.nenner || 2, "klein") : "";
  const reicht = (st) => !!st && n > 0 && geldBestand(st, b.art, b.nenner) >= n;
  const knopf = (was, text, klasse, ok, grund) => `<button type="button" class="g-k ${klasse}" data-act="geld-buchen" data-was="${was}"${ok ? "" : ` disabled title="${esc(grund || "")}"`}>${text}</button>`;
  const mengeText = b.art === "los" ? `${n > 1 ? `${n} × ` : ""}${los}` : "";
  const leer = !n || (b.art === "los" && !b.nenner);
  const zuwenig = (st) => leer ? "Erst Menge wählen" : "Nicht genug da";
  // Spieler ohne Bestand: sagen, woher Geld kommt, statt nur grauer Knöpfe.
  const vomSl = `<div class="g-tipp">Neues Geld gibt dir der Spielleiter.</div>`;
  let knoepfe = "";
  if (sl) {
    const ok = !leer && b.ziele.size;
    const nehmenOk = ok && [...b.ziele].every((z) => reicht(geldKonto(z).stand));
    knoepfe = `<div class="g-zwei">${knopf("nehmen", `− Abziehen ${mengeText}`, "ab", nehmenOk, "Nicht jeder hat genug")}${knopf("geben", `+ Geben ${mengeText}`, "zu", ok, "Erst Ziel und Menge wählen")}</div>`;
  } else if (konto === "ich") {
    if (b.art === "los") {
      knoepfe = b.quelle === "eigen"
        ? `${knopf("bezahlen", `− ${mengeText} bezahlen`, "ab voll", reicht(eigen), zuwenig())}
           <button type="button" class="g-leicht" data-act="geld-buchen" data-was="einlegen"${reicht(eigen) ? "" : " disabled"}>↗ Stattdessen in die Gruppenkasse legen</button>`
        : loseZusammen(eigen) ? `<div class="g-tipp">Los antippen zum Bezahlen.</div>` : vomSl;
    } else {
      knoepfe = `${geldBestand(eigen, b.art) ? "" : vomSl.replace("g-tipp", "g-tipp klein")}${knopf("bezahlen", "− Bezahlen", "ab voll", reicht(eigen), zuwenig())}
        <button type="button" class="g-leicht" data-act="geld-buchen" data-was="einlegen"${reicht(eigen) ? "" : " disabled"}>↗ In die Gruppenkasse legen</button>`;
    }
  } else if (b.art === "los") {
    knoepfe = b.quelle === "kasse"
      ? `${knopf("herausnehmen", `↙ ${mengeText} herausnehmen`, "zu voll", reicht(kasse), zuwenig())}
         <button type="button" class="g-leicht" data-act="geld-buchen" data-was="kasse_bezahlen"${reicht(kasse) ? "" : " disabled"}>− Direkt aus der Kasse bezahlen</button>`
      : b.quelle === "eigen" ? knopf("einlegen", `↗ ${mengeText} einlegen`, "zu voll", reicht(eigen), zuwenig())
      : `<div class="g-tipp">Los antippen – aus der Kasse zum Herausnehmen, aus deiner Börse zum Einlegen.</div>`;
  } else {
    knoepfe = `<div class="g-zwei">${knopf("herausnehmen", "↙ Herausnehmen", "ab", reicht(kasse), zuwenig())}${knopf("einlegen", "↗ Einlegen", "zu", reicht(eigen), leer ? zuwenig() : "Du hast nicht genug")}</div>
      <button type="button" class="g-leicht" data-act="geld-buchen" data-was="kasse_bezahlen"${reicht(kasse) ? "" : " disabled"}>− Direkt aus der Kasse bezahlen</button>`;
  }

  const titel = sl ? `${name} · ${b.ziele.size === 1 ? esc(zielName([...b.ziele][0])) : "Geben oder abziehen"}` : (konto === "gruppe" ? `👥 ${name} der Kasse` : name);
  return `<div class="g-blatt-hg" data-act="geld-zu"></div>
    <div class="g-blatt${sl ? " sl" : ""}" role="dialog" aria-label="${esc(name)}">
      <div class="g-griff"></div>
      <div class="g-kopf"><span class="g-kbild">${bild}</span><span class="g-kt"><b>${titel}</b><small>${unter}</small></span>
        <button type="button" class="g-x" data-act="geld-zu" data-zurueck aria-label="Schließen">✕</button></div>
      ${ziele}
      ${sl ? `<div class="g-seg g-art">${[["fater", `${faterSvg(22)} Fater`], ["los", `${losHtml(2, "klein")} Los`], ["muenzen", `${muenzeSvg(18)} ${esc(muenzName())}`]].map(([a, t]) =>
        `<button type="button" class="${b.art === a ? "on" : ""}" data-act="geld-sl-art" data-art="${a}">${t}</button>`).join("")}</div>` : ""}
      <div class="g-blatt-inhalt">${mitte}</div>
      <input id="geld-wofuer" class="g-wofuer" maxlength="80" placeholder="Wofür? (optional)" autocomplete="off" enterkeyhint="done" value="${esc(b.wofuer || "")}" aria-label="Wofür">
      ${knoepfe}
    </div>`;
}
function stepperHtml(n) {
  return `<div class="g-stepper"><button type="button" data-act="geld-anzahl" data-d="-1" aria-label="Weniger"${n <= 1 ? " disabled" : ""}>−</button><b>${n}</b><button type="button" data-act="geld-anzahl" data-d="1" aria-label="Mehr">+</button></div>`;
}
function zielName(id) {
  if (id === "gruppe") return "Gruppenkasse";
  const r = (App.state.roster || []).find((x) => x.id === id);
  return r ? r.name : "?";
}

// --- SL: Panel „Geld" (hieß bis 25.11.2026 „Vermögen" – am Handy hieß es schon Geld) -----------------------------------------------------------
function renderGeldPanel() {
  const leute = slZiele();
  const zeile = (id, name, st, gr) => {
    const lose = loseListe(st);
    return `<button type="button" class="g-sl-zeile${gr ? " gr" : ""}" data-act="geld-sl-auf" data-ziel="${esc(id)}" title="Geben oder abziehen, Verlauf">
      <span class="g-ini">${gr ? "👥" : esc(zoneInitials(name))}</span><span class="g-sl-name">${esc(name)}</span>
      <span class="g-sl-werte"><span>${faterSvg(gr ? 24 : 20)} ${rollZahl(`gsl-${id}-f`, st.fater || 0)}</span>
      ${lose.slice(0, 3).map(([k, a]) => `<span>${a > 1 ? `${a}×` : ""}${losHtml(k, "klein")}</span>`).join("")}${lose.length > 3 ? `<span class="muted">+${lose.length - 3}</span>` : ""}
      <span>${muenzeSvg(gr ? 20 : 16)} ${rollZahl(`gsl-${id}-m`, (st.muenzen || 0).toLocaleString("de-DE"))}</span></span></button>`;
  };
  const offen = App.geld.slVerlauf;
  const vl = offen ? geldKonto(offen) : null;
  return section("geld", `${faterSvg(20)} Geld`, `
    <div class="g-sl-kopf">
      <button type="button" class="primary small" data-act="geld-sl-beute">＋ Beute verteilen</button>
      <button type="button" class="ghost small" data-act="geld-muenzname" title="Name des Kleingelds ändern">✎ ${esc(muenzName())} umbenennen</button>
    </div>
    <div class="g-sl-liste">${zeile("gruppe", "Gruppenkasse", geldKonto("gruppe").stand, true)}
      ${leute.map((r) => zeile(r.id, r.name, geldKonto(r.id).stand)).join("")}</div>
    <div class="g-sl-vl-wahl">Verlauf: ${[["gruppe", "👥 Kasse"], ...leute.map((r) => [r.id, esc(r.name)])].map(([id, t]) =>
      `<button type="button" class="g-chip klein${offen === id ? " on" : ""}" data-act="geld-sl-verlauf" data-ziel="${esc(id)}">${t}</button>`).join("")}${vl ? geldVlKnopf(vl.verlauf, `sl-${offen}`) : ""}</div>
    ${vl ? geldVerlaufHtml(vl.verlauf, true, `sl-${offen}`) : ""}`);
}

// --- Klicks ----------------------------------------------------------------------
function geldBuchen(was) {
  const b = App.geld.blatt;
  if (!b) return;
  const n = geldMenge2(b);
  if (!n || (b.art === "los" && !b.nenner)) return;
  const wofuer = (($("geld-wofuer") || {}).value || b.wofuer || "").trim();
  const posten = { art: b.art, anzahl: n, wofuer };
  if (b.art === "los") posten.nenner = b.nenner;
  if (App.role === "gm") {
    if (!b.ziele.size) return;
    gmAction({ type: "geld", was, ziele: [...b.ziele], ...posten });
  } else {
    gmAction({ type: "geld", was, ...posten });
  }
  const name = b.art === "fater" ? (n === 1 ? "Fater" : "Fater") : b.art === "los" ? (n === 1 ? `Los 1/${nennerText(b.nenner)}` : `Lose 1/${nennerText(b.nenner)}`) : muenzName();
  const verb = { bezahlen: "bezahlt", einlegen: "in die Kasse gelegt", herausnehmen: "herausgenommen",
    kasse_bezahlen: "aus der Kasse bezahlt", geben: "gegeben", nehmen: "abgezogen" }[was] || "gebucht";
  toast(`✓ ${n.toLocaleString("de-DE")} ${name} ${verb}`);
  App.geld.blatt = null;
  render();
}

document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "geld-wofuer" && App.geld.blatt) App.geld.blatt.wofuer = e.target.value;
});
document.addEventListener("keydown", (e) => {
  const b = App.geld.blatt;
  if (!b) return;
  if (e.key === "Escape") { e.preventDefault(); geldBlattZu(); return; }
  if (e.target && e.target.id === "geld-wofuer") {
    if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
    return;
  }
  if (e.target && /INPUT|TEXTAREA/.test(e.target.nodeName)) return;
  // Laptop: Ziffern direkt tippen statt auf den Block zu klicken.
  if (b.art === "muenzen" && /^[0-9]$/.test(e.key)) { e.preventDefault(); geldTaste(e.key); }
  else if (b.art === "muenzen" && e.key === "Backspace") { e.preventDefault(); geldTaste("⌫"); }
});
function geldTaste(t) {
  const b = App.geld.blatt;
  if (t === "C") b.betrag = "";
  else if (t === "⌫") b.betrag = b.betrag.slice(0, -1);
  else if (b.betrag.length < 9) b.betrag = (b.betrag + t).replace(/^0+/, "");
  render();
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || !t.dataset.act.startsWith("geld-")) return;
  e.preventDefault();
  const b = App.geld.blatt;
  switch (t.dataset.act) {
    case "geld-konto": App.geld.konto = t.dataset.k === "gruppe" ? "gruppe" : "ich"; render(); break;
    case "geld-auf": geldBlattAuf(t.dataset.art); break;
    case "geld-zu": geldBlattZu(); break;
    case "geld-taste": if (b) geldTaste(t.dataset.t); break;
    case "geld-anzahl": {
      if (!b) break;
      let max = 1e6;
      if (b.art === "los" && b.quelle !== "neu") {
        const st = b.quelle === "kasse" ? geldKonto("gruppe").stand
          : App.role === "gm" ? geldKonto([...b.ziele][0]).stand : geldKonto("ich").stand;
        max = Math.max(1, geldBestand(st, "los", b.nenner));
      }
      b.anzahl = Math.max(1, Math.min(max, (b.anzahl || 1) + Number(t.dataset.d)));
      render();
      break;
    }
    case "geld-los": {
      if (!b) break;
      const nenner = Number(t.dataset.n), quelle = t.dataset.quelle;
      if (b.quelle === quelle && b.nenner === nenner) { b.quelle = null; b.nenner = null; }
      else { b.quelle = quelle; b.nenner = nenner; b.anzahl = 1; }
      render();
      break;
    }
    case "geld-los-anderer": {
      if (!b) break;
      const w = await eingabe("Los mit welchem Wert? Nur die Zahl unter dem Strich, z. B. 50 000 für 1/50.000.", "", "Übernehmen");
      const n = parseInt(String(w || "").replace(/[^0-9]/g, ""), 10);
      if (n >= 2 && n <= 10000000) { b.quelle = "neu"; b.nenner = n; b.anzahl = 1; }
      render();
      break;
    }
    case "geld-buchen": if (!t.disabled) geldBuchen(t.dataset.was); break;
    // SL
    case "geld-sl-auf": geldBlattAuf("muenzen", t.dataset.ziel); App.geld.slVerlauf = t.dataset.ziel; render(); break;
    case "geld-sl-beute": {
      geldBlattAuf("los");
      slZiele().forEach((r) => App.geld.blatt.ziele.add(r.id));
      render();
      break;
    }
    case "geld-sl-ziel": {
      if (!b) break;
      const z = t.dataset.ziel;
      if (b.ziele.has(z)) b.ziele.delete(z); else b.ziele.add(z);
      if (b.quelle === "eigen") { b.quelle = null; b.nenner = null; }
      render();
      break;
    }
    case "geld-sl-jeden": {
      if (!b) break;
      const leute = slZiele().map((r) => r.id);
      const alle = leute.every((id) => b.ziele.has(id));
      b.ziele = new Set(alle ? [] : leute);
      render();
      break;
    }
    case "geld-sl-art": if (b) { b.art = t.dataset.art; b.quelle = null; b.nenner = null; b.anzahl = 1; b.betrag = ""; render(); } break;
    case "geld-sl-verlauf": App.geld.slVerlauf = App.geld.slVerlauf === t.dataset.ziel ? null : t.dataset.ziel; render(); break;
    case "geld-vl": {
      const k = t.dataset.k;
      if (App.geld.vlOffen.has(k)) App.geld.vlOffen.delete(k); else App.geld.vlOffen.add(k);
      render();
      break;
    }
    case "geld-muenzname": {
      const neu = await eingabe("Wie heißt das Kleingeld?", muenzName(), "Übernehmen");
      if (neu != null) gmAction({ type: "set_muenz_name", name: neu });
      break;
    }
  }
});
