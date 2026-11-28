// Spielabend aufnehmen (nur SL-Laptop) und daraus einen Protokoll-Prompt bauen.
// Teil der Client-Logik, klassisches <script> nach sl.js (gemeinsamer globaler
// Bereich). Server-Seite: server/aufnahme.py.
//
// Aufgenommen wird im Browser des Laptops: über localhost darf er ohne HTTPS
// aufs Mikro. Die Handys fielen aus (kein HTTPS, Mikro stoppt bei Bildschirm
// aus, Akku). Alle paar Sekunden geht ein Stück an den Server - stürzt der
// Browser ab, fehlen höchstens die letzten Sekunden. Der Server schreibt live
// mit und transkribiert danach genau (server/sprache.py, alles lokal); daraus
// baut die App den Claude-Prompt.

// 3 s statt vorher 10 s: die Live-Mitschrift liest die wachsende Datei mit,
// jedes Stück Wartezeit kommt sonst obendrauf.
const AUFN_STUECK_MS = 3000;

const Aufn = {
  status: null,     // Antwort von /api/aufnahme (Liste, laufende Aufnahme)
  laedt: false,
  rec: null,        // MediaRecorder, solange DIESER Tab aufnimmt
  stream: null,
  name: null,
  start: 0,
  bytes: 0,
  kette: Promise.resolve(),   // Stücke strikt nacheinander senden (Reihenfolge!)
  wakeLock: null,
  geraete: [],
  neustart: false,
  audioCtx: null,   // nur für die Pegelanzeige
  analyser: null,
  pegel: 0,         // 0..1, geglättet
  stilleSeit: 0,    // seit wann praktisch nichts ankommt (falsches/stummes Mikro)
  live: [],         // letzte Zeilen der Live-Mitschrift (server/sprache.py)
  liveN: 0,
  liveNamen: {},    // „S01" -> „Korgo (Tim)", vom SL live zugeordnet
  pauseSeit: 0,     // ⏸: seit wann angehalten (0 = läuft)
  pauseGesamt: 0,   // ms aller bisherigen Pausen - fehlen im Ton und in der Zeit
  typ: "",          // Ton-Format des Rekorders (jeder Teil gleich)
  teil: 1,          // Nummer der Tondatei, in die gerade aufgenommen wird
  teilBytes: 0,     // so viel hat der laufende Teil schon geliefert
};
// Ein Abend, mehrere Tondateien (Kalle 28.11.2026): eine Datei für den ganzen
// Abend wurde zu groß zum Hochladen. Neuer Teil nach jeder Pause und ab
// 24 MB (≈ 70 min bei 48 kbit/s). Mitschrift und Prompt bleiben eins.
let AUFN_TEIL_MAX = 24 * 1024 * 1024;   // let: der Browser-Test setzt es klein
// Pause länger als 15 min: oben leise erinnern, sonst spielt man nach der
// Pizza weiter und merkt am Ende, dass nichts aufgenommen ist (Kalle 07.11.2026).
const AUFN_PAUSE_ERINNERN_MS = 15 * 60000;

// Aufgenommene Zeit ohne Pausen - so lang ist auch die Tondatei.
function aufnLaenge() {
  const jetzt = Aufn.pauseSeit || Date.now();
  return jetzt - Aufn.start - Aufn.pauseGesamt;
}
// Erst nach 90 s Stille melden, und dann nur leise: Pausen am Tisch (Pizza,
// Regeln nachlesen) sind normal - die Anzeige soll informieren, nicht nerven
// (Kalle, 30.10.2026: „eher im Hintergrund").
const AUFN_STILLE_MS = 90000;

function aufnZeit(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const zwei = (n) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${zwei(Math.floor(s % 3600 / 60))}:${zwei(s % 60)}`;
}

async function aufnStatusLaden() {
  Aufn.laedt = true;
  try { Aufn.status = await (await fetch("/api/aufnahme")).json(); } catch { /* bleibt alt */ }
  // War das Mikro schon einmal erlaubt, kennt der Browser die Namen jetzt
  // schon - dann lässt sich das Tischmikro VOR dem Start auswählen.
  if (!Aufn.geraete.length) await aufnGeraeteLaden();
  Aufn.laedt = false;
  render();
}

// Mikros erst nach der ersten Freigabe mit Namen - vorher heißen alle „".
async function aufnGeraeteLaden() {
  try {
    const alle = await navigator.mediaDevices.enumerateDevices();
    Aufn.geraete = alle.filter((d) => d.kind === "audioinput" && d.label);
  } catch { Aufn.geraete = []; }
}

function aufnGroesse(bytes) {
  return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}
function aufnDauer(ms) {
  const min = Math.round((ms || 0) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;
}

function aufnMikroWahl() {
  try { return localStorage.getItem("aufnahmeMikro") || ""; } catch { return ""; }
}

// Kleine Anzeige in der Kopfleiste: auch bei zugeklapptem Panel sieht man,
// dass aufgenommen wird, und kann einen Moment merken.
function aufnahmeKopfHtml() {
  if (!Aufn.rec) return "";
  if (Aufn.pauseSeit) {
    // Pause: oben gleich „▶ Weiter" - von überall ein Tipp (Variante B).
    return `<span class="pill aufn-kopf pausiert" title="Aufnahme angehalten – „▶ Weiter“ nimmt in derselben Aufnahme weiter auf">
        <span class="aufn-punkt"></span><span class="aufn-pause-text">${aufnPauseText()}</span></span>
      <button class="primary" data-act="aufn-weiter" title="Weiter aufnehmen (gleiche Aufnahme, gleiche Mitschrift)">▶ Weiter</button>`;
  }
  // ⏸ oben nur als Symbol: die Kopfleiste ist voll, sonst schiebt sie sich
  // unter die „Verbunden"-Pille in der Mitte.
  return `<span class="pill aufn-kopf" title="Spielabend wird aufgenommen"><span class="aufn-punkt"></span>
      <span class="aufn-zeit">${aufnZeit(aufnLaenge())}</span>
      <span class="aufn-pegel klein"><i></i></span><span class="aufn-stille muted" style="display:none">kein Ton?</span></span>
    <button class="ghost" data-act="aufn-pause" title="Pause: Aufnahme anhalten – „▶ Weiter“ nimmt danach in derselben Aufnahme auf">⏸</button>
    <button class="ghost" data-act="aufn-marke" title="Diesen Moment fürs Protokoll merken (wird dort besonders erwähnt)">📌 Merken</button>`;
}

function renderAufnahmePanel() {
  if (!Aufn.status && !Aufn.laedt) aufnStatusLaden();
  const st = Aufn.status || { liste: [], aktiv: null };
  const sp = st.sprache || {};
  const kannAufnehmen = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  let oben;
  if (Aufn.rec && Aufn.pauseSeit) {
    oben = `<div class="aufn-laeuft"><span class="aufn-punkt pause"></span> Pause
        <b class="aufn-zeit">${aufnZeit(aufnLaenge())}</b> aufgenommen
        <span class="muted small aufn-pause-seit">· angehalten seit ${aufnDauer(Date.now() - Aufn.pauseSeit)}</span></div>
      <div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap">
        <button class="primary" data-act="aufn-weiter">▶ ${Aufn.teilBytes > 0 ? `Weiter mit Teil ${Aufn.teil + 1}` : "Weiter aufnehmen"}</button>
        <button class="ghost bad" data-act="aufn-stop">■ Aufnahme beenden</button>
        ${ABEND_ENDE_KNOPF}
      </div>`;
  } else if (Aufn.rec) {
    oben = `<div class="aufn-laeuft"><span class="aufn-punkt"></span> Aufnahme läuft
        <b class="aufn-zeit">${aufnZeit(aufnLaenge())}</b>
        <span class="aufn-pegel" title="Pegel: zappelt der Balken beim Reden, kommt Ton an"><i></i></span>
        <span class="muted small aufn-groesse">${aufnGroesseText()}</span></div>
      <div class="aufn-live" title="Live-Mitschrift – grob, fürs Protokoll gibt es danach „Genau transkribieren“">${aufnLiveHtml()}</div>
      ${sp.live && sp.live.hinweis ? `<div class="muted small">${esc(sp.live.hinweis)}</div>` : ""}
      <div class="muted small aufn-stille" style="display:none; margin-top:4px">Seit über einer Minute kein Ton – falls das nicht stimmt: Mikro prüfen.</div>
      ${aufnStimmenHtml(st)}
      ${aufnMomenteHtml(st)}
      <div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap">
        <button class="ghost" data-act="aufn-marke">📌 Moment merken</button>
        <button class="ghost" data-act="aufn-pause" title="Aufnahme anhalten – danach geht es in derselben Aufnahme weiter">⏸ Pause</button>
        <button class="ghost bad" data-act="aufn-stop">■ Aufnahme beenden</button>
        ${ABEND_ENDE_KNOPF}
      </div>
      <div class="muted small hilfe" style="margin-top:6px">Tab offen lassen, Laptop nicht zuklappen.${sp.richtung && sp.richtung.laeuft
        ? ` <span title="Das Tischmikro liefert seine vier Kapseln einzeln (Immersive): die Mitschrift ordnet Sprecher zusätzlich nach Sitzplatz zu.">Sitzplatz-Erkennung an (4 Kapseln).</span>` : ""}</div>`;
  } else {
    const wahl = aufnMikroWahl();
    const auswahl = Aufn.geraete.length > 1
      ? `<select data-act="aufn-mikro" title="Welches Mikro?" style="width:auto; max-width:260px">
          <option value="">Standard-Mikro</option>
          ${Aufn.geraete.map((d) => `<option value="${esc(d.deviceId)}"${d.deviceId === wahl ? " selected" : ""}>${esc(d.label)}</option>`).join("")}
        </select>` : "";
    const unterbrochen = st.aktiv
      ? `<div class="pill warn" style="display:block; margin-bottom:8px">⚠ Eine Aufnahme wurde unterbrochen (Seite neu geladen?). Der Ton bis dahin ist gespeichert.</div>` : "";
    oben = kannAufnehmen
      ? `${unterbrochen}<div class="row" style="gap:6px; flex-wrap:wrap; align-items:center">
          ${st.aktiv ? "" : `<button class="primary" data-act="aufn-abend" title="Bennies auffüllen, Aufnahme starten, letztes Protokoll an die Handys – alles auf einmal">🌅 Abend starten</button>`}
          <button class="${st.aktiv ? "primary" : "ghost"}" data-act="aufn-start">● ${st.aktiv ? "Weiter aufnehmen" : "Nur aufnehmen"}</button>${auswahl}
        </div>`
      : `<div class="pill bad">Dieser Browser kann nicht aufnehmen – Chrome oder Edge nehmen.</div>`;
  }
  const liste = (st.liste || []).filter((x) => !(x.laeuft && Aufn.rec));
  const zeilen = liste.map((x) => aufnZeileHtml(x, sp)).join("");
  return section("aufnahme", "🎙 Aufnahme", `
    ${oben}
    ${aufnMitschriftHtml(sp)}
    ${aufnSitzHtml(sp)}
    ${zeilen ? `<div class="aufn-liste">${zeilen}</div>` : ""}
    ${aufnPlatzHtml(st)}
    <div class="muted small hilfe" style="margin-top:6px; line-height:1.5">
      Nach „■ Aufnahme beenden“ schreibt die App von selbst genau mit (zwei
      Erkenner, dauert etwa so lang wie die Aufnahme – Laptop an lassen, über
      Nacht geht) → „📝 Prompt“ → in Claude einfügen.
    </div>`);
}

// Speicherplatz (Kalle 10.11.2026: Ton NICHT löschen, „aber anzeigen wie viel
// Speicher es braucht"). Nur eine ruhige Zeile; laut wird sie erst, wenn die
// Platte fast voll ist - dann bräche die Aufnahme mitten im Abend ab.
const AUFN_PLATZ_KNAPP = 2 * 1024 * 1024 * 1024;
function aufnPlatzGross(bytes) {
  return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(bytes < 10737418240 ? 1 : 0).replace(".", ",")} GB` : aufnGroesse(bytes);
}
function aufnPlatzHtml(st) {
  // Nur /api/aufnahme liefert die Zahlen (Ordner durchzählen kostet) - die
  // Antworten auf Stop/Stimme nicht. Darum den letzten Stand behalten.
  if (st.platz) Aufn.platz = st.platz;
  const p = Aufn.platz;
  if (!p || (!p.aufnahmen && !p.modelle)) return "";
  const teile = [`Aufnahmen <b>${aufnPlatzGross(p.aufnahmen)}</b>`];
  if (p.modelle) teile.push(`Sprachmodelle ${aufnPlatzGross(p.modelle)}`);
  if (p.frei != null) teile.push(`frei auf der Platte <b>${aufnPlatzGross(p.frei)}</b>`);
  const knapp = p.frei != null && p.frei < AUFN_PLATZ_KNAPP;
  return `<div class="aufn-platz small ${knapp ? "knapp" : "muted"}">💾 ${teile.join(" · ")}${knapp
    ? `<br>⚠ Die Platte ist fast voll – eine Aufnahme könnte mitten im Abend abbrechen. Vorher Platz schaffen.` : ""}</div>`;
}

// „Teil 2 · 4 MB" - ab dem zweiten Teil zählt die Größe des laufenden Teils
// (die ist es, die nicht zu groß werden soll).
function aufnGroesseText() {
  return Aufn.teil > 1 ? `Teil ${Aufn.teil} · ${aufnGroesse(Aufn.teilBytes)}` : `${aufnGroesse(Aufn.bytes)} gespeichert`;
}

function aufnZeileHtml(x, sp) {
  const datum = x.start ? new Date(x.start).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : x.name;
  const teile = x.teile || [];
  const infos = [aufnDauer(x.dauerMs), teile.length ? `${teile.length} Teile` : "", aufnGroesse(x.bytes),
    x.kaempfe ? `${x.kaempfe} Kampf${x.kaempfe === 1 ? "" : "e"}` : "", x.marken ? `${x.marken} 📌` : ""].filter(Boolean);
  const job = sp.job && sp.job.name === x.name ? sp.job : null;
  const knoepfe = [];
  if (teile.length) {
    teile.forEach((t) => knoepfe.push(`<a href="/api/aufnahme/datei/${encodeURIComponent(x.name)}?teil=${t.nr}"><button class="ghost small" title="${esc(aufnGroesse(t.bytes))}">⬇ Teil ${t.nr} <span class="muted">${esc(aufnDauer(t.dauerMs))}</span></button></a>`));
  } else if (x.datei) knoepfe.push(`<a href="/api/aufnahme/datei/${encodeURIComponent(x.name)}"><button class="ghost small" title="Tondatei herunterladen">⬇ Ton</button></a>`);
  if (job && !job.fehler) {
    knoepfe.push(`<span class="aufn-job small"><span class="aufn-balken"><i style="transform:scaleX(${job.anteil})"></i></span>
      <span class="aufn-fortschritt muted">${esc(aufnJobText(job))}</span></span>
      <button class="ghost small" data-act="aufn-abbrechen" title="Transkription abbrechen">✕</button>`);
  } else {
    // Wer ist wer: aus S00/S01 werden Namen, der Prompt nennt dann die.
    const wer = x.hatTranskript ? "genau" : x.hatLive ? "live" : "";
    if (wer) knoepfe.push(`<button class="ghost small" data-act="aufn-sprecher" data-quelle="${wer}" data-name="${esc(x.name)}" title="Sprecher S00, S01 … den Leuten am Tisch zuordnen – der Prompt nennt dann Namen">👥 Wer ist wer?</button>`);
    if (x.hatTranskript) {
      knoepfe.push(`<button class="ghost small" data-act="aufn-prompt" data-quelle="genau" data-name="${esc(x.name)}" title="Prompt aus dem genauen Transkript – in Claude einfügen">📝 Prompt</button>`);
    } else {
      // Wartet: läuft nach dem Ende der Aufnahme bzw. nach dem laufenden
      // Durchgang von selbst (server/sprache.py nach_aufnahme).
      if ((sp.warten || []).includes(x.name)) knoepfe.push(`<span class="small muted" title="Startet von selbst, wenn keine Aufnahme läuft und der Laptop frei ist">⏳ Transkript folgt</span>`);
      else if (sp.bereit && x.datei && !x.laeuft) knoepfe.push(`<button class="ghost small" data-act="aufn-genau" data-name="${esc(x.name)}" title="Ganze Aufnahme genau transkribieren, mit Sprechern. Läuft im Hintergrund, Laptop an lassen.">🎧 Genau transkribieren</button>`);
      if (x.hatLive) knoepfe.push(`<button class="ghost small" data-act="aufn-prompt" data-quelle="live" data-name="${esc(x.name)}" title="Sofort-Prompt aus der Live-Mitschrift (gröber als genau)">📝 Prompt (live)</button>`);
    }
    if (job && job.fehler) knoepfe.push(`<span class="small muted">${esc(job.fehler)}</span>`);
    if (!sp.verfuegbar) {
      // Ohne eingebaute Spracherkennung (Entwickler-Umgebung): fremdes
      // Transkript (noScribe o. ä.) einlesen geht weiterhin.
      knoepfe.push(`<label class="ghost knopf-label small" title="Transkript (.txt/.html) wählen – daraus wird der Prompt">📄 Transkript → Prompt
        <input type="file" accept=".html,.htm,.txt,.vtt,.srt,text/plain,text/html" data-act="aufn-transkript" data-name="${esc(x.name)}" style="display:none"></label>`);
    }
  }
  knoepfe.push(`<button class="ghost small bad" data-act="aufn-loeschen" data-name="${esc(x.name)}" title="Aufnahme, Transkript und Prompt löschen">🗑</button>`);
  return `<div class="aufn-zeile">
    <div><b>${esc(datum)}</b> <span class="muted small">${esc(infos.join(" · "))}</span></div>
    <div class="row tight" style="flex-wrap:wrap; align-items:center">${knoepfe.join("")}</div></div>`;
}

// Mitschrift einrichten / Live an-aus. Bewusst eine Zeile: Kalle will das
// Panel ruhig („nicht so viel Text").
function aufnMitschriftHtml(sp) {
  if (!sp.verfuegbar) return "";
  if (sp.laden && !sp.laden.fehler) {
    const anteil = Math.min(1, sp.laden.b / Math.max(1, sp.laden.gesamt));
    return `<div class="aufn-mitschrift small"><span class="aufn-balken"><i style="transform:scaleX(${anteil.toFixed(3)})"></i></span>
      <span class="aufn-fortschritt muted">Mitschrift wird eingerichtet … ${Math.round(anteil * 100)} %</span></div>`;
  }
  if (!sp.bereit) {
    return `<div class="aufn-mitschrift small">
      <button class="ghost small" data-act="aufn-modelle" title="Lädt einmalig die Sprachmodelle (gratis, danach offline). Bleiben beim Aktualisieren erhalten.">⬇ Mitschrift einrichten</button>
      <span class="muted">${sp.laden && sp.laden.fehler ? esc(sp.laden.fehler) : `einmalig ca. ${sp.groesseMb} MB`}</span></div>`;
  }
  // „automatisch" nimmt die Zahl aus der App (Spieler + SL), sobald Figuren
  // im Kampf-Panel stehen - dann steht sie gleich mit dran.
  const auto = sp.personenApp ? `Leute: ${sp.personenApp} (laut App)` : "Leute: automatisch";
  const personen = [0, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    `<option value="${n}"${n === sp.personen ? " selected" : ""}>${n ? `${n} am Tisch` : auto}</option>`).join("");
  const begriffe = (sp.begriffe || []).length;
  return `<div class="aufn-mitschrift small">
    <label title="Grober Text schon während der Aufnahme. Nicht nötig: das genaue Transkript danach ist besser und kommt von selbst."><input type="checkbox" data-act="aufn-live-an"${sp.liveAn ? " checked" : ""}> Live mitschreiben</label>
    <select data-act="aufn-personen" title="Leute am Tisch, SL mitgezählt. Automatisch: Spieler aus der App + SL, bis zu 2 Gäste mehr werden auch erkannt. Zahl wählen = höchstens so viele Sprecher." style="width:auto">${personen}</select>
    ${sp.genauerFehlt && !(sp.laden && !sp.laden.fehler) ? `<button class="ghost small" data-act="aufn-modelle" title="Modelle für das beste Ergebnis nach der Aufnahme: zweiter Erkenner (Canary, fest auf Deutsch) und das genauere Stimm-Modell (Sprecher besser auseinanderhalten). Einmalig, danach offline.">⬇ Genauer (${sp.groesseMb} MB)</button>` : ""}
    <button class="ghost small" data-act="aufn-begriffe" title="Orte, Schiffe, NSCs … – damit die Mitschrift sie richtig schreibt. Figuren, Gegner und Spieler aus der App sind automatisch dabei.">🏷 Namen${begriffe ? ` (${begriffe})` : ""}</button>
  </div>`;
}
// Sitzplatz-Erkennung einrichten (server/connex.py). Kalle (16.11.2026): „Der
// Treiber fürs SSL soll ins Game mit rein für den SL." Mitliefern verbietet
// SSLs Lizenz, darum lädt die App ihn auf Knopfdruck von SSL. Die Zeile gibt
// es nur, wenn ein Connex am Rechner hängt - alle anderen SLs sehen nichts.
function aufnSitzLaedt(e) {
  return !!(e && e.laden && !e.laden.fehler && e.laden.schritt !== "gestartet");
}
function aufnSitzHtml(sp) {
  const e = sp.richtung && sp.richtung.einrichtung;
  if (!e || !(e.connex || e.laden)) return "";
  const punkt = (ok, text) => `<span class="aufn-sitz-punkt${ok ? " ok" : ""}"><i></i>${text}</span>`;
  const l = e.laden;
  // Was zählt, sind die vier Kapseln - nicht der Treiber. Am Jonsbo (16.11.2026)
  // gibt Windows' eigener USB-Treiber sie einzeln her, ganz ohne SSL-Treiber;
  // die Zeile behauptete trotzdem „SSL-Treiber installiert". Darum: Kapseln da
  // → bereit, kein Wort vom Treiber. Kapseln fehlen → zuerst Immersive (das
  // Wahrscheinlichere), der Treiber nur als zweiter Weg daneben.
  const immersive = `<span class="muted">Am Mikro: Logo 5 s halten, bis es gelb leuchtet.</span>
      <button class="ghost small" data-act="aufn-sitz-pruefen">Erneut prüfen</button>`;
  let rest;
  if (e.kapseln) rest = `<span class="muted">bereit – zählt ab der nächsten Aufnahme mit</span>`;
  else if (aufnSitzLaedt(e)) {
    rest = `<span class="aufn-balken"><i style="transform:scaleX(${(l.anteil || 0).toFixed(3)})"></i></span>
      <span class="aufn-sitz-fortschritt muted">${aufnSitzText(l)}</span>`;
  } else if (e.treiber) {
    rest = immersive;
  } else if (l && l.schritt === "gestartet") {
    rest = `<span class="muted">Installation läuft in eigenem Fenster – dort bestätigen.</span>
      <button class="ghost small" data-act="aufn-sitz-pruefen">Erneut prüfen</button>`;
  } else if (l && l.fehler) {
    rest = `<button class="primary small" data-act="aufn-sitz-anleitung">Anleitung</button>
      <span class="muted">Automatisch ging es nicht.</span>`;
  } else {
    rest = `${immersive}
      <button class="ghost small" data-act="aufn-sitz-treiber" title="Nur nötig, wenn die Kapseln trotz Immersive fehlen. Lädt den Treiber direkt von Solid State Logic und startet die Installation.">⬇ SSL-Treiber</button>`;
  }
  return `<div class="aufn-mitschrift aufn-sitz small"><b>Sitzplatz-Erkennung</b>
    ${punkt(e.connex, "Connex erkannt")}
    ${punkt(e.kapseln, e.kapseln ? "4 Kapseln erkannt" : "4 Kapseln fehlen")}
    ${rest}</div>`;
}
function aufnSitzText(l) {
  return l.schritt === "pruefen" ? "Treiber wird geprüft …" : `Treiber wird von SSL geladen … ${Math.round((l.anteil || 0) * 100)} %`;
}
async function aufnSitzTreiber() {
  const e = Aufn.status && Aufn.status.sprache && Aufn.status.sprache.richtung && Aufn.status.sprache.richtung.einrichtung;
  if (!e) return;
  // Bei SSL steht vor dem Download dieselbe Zustimmung - die App darf sie
  // dem SL nicht abnehmen.
  const ja = await dialog({ art: "frage",
    text: "⬇ SSL-Treiber installieren\nDie App lädt den Treiber direkt von Solid State Logic und startet die Installation. Windows fragt danach einmal um Erlaubnis.",
    inhalt: `<p class="small" style="margin:0">Der Treiber gehört SSL. Mit „Zustimmen" nimmst du die
      <a href="${esc(e.lizenz)}" target="_blank" rel="noopener" style="color:inherit">Lizenzbedingungen von SSL ↗</a> an.</p>`,
    knoepfe: [{ text: "Abbrechen", wert: false, abbruch: true }, { text: "Zustimmen & installieren", wert: true, art: "primary", standard: true }] });
  if (ja) aufnSprache("/api/sprache/sitzplatz", { aktion: "treiber" });
}
// Rückfall, wenn der Ein-Klick-Weg nicht geht: dieselben drei Schritte von
// Hand, mit Knopf zur SSL-Seite.
async function aufnSitzAnleitung() {
  const e = Aufn.status && Aufn.status.sprache && Aufn.status.sprache.richtung && Aufn.status.sprache.richtung.einrichtung;
  if (!e) return;
  const nr = (ok, n) => ok ? `<b class="aufn-sitz-ok">✓</b>` : `<b>${n}</b>`;
  const nochmal = await dialog({ art: "hinweis",
    text: "Sitzplatz-Erkennung einrichten\nMit den vier Kapseln des SSL Connex erkennt die Mitschrift, wer wo sitzt. Einmal einrichten:",
    inhalt: `<div class="aufn-sitz-schritte">
        ${nr(e.connex, 1)}<div><b>Connex anschließen</b></div>
        ${nr(e.kapseln, 2)}<div><b>Immersive einschalten</b><br><span class="muted small">Am Mikro: Logo 5 s halten, bis es gelb leuchtet.</span></div>
        ${e.kapseln || e.treiber ? "" : `<b>3</b><div><b>Fehlen die Kapseln dann noch: SSL-Treiber</b><br><span class="muted small">Öffnet die Download-Seite von SSL. „SSL Windows ASIO/WDM Driver" laden, doppelklicken, durchklicken.</span>
          <br><a class="knopf primary small" href="${esc(e.seite)}" target="_blank" rel="noopener">Treiber bei SSL holen ↗</a></div>`}
      </div>`,
    knoepfe: [{ text: "Schließen", wert: false, abbruch: true }, { text: "Erneut prüfen", wert: true, art: "primary", standard: true }] });
  if (nochmal) aufnSprache("/api/sprache/sitzplatz", { aktion: "pruefen" });
}
function aufnJobText(job) {
  const pro = Math.round((job.anteil || 0) * 100);
  let rest = "";
  if (job.anteil > 0.03) {
    const lief = Date.now() - job.start;
    rest = ` · noch ca. ${aufnDauer(lief / job.anteil * (1 - job.anteil))}`;
  }
  return `${job.schritt === "Text erkennen" ? "Transkribiere" : job.schritt} … ${pro} %${rest}`;
}

// --- Aufnehmen -----------------------------------------------------------------

// „🌅 Abend starten" (Kalle 02.11.2026): was zu Beginn jedes Abends ansteht, in
// EINEM Tipp - Bennies auf Startwert, Aufnahme an, das letzte Protokoll an die
// Handys (dort geht es als „Was bisher geschah" von selbst auf).
async function abendStarten() {
  const s = App.state || {};
  if (s.hasSavedSession) {
    hinweis("Erst oben entscheiden: gespeicherten Kampf fortsetzen oder neu beginnen.");
    return;
  }
  const letztes = (s.protokolle || [])[0];
  const freigeben = letztes && !letztes.freigegeben;
  const punkte = ["🪙 Bennies aller Wildcards auf Startwert", "🎙 Aufnahme starten"];
  if (freigeben) punkte.push(`📜 Protokoll „${letztes.name}“ an die Handys`);
  else if (letztes) punkte.push(`📜 „${letztes.name}“ ist schon frei – die Handys zeigen es zum Start`);
  if (!await frage(`🌅 Abend starten:\n\n${punkte.map((p) => `• ${p}`).join("\n")}`, "Los geht's")) return;
  gmAction({ type: "benny_refresh" });
  if (freigeben) gmAction({ type: "protokoll_freigeben", id: letztes.id, an: true });
  await aufnahmeStarten();
  toast("🌅 Viel Spaß heute Abend!");
}

// „🌙 Abend beenden" (Kalle 10.11.2026): das Gegenstück zu „Abend starten".
// Vorher waren es am Ende des Abends drei Handgriffe an drei Stellen - und der
// vergessene war meist die Aufnahme, die dann bis zum Zuklappen weiterlief.
// Die genaue Mitschrift braucht keinen Haken: sie startet nach dem Ende der
// Aufnahme von selbst (server/sprache.py nach_aufnahme).
const ABEND_ENDE_KNOPF = `<button class="primary" data-act="aufn-abend-ende" title="Aufnahme beenden, Kampf beenden, Sicherung anlegen – alles auf einmal">🌙 Abend beenden</button>`;
async function abendBeenden() {
  const s = App.state || {};
  const sp = (Aufn.status || {}).sprache || {};
  const kampf = !!s.round || (s.combatants || []).some((c) => c.kind === "npc");
  const haken = (name, text, klein) => `<label class="abend-zeile"><input type="checkbox" data-abend="${name}" checked style="width:auto">
      <span>${text}${klein ? ` <span class="muted small">${klein}</span>` : ""}</span></label>`;
  const wahl = await dialog({ text: "🌙 Abend beenden?",
    inhalt: `<div class="abend-liste">
      ${Aufn.rec ? haken("aufnahme", "■ Aufnahme beenden", `(${aufnDauer(aufnLaenge())}${sp.bereit ? " – die genaue Mitschrift schreibt die App danach von selbst, Laptop an lassen" : ""})`) : ""}
      ${kampf ? haken("kampf", "🏁 Kampf beenden", "(Gegner weg, Spieler bleiben verbunden, Wunden bleiben)") : ""}
      ${haken("sicherung", "🛟 Sicherung anlegen", "")}</div>`,
    lesen: (box) => Object.fromEntries([...box.querySelectorAll("[data-abend]")].map((i) => [i.dataset.abend, i.checked])),
    knoepfe: [{ text: "Abbrechen", wert: null, abbruch: true },
      { text: "🌙 Abend beenden", art: "primary", standard: true }] });
  if (!wahl) return;
  if (wahl.aufnahme) await aufnahmeBeenden(true);
  if (wahl.kampf) gmAction({ type: "end_combat" });
  let gesichert = false;
  if (wahl.sicherung) {
    // Kurz warten: das Abräumen soll schon in der Sicherung stehen.
    if (wahl.kampf) await new Promise((r) => setTimeout(r, 400));
    try { gesichert = !!(await (await fetch("/api/sicherungen/jetzt", { method: "POST" })).json()).ok; } catch { /* unten */ }
    if (!gesichert) { hinweis("Die Sicherung ging nicht – bitte über ☰ Mehr → „💾 Sicherung exportieren“ von Hand sichern."); return; }
  }
  toast(wahl.aufnahme && sp.bereit ? "🌙 Abend beendet – Mitschrift läuft, Laptop an lassen" : "🌙 Abend beendet. Gute Nacht!");
}

async function aufnahmeStarten() {
  if (Aufn.rec) return;
  const id = aufnMikroWahl();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: id ? { exact: id } : undefined,
      // Ein Tischmikro für alle: Rauschunterdrückung schluckt sonst die leisen
      // Spieler am Tischende. Pegel-Ausgleich hilft dagegen.
      echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1,
    } });
  } catch (e) {
    if (id && e && e.name === "OverconstrainedError") {   // gemerktes Mikro nicht mehr da
      try { localStorage.removeItem("aufnahmeMikro"); } catch { /* egal */ }
      return aufnahmeStarten();
    }
    hinweis("Kein Zugriff aufs Mikro.\n\nOben links in der Adresszeile auf das Schloss/Mikro-Symbol klicken und das Mikrofon erlauben, dann nochmal.");
    return;
  }
  const typ = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"]
    .find((m) => MediaRecorder.isTypeSupported(m)) || "";
  let probe;
  try {
    probe = new MediaRecorder(stream, typ ? { mimeType: typ, audioBitsPerSecond: 48000 } : {});
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    hinweis("Aufnahme ließ sich nicht starten.");
    return;
  }
  // Unterbrochen (Seite neu geladen): derselbe Abend geht im nächsten Teil
  // weiter - sonst wären es zwei Abende mit zwei Mitschriften.
  const weiter = !!(Aufn.status && Aufn.status.aktiv);
  let antwort;
  try {
    const r = await fetch("/api/aufnahme/start", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mime: probe.mimeType || typ, weiter }) });
    antwort = await r.json();
  } catch { /* unten */ }
  if (!antwort || !antwort.name) {
    stream.getTracks().forEach((t) => t.stop());
    hinweis("Server antwortet nicht – Aufnahme nicht gestartet.");
    return;
  }
  const name = antwort.name;
  Object.assign(Aufn, { stream, name, start: Date.now() - (antwort.tonMs || 0), bytes: 0, kette: Promise.resolve(),
    pauseSeit: 0, pauseGesamt: 0, typ: probe.mimeType || typ, teil: antwort.teil || 1, teilBytes: 0 });
  const rec = aufnRekorder(Aufn.teil);
  Aufn.rec = rec;
  // Mikro abgezogen / Treiber weg: nicht still weiter „aufnehmen".
  stream.getAudioTracks().forEach((t) => { t.onended = () => {
    if (Aufn.stream === stream && Aufn.rec) { aufnahmeBeenden(); hinweis("Das Mikro ist weg – Aufnahme beendet. Der Ton bis hierher ist gespeichert."); }
  }; });
  rec.start(AUFN_STUECK_MS);
  aufnPegelStarten(stream);
  aufnWachHalten();
  aufnGeraeteLaden();
  toast("● Aufnahme läuft");
  aufnStatusLaden();
  // Die Sitzplatz-Erkennung (server/richtung.py) öffnet das Mikro im
  // Hintergrund - ihr Stand steht erst kurz danach fest.
  setTimeout(() => { if (Aufn.rec && Aufn.name === name) aufnStatusLaden(); }, 4000);
}

// Ein Rekorder je Teil: jeder Teil ist eine eigene, für sich abspielbare
// Datei (ein Rekorder schreibt den Datei-Kopf nur an den Anfang).
function aufnRekorder(teil) {
  // 48 kbit/s Opus: eine Stunde ≈ 21 MB, für Sprache mehr als genug.
  const rec = new MediaRecorder(Aufn.stream, Aufn.typ ? { mimeType: Aufn.typ, audioBitsPerSecond: 48000 } : {});
  const name = Aufn.name;
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    if (Aufn.name === name && Aufn.teil === teil) Aufn.teilBytes += e.data.size;
    aufnStueckSenden(name, e.data, teil);
    if (Aufn.rec === rec && rec.state === "recording" && Aufn.teilBytes >= AUFN_TEIL_MAX) aufnNeuerTeil();
  };
  return rec;
}
// Datei voll: den nächsten Rekorder ZUERST starten, dann den alten stoppen -
// so fehlt beim Wechsel kein Wort (doppelt sind höchstens Millisekunden).
function aufnNeuerTeil() {
  const alt = Aufn.rec;
  Aufn.teil += 1;
  Aufn.teilBytes = 0;
  const neu = aufnRekorder(Aufn.teil);
  Aufn.rec = neu;
  neu.start(AUFN_STUECK_MS);
  try { alt.stop(); } catch { /* egal */ }
}

function aufnStueckSenden(name, blob, teil = 1) {
  Aufn.kette = Aufn.kette.then(async () => {
    for (let versuch = 0; versuch < 3; versuch++) {
      try {
        const r = await fetch(`/api/aufnahme/stueck?name=${encodeURIComponent(name)}&teil=${teil}`, { method: "POST", body: blob });
        if (r.status === 409) {
          // Server kennt die Aufnahme nicht mehr (neu gestartet): ohne Kopf-
          // Stück wäre der Rest unbrauchbar -> sauber neu anfangen. Erst NACH
          // diesem Glied der Kette, sonst wartet das Beenden auf sich selbst.
          if (Aufn.name === name && !Aufn.neustart) {
            Aufn.neustart = true;
            setTimeout(async () => { await aufnahmeBeenden(true); Aufn.neustart = false; aufnahmeStarten(); }, 0);
          }
          return;
        }
        if (r.ok) { if (Aufn.name === name) Aufn.bytes += blob.size; return; }
      } catch { /* kurz warten, nochmal */ }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  });
}

async function aufnahmeBeenden(still = false) {
  const { rec, stream } = Aufn;
  if (!rec) return;
  Aufn.rec = null;
  Aufn.pauseSeit = 0;
  await new Promise((fertig) => {
    if (rec.state === "inactive") return fertig();     // in der Pause schon gestoppt
    rec.onstop = fertig;
    try { rec.stop(); } catch { fertig(); }
  });
  stream.getTracks().forEach((t) => t.stop());
  if (Aufn.audioCtx) { try { Aufn.audioCtx.close(); } catch { /* egal */ } }
  Aufn.audioCtx = null; Aufn.analyser = null;
  await Aufn.kette;                         // letzte Stücke noch abliefern
  Aufn.name = null;
  if (Aufn.wakeLock) { try { Aufn.wakeLock.release(); } catch { /* egal */ } Aufn.wakeLock = null; }
  try { Aufn.status = await (await fetch("/api/aufnahme/stop", { method: "POST" })).json(); } catch { /* egal */ }
  if (!still) toast("■ Aufnahme beendet und gespeichert");
  render();
}

// ⏸ Pause / ▶ Weiter: die Pause schließt den Teil ab (seit 2.0.28 eine Datei
// je Teil, Kalle 28.11.2026), „▶ Weiter" beginnt den nächsten. Es bleibt EINE
// Aufnahme mit EINER Mitschrift, „genau" läuft erst nach ■ Beenden. Der Server
// merkt sich die Pausen, damit Marken und Kampfzeiten danach zum Ton passen.
async function aufnPause() {
  const rec = Aufn.rec;
  if (!rec || Aufn.pauseSeit || rec.state !== "recording") return;
  Aufn.pauseSeit = Date.now();
  // Stoppen liefert den Rest des Teils gleich ab (die Live-Mitschrift wartet darauf).
  await new Promise((fertig) => {
    rec.onstop = fertig;
    try { rec.stop(); } catch { fertig(); }
  });
  try { await fetch("/api/aufnahme/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ an: true }) }); } catch { /* egal */ }
  toast("⏸ Aufnahme angehalten");
  render();
}
async function aufnWeiter() {
  if (!Aufn.rec || !Aufn.pauseSeit) return;
  // Nächster Teil - außer der letzte bekam gar keinen Ton (sofort ⏸ gedrückt):
  // dann bliebe dort eine Lücke in der Nummerierung.
  if (Aufn.teilBytes > 0) { Aufn.teil += 1; Aufn.teilBytes = 0; }
  const rec = aufnRekorder(Aufn.teil);
  Aufn.rec = rec;
  try { rec.start(AUFN_STUECK_MS); } catch { /* egal */ }
  Aufn.pauseGesamt += Date.now() - Aufn.pauseSeit;
  Aufn.pauseSeit = 0;
  Aufn.stilleSeit = Date.now();          // Pause ist keine Stille
  try { await fetch("/api/aufnahme/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ an: false }) }); } catch { /* egal */ }
  toast("● Aufnahme läuft weiter");
  render();
}
function aufnPauseText() {
  const lang = Date.now() - Aufn.pauseSeit >= AUFN_PAUSE_ERINNERN_MS;
  // Kurz halten: „▶ Weiter" steht gleich daneben, und die Kopfleiste ist voll.
  return lang ? `Pause seit ${aufnDauer(Date.now() - Aufn.pauseSeit)}`
    : `Pause <b>${aufnZeit(aufnLaenge())}</b>`;
}

// Pegel messen: Beim ersten Test lief die Aufnahme sonst gern über das
// eingebaute Laptop-Mikro oder ein stummes Headset, und das fiel erst nach
// dem Abend auf.
function aufnPegelStarten(stream) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    Object.assign(Aufn, { audioCtx: ctx, analyser: an, pegel: 0, stilleSeit: Date.now() });
  } catch { Aufn.analyser = null; }
}
function aufnPegelMessen() {
  const an = Aufn.analyser;
  if (!an) return;
  const daten = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(daten);
  let summe = 0;
  for (const v of daten) summe += v * v;
  const rms = Math.sqrt(summe / daten.length);
  // Sprache am Tisch liegt grob bei 0,01–0,2 RMS -> auf 0..1 strecken.
  const roh = Math.min(1, Math.sqrt(rms) * 2.2);
  Aufn.pegel = Math.max(roh, Aufn.pegel * 0.8);
  if (rms > 0.003) Aufn.stilleSeit = Date.now();
  const still = Date.now() - Aufn.stilleSeit > AUFN_STILLE_MS;
  document.querySelectorAll(".aufn-pegel > i").forEach((x) => { x.style.transform = `scaleX(${Aufn.pegel.toFixed(3)})`; });
  document.querySelectorAll(".aufn-stille").forEach((x) => { x.style.display = still ? "" : "none"; });
  document.querySelectorAll(".aufn-kopf").forEach((x) => x.classList.toggle("still", still));
}
setInterval(() => { if (Aufn.rec && !Aufn.pauseSeit) aufnPegelMessen(); }, 150);

// Bildschirm wach halten: Geht der Laptop schlafen, endet die Aufnahme.
async function aufnWachHalten() {
  if (!Aufn.rec || !navigator.wakeLock) return;
  try { Aufn.wakeLock = await navigator.wakeLock.request("screen"); } catch { /* geht nicht überall */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Aufn.rec && !Aufn.wakeLock) aufnWachHalten();
  if (Aufn.wakeLock && Aufn.wakeLock.released) { Aufn.wakeLock = null; aufnWachHalten(); }
});
// Tab schließen mitten in der Aufnahme: der Browser fragt nach (das ist kein
// sperrbarer confirm(), sondern die eingebaute Verlassen-Warnung).
window.addEventListener("beforeunload", (e) => {
  if (Aufn.rec) { e.preventDefault(); e.returnValue = ""; }
});
// Laufzeit-Anzeige jede Sekunde nachführen, ohne alles neu zu zeichnen.
setInterval(() => {
  if (!Aufn.rec) return;
  if (Aufn.pauseSeit) {
    const lang = Date.now() - Aufn.pauseSeit >= AUFN_PAUSE_ERINNERN_MS;
    document.querySelectorAll(".aufn-kopf.pausiert").forEach((x) => {
      x.classList.toggle("lang", lang);
      const txt = x.querySelector(".aufn-pause-text");
      if (txt) txt.innerHTML = aufnPauseText();
    });
    document.querySelectorAll(".aufn-pause-seit").forEach((x) => { x.textContent = `· angehalten seit ${aufnDauer(Date.now() - Aufn.pauseSeit)}`; });
    return;
  }
  const t = aufnZeit(aufnLaenge());
  document.querySelectorAll(".aufn-zeit").forEach((x) => { x.textContent = t; });
  document.querySelectorAll(".aufn-groesse").forEach((x) => { x.textContent = aufnGroesseText(); });
}, 1000);

// --- Stimm-Anmeldung ---------------------------------------------------------------
// Vorstellungsrunde: jeder sagt einmal ein, zwei Sätze, der SL tippt vorher
// den Namen. Die Stimme bleibt gespeichert (Stimmprofile) - beim nächsten
// Abend ist sie 👂 bekannt. Sind alle bekannt, arbeitet die Mitschrift mit
// FESTEN PLÄTZEN (Kalle 23.11.2026, Variante D): jeder Satz geht an eine der
// vorgestellten Stimmen, keine erfundenen „S03" mehr, nichts zu raten. Fehlt
// jemand, sortiert sie frei wie bisher - darum steht hier, wer noch fehlt.
function aufnStimmenHtml(st) {
  const figuren = ((App.state && App.state.combatants) || [])
    .filter((c) => c.kind === "player" && !c.benched).map((c) => c.name);
  const schon = new Set(((st.aktiv || {}).stimmen) || []);
  // Gäste (stehen nicht in der Initiative): heute per „+ Gast" vorgestellt.
  const gaeste = [...schon].filter((n) => n !== "Spielleiter" && !figuren.includes(n));
  const namen = ["Spielleiter", ...new Set(figuren), ...gaeste];
  const bekannt = new Set(st.stimmenBekannt || []);
  const fehlt = namen.filter((n) => !schon.has(n) && !bekannt.has(n));
  const knoepfe = namen.map((n) => {
    const c = ((App.state && App.state.combatants) || []).find((x) => x.name === n);
    const wer = c && c.playerName && c.playerName !== n ? ` <span class="muted small">(${esc(c.playerName)})</span>` : "";
    const zeichen = schon.has(n) ? "✓ " : bekannt.has(n) ? "👂 " : "🎙 ";
    const titel = !schon.has(n) && bekannt.has(n) ? ` title="Stimme von früher bekannt – nur nochmal vorstellen, wenn es letztes Mal nicht passte"` : "";
    return `<button type="button" class="${schon.has(n) ? "ghost on" : "ghost"} small${bekannt.has(n) && !schon.has(n) ? " bekannt" : ""}" data-act="aufn-stimme" data-figur="${esc(n)}"${titel}>${zeichen}${esc(n)}${wer}</button>`;
  }).join("");
  // Bei jeder neuen Aufnahme einmal aufgeklappt, wenn noch jemand fehlt,
  // danach merkt sich die Klappe den Zustand wie alle anderen (data-merk).
  if (App._stimmenAufnahme !== Aufn.start) {
    App._stimmenAufnahme = Aufn.start;
    if (fehlt.length) App.offeneUnter.add("aufn-stimmen");
  }
  const stand = fehlt.length
    ? `<span class="muted small">· noch ${fehlt.length}</span>`
    : `<span class="small aufn-fest">· ✓ feste Plätze</span>`;
  const erklaerung = fehlt.length
    ? `Noch vorstellen: <strong>${fehlt.map(esc).join(", ")}</strong>. Name tippen, dann sagt die Person ein, zwei Sätze
      („Ich bin Tim und spiele Korgo …“). Einmal reicht, auch für die nächsten Abende. Solange jemand fehlt, rät die Mitschrift selbst, wer spricht.`
    : `Alle Stimmen bekannt: Die Mitschrift ordnet jeden Satz einem dieser Plätze zu, es gibt keine fremden Sprecher.
      👂 = Stimme von früher. Passte es letztes Mal nicht, Name nochmal tippen und kurz sprechen.`;
  return `<details class="aufn-stimmen" data-merk="aufn-stimmen"${App.offeneUnter.has("aufn-stimmen") ? " open" : ""}>
    <summary>🎙 Vorstellungsrunde ${stand}</summary>
    <div class="muted small" style="margin:4px 0 6px">${erklaerung}</div>
    <div class="row" style="gap:6px; flex-wrap:wrap">${knoepfe}<button type="button" class="ghost small" data-act="aufn-gast" title="Jemand, der nicht in der Initiative steht">+ Gast</button></div>
  </details>`;
}

async function aufnGast() {
  if (!Aufn.rec) return;
  const name = await eingabe("Name des Gastes? (Danach spricht der Gast ein, zwei Sätze.)", "", "Vorstellen");
  if (name && name.trim()) aufnStimme(name.trim());
}

async function aufnStimme(figur) {
  if (!Aufn.rec || !figur) return;
  try {
    const r = await fetch("/api/aufnahme/stimme", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figur }) });
    const j = await r.json();
    if (j && j.ok) {
      Aufn.status = { ...(Aufn.status || {}), aktiv: j.aktiv, liste: j.liste || (Aufn.status || {}).liste };
      toast(`🎙 ${figur}: jetzt ein, zwei Sätze sprechen`);
      App._letztesHtml = null; render();
    }
  } catch { /* Laptop-Server weg - nichts zu tun */ }
}

async function aufnMarke(knopf) {
  if (!Aufn.rec) return;
  // Sofort merken, ohne Nachfrage: am Tisch zählt der Moment, nicht der Text.
  try { await fetch("/api/aufnahme/marke", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { return; }
  // Danach optional ein Stichwort („Korgos Joker", „Rask flieht") - Kalle
  // 02.11.2026. Seit 16.11.2026 (Studio-Runde Notizen, Vorschlag 6) kein
  // Dialog mehr, der das Spiel anhält: eine kleine Karte schwebt unter dem
  // Knopf, verschwindet nach ein paar Sekunden von selbst, wenn man nichts
  // tippt. Schwebend (position: fixed) - schiebt nichts.
  aufnMarkeKarte(knopf, aufnZeit(aufnLaenge()));
  aufnStatusLaden();
}
function aufnMarkeZu() {
  const k = document.getElementById("marke-karte");
  clearTimeout(Aufn.markeTimer);
  if (k) { k.classList.remove("sichtbar"); setTimeout(() => k.remove(), 180); }
}
function aufnMarkeKarte(knopf, zeit, index) {
  aufnMarkeZu();
  const alt = document.getElementById("marke-karte");
  if (alt) alt.remove();
  const k = document.createElement("div");
  k.id = "marke-karte";
  k.className = "marke-karte";
  k.innerHTML = `<span class="mk-ok">${symbolSvg("circle-check")}Gemerkt ${esc(zeit)}</span>
    <input id="marke-text" maxlength="200" placeholder="Stichwort (optional)" autocomplete="off" enterkeyhint="done">
    <button type="button" class="primary mk-save" aria-label="Stichwort speichern" title="Speichern (Enter)">${symbolSvg("check")}</button>`;
  // Unter den gedrückten Knopf (Kopfleiste oder Panel); sonst oben rechts.
  const r = knopf && knopf.getBoundingClientRect && knopf.isConnected ? knopf.getBoundingClientRect() : null;
  const breite = Math.min(400, window.innerWidth - 16);
  const links = r ? Math.max(8, Math.min(window.innerWidth - breite - 8, r.right - breite + 40)) : window.innerWidth - breite - 16;
  k.style.left = `${links}px`;
  k.style.top = `${r ? r.bottom + 10 : 64}px`;
  k.style.width = `${breite}px`;
  if (r) k.style.setProperty("--pfeil", `${Math.max(16, Math.min(breite - 24, r.left + r.width / 2 - links))}px`);
  document.body.appendChild(k);
  requestAnimationFrame(() => k.classList.add("sichtbar"));
  const feld = k.querySelector("input");
  const speichern = async () => {
    const text = feld.value.trim();
    aufnMarkeZu();
    if (!text) return;
    try {
      await fetch("/api/aufnahme/marke", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nachtragen: true, text, ...(index != null ? { index } : {}) }) });
    } catch { /* Zeit ist gemerkt, nur ohne Stichwort */ }
    aufnStatusLaden();
  };
  // Nichts getippt -> nach 6 s weg; sobald getippt wird, bleibt sie.
  const zuSpaeter = () => { clearTimeout(Aufn.markeTimer); Aufn.markeTimer = setTimeout(() => { if (!feld.value.trim()) aufnMarkeZu(); }, 6000); };
  zuSpaeter();
  feld.addEventListener("input", () => clearTimeout(Aufn.markeTimer));
  feld.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); speichern(); }
    else if (e.key === "Escape") { e.preventDefault(); aufnMarkeZu(); }
  });
  k.querySelector(".mk-save").addEventListener("click", speichern);
  feld.focus({ preventScroll: true });
}
// Klick daneben schließt die Karte (Getipptes wird dabei gespeichert).
document.addEventListener("pointerdown", (e) => {
  const k = document.getElementById("marke-karte");
  if (!k || k.contains(e.target) || (e.target.closest && e.target.closest("[data-act=aufn-marke],[data-act=aufn-moment]"))) return;
  const f = k.querySelector("input");
  if (f && f.value.trim()) k.querySelector(".mk-save").click(); else aufnMarkeZu();
});
// 📌 Gemerkte Momente im Panel: Zeit + Stichwort, ✎ trägt nach.
function aufnMomenteHtml(st) {
  const m = ((st.aktiv || {}).momente) || [];
  if (!m.length) return "";
  return `<div class="aufn-momente">
    <div class="am-kopf">📌 Gemerkte Momente · ${m.length}</div>
    ${m.map((x, i) => `<div class="am-zeile"><b>${aufnZeit(x.t)}</b>${x.text ? `<span>${esc(x.text)}</span>` : `<i>ohne Stichwort</i>`}
      <button type="button" class="am-knopf" data-act="aufn-moment" data-i="${i}" data-zeit="${aufnZeit(x.t)}" aria-label="Stichwort ändern" title="Stichwort ändern">✎</button></div>`).join("")}
  </div>`;
}

// --- Live-Mitschrift ---------------------------------------------------------------
// Der Server schreibt live mit (server/sprache.py); hier nur die
// letzten paar, klein und grau unter der laufenden Aufnahme. Lesen, wenn man
// mag - es soll nicht ablenken, darum kein Hochploppen, kein Ton.

const AUFN_LIVE_ZEILEN = 4;

function aufnLiveHtml() {
  // Sprecher antippen = benennen. Die Nummern bleiben über den Abend gleich
  // (Stimmabdruck), darum gilt der Name ab dann für alle Zeilen dieser Stimme.
  return Aufn.live.slice(-AUFN_LIVE_ZEILEN)
    .map((z) => `<div><button type="button" class="aufn-sprecher${Aufn.liveNamen[z.sprecher] ? " benannt" : ""}" data-act="aufn-live-sprecher" data-sprecher="${esc(z.sprecher)}" title="Wer ist das? Antippen zum Benennen">${esc(Aufn.liveNamen[z.sprecher] || z.sprecher)}</button> ${esc(z.text)}</div>`).join("");
}

async function aufnLiveHolen() {
  let erg;
  try { erg = await (await fetch(`/api/aufnahme/live?ab=${Aufn.liveN}`)).json(); } catch { return; }
  // Andere Aufnahme als die, deren Zeilen wir haben (neu gestartet)?
  if (erg.aufnahme !== Aufn.liveAufnahme) { Aufn.live = []; Aufn.liveN = 0; Aufn.liveAufnahme = erg.aufnahme; }
  const namenNeu = JSON.stringify(erg.namen || {}) !== JSON.stringify(Aufn.liveNamen);
  Aufn.liveNamen = erg.namen || {};
  const neu = (erg.zeilen || []).filter((z) => z.n > Aufn.liveN);
  if (!neu.length && !namenNeu) return;
  Aufn.live = Aufn.live.concat(neu).slice(-AUFN_LIVE_ZEILEN);
  if (neu.length) Aufn.liveN = neu[neu.length - 1].n;
  const html = aufnLiveHtml();
  document.querySelectorAll(".aufn-live").forEach((x) => { x.innerHTML = html; });
}
setInterval(() => { if (Aufn.rec) aufnLiveHolen(); }, 3000);

// --- Spracherkennung (Modelle, genau) ----------------------------------------------

async function aufnSprache(url, body) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const sp = await r.json();
    if (Aufn.status) Aufn.status.sprache = sp;
  } catch { /* nächster Abruf zeigt den Stand */ }
  aufnStatusLaden();
}

// Fortschritt (Modelle laden, genau transkribieren) nachführen. Nur Balken und
// Text anfassen - ein ganzes render() alle paar Sekunden über eine Stunde
// würde am Spieltisch stören (Eingaben, Aufklappen).
let aufnLetzterStand = "";
let aufnSitzRunden = 0;
setInterval(async () => {
  const sp = Aufn.status && Aufn.status.sprache;
  if (App.role !== "gm" || !sp) return;
  // Sitzplatz einrichten: solange der Treiber lädt, und danach (Installer
  // läuft in eigenem Fenster) ab und zu neu nachsehen - der SL soll nicht
  // „Erneut prüfen" drücken müssen. Höchstens zehn Minuten, dann ist Ruhe.
  const sitz = sp.richtung && sp.richtung.einrichtung;
  const sitzLaedt = aufnSitzLaedt(sitz);
  const sitzWartet = !!(sitz && sitz.laden && sitz.laden.schritt === "gestartet" && !sitz.kapseln && !Aufn.rec);
  aufnSitzRunden = sitzWartet ? aufnSitzRunden + 1 : 0;
  const sitzSchaut = sitzWartet && aufnSitzRunden <= 240;
  if (!(sp.laden || sp.job || sitzLaedt || sitzSchaut)) return;
  let st;
  try {
    // Jede vierte Runde (10 s) die Geräte wirklich neu einlesen lassen.
    if (sitzSchaut && aufnSitzRunden % 4 === 0 && !(sp.laden || sp.job)) {
      const r = await fetch("/api/sprache/sitzplatz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "pruefen" }) });
      st = Object.assign({}, Aufn.status, { sprache: await r.json() });
    } else if (sp.laden || sp.job || sitzLaedt) st = await (await fetch("/api/aufnahme")).json();
    else return;
  } catch { return; }
  const neu = st.sprache || {};
  const ne = (neu.richtung && neu.richtung.einrichtung) || {};
  const stand = JSON.stringify([!!neu.laden, neu.laden && neu.laden.fehler, neu.job && neu.job.name, neu.job && neu.job.fehler, neu.bereit,
    ne.connex, ne.treiber, ne.kapseln, ne.laden && ne.laden.schritt, ne.laden && ne.laden.fehler]);
  Aufn.status = st;
  // Ein-Klick ging nicht: gleich die Anleitung zeigen (Kalle wählte „mit
  // Anleitung als Rückfall"), nicht nur einen Knopf dafür.
  const sitzKaputt = sitzLaedt && ne.laden && ne.laden.fehler;
  if (stand !== aufnLetzterStand) { aufnLetzterStand = stand; render(); if (sitzKaputt) aufnSitzAnleitung(); return; }
  if (sitzLaedt && ne.laden) {
    // Eigener Balken in der Sitzplatz-Zeile - nicht den der Mitschrift anfassen.
    document.querySelectorAll(".aufn-sitz .aufn-balken > i").forEach((x) => { x.style.transform = `scaleX(${(ne.laden.anteil || 0).toFixed(3)})`; });
    document.querySelectorAll(".aufn-sitz-fortschritt").forEach((x) => { x.textContent = aufnSitzText(ne.laden); });
    if (!(neu.laden || neu.job)) return;
  }
  const anteil = neu.job ? neu.job.anteil : neu.laden ? neu.laden.b / Math.max(1, neu.laden.gesamt) : 0;
  const text = neu.job ? aufnJobText(neu.job) : `Mitschrift wird eingerichtet … ${Math.round(anteil * 100)} %`;
  document.querySelectorAll(".aufn-balken > i").forEach((x) => { if (!x.closest(".aufn-sitz")) x.style.transform = `scaleX(${anteil.toFixed(3)})`; });
  document.querySelectorAll(".aufn-fortschritt").forEach((x) => { x.textContent = text; });
}, 2500);

// --- Namen & Begriffe, Wer ist wer -------------------------------------------------

async function aufnBegriffe() {
  const sp = (Aufn.status && Aufn.status.sprache) || {};
  const text = await dialog({
    text: "Namen & Begriffe der Runde – Orte, Schiffe, NSCs, Fraktionen. Einer pro Zeile.\n\nKlingt etwas in der Mitschrift fast so, wird es so geschrieben („Kogo“ → „Korgo“). Figuren, Gegner und Spieler aus der App sind automatisch dabei.",
    inhalt: `<textarea class="aufn-begriffe" rows="8" placeholder="Krauzern\nSturmvogel\nKapitän Branok">${esc((sp.begriffe || []).join("\n"))}</textarea>`,
    lesen: (box) => box.querySelector("textarea").value,
    knoepfe: [
      { text: "Abbrechen", wert: null, abbruch: true },
      { text: "Speichern", art: "primary", standard: true },
    ],
  });
  if (text === null || text === undefined) return;
  aufnSprache("/api/sprache/einstellen", { begriffe: text });
}

// Sprecher benennen: je Stimme die längsten Sätze als Erinnerungshilfe, dazu
// eine Auswahl (SL, Figuren der Aufnahme) oder frei eintippen.
async function aufnSprecherDialog(name, quelle, nur = null) {
  let d;
  try {
    const r = await fetch(`/api/aufnahme/sprecher/${encodeURIComponent(name)}?quelle=${quelle}`);
    if (r.ok) d = await r.json();
  } catch { /* unten */ }
  if (!d || !d.sprecher.length) { hinweis("Noch keine Sprecher im Text."); return; }
  const liste = d.sprecher.filter((x) => !nur || x.sprecher === nur);
  const vorschlaege = d.vorschlaege || [];
  const zeilen = liste.map((x) => {
    const jetzt = d.namen[x.sprecher] || "";
    const optionen = [`<option value="">– unbekannt –</option>`]
      .concat(vorschlaege.map((v) => `<option${v === jetzt ? " selected" : ""}>${esc(v)}</option>`));
    if (jetzt && !vorschlaege.includes(jetzt)) optionen.push(`<option selected>${esc(jetzt)}</option>`);
    optionen.push(`<option value="__frei">Anderer Name …</option>`);
    return `<div class="aufn-wer" data-sprecher="${esc(x.sprecher)}">
      <div class="aufn-wer-kopf"><b>${esc(x.sprecher)}</b> <span class="muted small">${Math.round(x.anteil * 100)} % vom Text</span>
        <select>${optionen.join("")}</select>
        <input class="aufn-wer-frei" placeholder="Name" maxlength="60" style="display:none"></div>
      ${x.beispiele.map((b) => `<div class="aufn-wer-bsp muted small">„${esc(b)}“</div>`).join("")}
    </div>`;
  }).join("");
  const namen = await dialog({
    text: nur ? "Wer ist das?" : `${d.fest ? "Nach der Vorstellungsrunde zugeordnet (feste Plätze) – nur korrigieren, wenn was nicht stimmt. " : d.automatisch ? "Von der App vorausgefüllt (wer am meisten erzählt, wer seine Figur ansagt, wessen Zug war) – nur korrigieren, wenn was nicht stimmt. " : ""}Der Prompt nennt dann Namen statt S00, S01 … NSC-Stimme vom SL: einfach auch „Spielleiter“ wählen.`,
    inhalt: `<div class="aufn-wer-liste">${zeilen}</div>`,
    lesen: (box) => {
      const erg = { ...d.namen };
      box.querySelectorAll(".aufn-wer").forEach((z) => {
        const wahl = z.querySelector("select").value;
        const frei = z.querySelector(".aufn-wer-frei").value.trim();
        const wert = wahl === "__frei" ? frei : wahl;
        if (wert) erg[z.dataset.sprecher] = wert; else delete erg[z.dataset.sprecher];
      });
      return erg;
    },
    knoepfe: [
      { text: "Abbrechen", wert: null, abbruch: true },
      { text: "Übernehmen", art: "primary", standard: true },
    ],
  });
  if (!namen) return;
  try {
    await fetch(`/api/aufnahme/sprecher/${encodeURIComponent(name)}?quelle=${quelle}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ namen }) });
  } catch { /* egal */ }
  if (quelle === "live") { Aufn.liveNamen = namen; document.querySelectorAll(".aufn-live").forEach((x) => { x.innerHTML = aufnLiveHtml(); }); }
  else toast("👥 Gespeichert – der Prompt nennt jetzt Namen");
}
// „Anderer Name …" blendet das Textfeld ein.
document.addEventListener("change", (e) => {
  const sel = e.target.closest(".aufn-wer select");
  if (!sel) return;
  const frei = sel.parentElement.querySelector(".aufn-wer-frei");
  frei.style.display = sel.value === "__frei" ? "" : "none";
  if (sel.value === "__frei") frei.focus();
});

// --- Transkript -> Prompt --------------------------------------------------------

async function aufnPromptBauen(name, datei) {
  if (!datei) return;
  const fd = new FormData();
  fd.append("file", datei);
  let erg;
  try {
    const r = await fetch(`/api/aufnahme/prompt/${encodeURIComponent(name)}`, { method: "POST", body: fd });
    erg = await r.json();
  } catch { /* unten */ }
  if (!erg || !erg.prompt) { hinweis("Aus dieser Datei ließ sich kein Prompt bauen (leer oder kein Transkript?)."); return; }
  aufnPromptZeigen(name, erg.prompt);
}

async function aufnPromptAus(name, quelle) {
  let erg;
  try { erg = await (await fetch(`/api/aufnahme/prompt-aus/${encodeURIComponent(name)}?quelle=${quelle}`, { method: "POST" })).json(); } catch { /* unten */ }
  if (!erg || !erg.prompt) { hinweis(quelle === "live" ? "Die Live-Mitschrift ist leer." : "Das Transkript ist leer."); return; }
  aufnPromptZeigen(name, erg.prompt);
}

async function aufnPromptZeigen(name, prompt) {
  aufnStatusLaden();
  const wahl = await dialog({
    text: `Prompt fertig (${prompt.length.toLocaleString("de-DE")} Zeichen).\n\nIn Claude einfügen (Strg+V) – Claude schreibt daraus das Protokoll.`,
    knoepfe: [
      { text: "Schließen", wert: null, abbruch: true },
      { text: "⬇ Als Datei", wert: "datei" },
      { text: "📋 Kopieren & Claude öffnen", wert: "kopieren", art: "primary", standard: true },
    ],
  });
  if (wahl === "kopieren") {
    try {
      await navigator.clipboard.writeText(prompt);
      window.open("https://claude.ai/new", "_blank", "noopener");
    } catch { aufnPromptDatei(name, prompt); hinweis("Kopieren ging nicht – Prompt stattdessen als Datei gespeichert."); }
  } else if (wahl === "datei") {
    aufnPromptDatei(name, prompt);
  }
}

function aufnPromptDatei(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `protokoll-prompt-${name}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Eigene Klick-/Änderungs-Handler: die Knöpfe heißen alle „aufn-…", der große
// Handler in ereignisse.js kennt sie nicht und lässt sie in Ruhe.
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act^='aufn-']");
  if (!t || App.role !== "gm") return;
  const act = t.dataset.act;
  if (act === "aufn-start") { e.preventDefault(); aufnahmeStarten(); }
  else if (act === "aufn-abend") { e.preventDefault(); abendStarten(); }
  else if (act === "aufn-abend-ende") { e.preventDefault(); abendBeenden(); }
  else if (act === "aufn-stop") {
    e.preventDefault();
    if (await frage("Aufnahme beenden?", "Beenden")) aufnahmeBeenden();
  } else if (act === "aufn-marke") { e.preventDefault(); aufnMarke(t); }
  else if (act === "aufn-moment") {
    e.preventDefault();
    aufnMarkeKarte(t, t.dataset.zeit, Number(t.dataset.i));
    const m = (((Aufn.status || {}).aktiv || {}).momente || [])[Number(t.dataset.i)];
    const f = document.getElementById("marke-text");
    if (f && m && m.text) f.value = m.text;
  }
  else if (act === "aufn-pause") { e.preventDefault(); aufnPause(); }
  else if (act === "aufn-weiter") { e.preventDefault(); aufnWeiter(); }
  else if (act === "aufn-stimme") { e.preventDefault(); aufnStimme(t.dataset.figur); }
  else if (act === "aufn-gast") { e.preventDefault(); aufnGast(); }
  else if (act === "aufn-prompt") { e.preventDefault(); aufnPromptAus(t.dataset.name, t.dataset.quelle); }
  else if (act === "aufn-sitz-treiber") { e.preventDefault(); aufnSitzTreiber(); }
  else if (act === "aufn-sitz-anleitung") { e.preventDefault(); aufnSitzAnleitung(); }
  else if (act === "aufn-sitz-pruefen") { e.preventDefault(); aufnSprache("/api/sprache/sitzplatz", { aktion: "pruefen" }); }
  else if (act === "aufn-modelle") { e.preventDefault(); aufnSprache("/api/sprache/modelle"); }
  else if (act === "aufn-begriffe") { e.preventDefault(); aufnBegriffe(); }
  else if (act === "aufn-sprecher") { e.preventDefault(); aufnSprecherDialog(t.dataset.name, t.dataset.quelle); }
  else if (act === "aufn-live-sprecher") {
    e.preventDefault();
    if (Aufn.name) aufnSprecherDialog(Aufn.name, "live", t.dataset.sprecher);
  }
  else if (act === "aufn-genau") { e.preventDefault(); aufnSprache(`/api/sprache/genau/${encodeURIComponent(t.dataset.name)}`); }
  else if (act === "aufn-abbrechen") {
    e.preventDefault();
    if (await frage("Transkription abbrechen?", "Abbrechen", true)) aufnSprache("/api/sprache/abbrechen");
  }
  else if (act === "aufn-loeschen") {
    e.preventDefault();
    if (!await frage("Diese Aufnahme löschen?\n\nTon, Transkript und Prompt sind dann weg.", "Löschen", true)) return;
    try { await fetch(`/api/aufnahme/loeschen/${encodeURIComponent(t.dataset.name)}`, { method: "POST" }); } catch { /* egal */ }
    aufnStatusLaden();
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.dataset || App.role !== "gm") return;
  if (t.dataset.act === "aufn-live-an") {
    aufnSprache("/api/sprache/einstellen", { live: t.checked });
  } else if (t.dataset.act === "aufn-personen") {
    aufnSprache("/api/sprache/einstellen", { personen: Number(t.value) });
  } else if (t.dataset.act === "aufn-mikro") {
    try { localStorage.setItem("aufnahmeMikro", t.value); } catch { /* egal */ }
  } else if (t.dataset.act === "aufn-transkript") {
    aufnPromptBauen(t.dataset.name, t.files && t.files[0]);
    t.value = "";
  }
});
