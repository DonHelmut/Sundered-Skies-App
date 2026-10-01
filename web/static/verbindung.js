// Verbindung zum Server (WebSocket, Heartbeat, Neuverbinden) und das
// Überbrücken kurzer Aussetzer (Warteschlange).
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// --- Verbindung -------------------------------------------------------------

// App-Heartbeat: erkennt eine tote Leitung (WLAN-Aussetzer) in Sekunden, statt
// zu warten bis TCP von selbst zusammenbricht. Alle 4 s ein Ping; kommt >9 s
// nichts mehr vom Server (auch kein Pong), Verbindung hart schließen -> Reconnect.
// Bei flackerndem WLAN zählt jede Sekunde: je früher wir den Abriss bemerken,
// desto früher läuft der Wiederaufbau - und desto kürzer steht das Spiel.
let heartbeatTimer = null;
function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    const ws = App.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - (App.lastRecv || 0) > 9000) {
      try { ws.close(); } catch { /* onclose übernimmt den Reconnect */ }
      return;
    }
    try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* nächster Tick */ }
  }, 4000);
}

// Hat das Handy still auf Mobilfunk umgeschaltet? Passiert, wenn das WLAN kein
// Internet hat (Router lebt, Anbieter-Leitung tot): das Handy schickt dann alles
// ueber mobile Daten und findet den Laptop im WLAN nicht mehr – obwohl „WLAN
// verbunden" dasteht. Chrome auf Android verraet das ueber navigator.connection;
// iPhone/Safari kennt die Schnittstelle nicht, dort bleibt es beim allgemeinen
// Hinweis nach 25 s.
function aufMobilfunk() {
  try { return !!navigator.connection && navigator.connection.type === "cellular"; } catch { return false; }
}
try {
  // Mobile Daten aus -> Netz wechselt zurueck aufs WLAN -> sofort neu verbinden
  // statt auf den naechsten 1,5-s-Versuch zu warten; Hinweis aktualisieren.
  if (navigator.connection && navigator.connection.addEventListener) {
    navigator.connection.addEventListener("change", () => {
      if (aufMobilfunk()) App.warMobilfunk = true;
      if ($("offline-hinweis") || offlineTimer) zeigeOfflineHinweis();
      ensureConnected();
    });
  }
} catch { /* ohne Schnittstelle eben nicht */ }

function connect() {
  // Keine Doppel-Sockets: läuft schon einer (verbindend/offen), nichts tun.
  if (App.ws && (App.ws.readyState === WebSocket.CONNECTING || App.ws.readyState === WebSocket.OPEN)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  App.ws = ws;

  ws.onopen = () => {
    App.lastRecv = Date.now();
    App.reconnectTries = 0;
    setStatus("online");
    versteckeOfflineHinweis();
    startHeartbeat();
    // War die Leitung vorher weg? Dauer an den Server melden (fürs Diagnose-Log).
    if (App.wentOfflineAt) {
      const gapMs = Date.now() - App.wentOfflineAt;
      App.wentOfflineAt = 0;
      // Stand das Handy zwischendurch auf Mobilfunk, steht die Ursache im Log.
      const event = App.warMobilfunk ? "wieder verbunden (war auf Mobilfunk)" : "wieder verbunden";
      App.warMobilfunk = false;
      try { ws.send(JSON.stringify({ type: "clientlog", event, gapMs })); } catch { /* egal */ }
    }
  };
  ws.onclose = () => {
    stopHeartbeat();
    if (aufMobilfunk()) App.warMobilfunk = true;
    if (!App.wentOfflineAt) App.wentOfflineAt = Date.now();
    App.reconnectTries = (App.reconnectTries || 0) + 1;
    setStatus("offline");
    zeigeOfflineHinweis();
    // Kommt die Leitung 20 s nicht zurück, könnte der Laptop eine ANDERE
    // Adresse haben (WLAN-Aussetzer, Router-Neustart). Dann die übrigen
    // bekannten Adressen durchprobieren und dorthin umleiten.
    if (Date.now() - App.wentOfflineAt > 20000) adressFallback();
    setTimeout(connect, 1500);
  };
  ws.onerror = () => setStatus("reconnect");
  ws.onmessage = (ev) => {
    App.lastRecv = Date.now();   // jede Nachricht (auch Pong) hält die Leitung „frisch"
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "pong") return;   // reiner Heartbeat, nichts zu tun
    if (msg.type === "hello") {
      if (veraltetNeuLaden(msg.version, ASSET_VERSION)) return;
      App.role = msg.role;
      document.body.classList.toggle("player", App.role === "player");
      // Die SL-Optik (Kopfleiste, flache Panels, Liste als Tabelle) gilt nur am
      // Laptop - die Handys behalten ihre gewohnte Ansicht.
      document.body.classList.toggle("sl-ansicht", App.role === "gm");
      maybeAutoRejoin();
      // ERST nach dem Wieder-Beitritt nachreichen: vorher weiß der Server
      // nicht, wer da sendet, und würde Spieler-Aktionen verwerfen.
      warteschlangeSenden();
    } else if (msg.type === "state") {
      if (msg.state.serverNow) App.clockOffset = msg.state.serverNow - Date.now();
      App.state = msg.state;
      if (App.role === "gm" && !App._ansichtAbgeglichen) {
        App._ansichtAbgeglichen = true;
        if (slAnsichtUebernehmen(msg.state.slAnsicht)) App._letztesHtml = null;
      }
      checkRequestAlert();   // SL: neue Anfrage -> Signal
      checkEffektMeldungen(); // SL: Dauer-Effekt abgelaufen -> Hinweis
      checkTurnNotify();     // Spieler: dran -> Vibration/Ton
      pruefeAktivenWechsel();  // SL: aktive Zeile ins Bild holen
      // Während einer laufenden Karten-Aufdeckung NICHT sofort neu rendern – sonst
      // baut render() die Karte neu und sie schnappt aufgedeckt (das „Hakeln").
      // Neuesten Zustand nur merken und direkt nach der Animation einmal anwenden.
      if (App.revealLockUntil && Date.now() < App.revealLockUntil) { App.pendingRender = true; return; }
      // Spieler tippt gerade im Charakterbogen -> nach dem Feld nachholen.
      if (tipptImBogen() || blattScrollt()) { App.bogenWartet = true; if (blattScrollt()) setTimeout(bogenNachholen, 800); return; }
      render();
    } else if (msg.type === "joinError") {
      // Charakter wird gerade woanders gespielt oder ist unbekannt -> zurück
      // auf die Beitrittsseite, mit Erklärung.
      App.joined = false;
      App.joinFehler = msg.message || null;
      if (msg.grund === "unbekannt") {
        // Gemerkte ID stammt von einem anderen/alten Server: vergessen, damit
        // das Handy nicht bei jedem Verbinden wieder anklopft.
        App.myPlayerId = null; App.myCharacterId = null;
        try { localStorage.removeItem("playerId"); localStorage.removeItem("characterId"); } catch { /* egal */ }
      }
      if (App.state && (App.state.roster || []).length) App.joinEntwurf.modus = "liste";
      if (msg.grund === "charakter-unbekannt") {
        // Veraltete ID aus einer früheren Runde vergessen - sonst meldet sich
        // das Handy beim nächsten Laden automatisch wieder damit an.
        App.myCharacterId = null;
        try { localStorage.removeItem("characterId"); } catch { /* egal */ }
      }
      render();
    } else if (msg.type === "joined") {
      App.myPlayerId = msg.playerId;
      App.joined = true;
      localStorage.setItem("playerId", msg.playerId);
      render();
    }
  };
}

// Verbindung weg: großer, ruhiger Hinweis statt nur der kleinen Pille oben.
// Wichtig ist die Bitte, NICHT neu zu laden - ein Neuladen holt die Seite vom
// Server, und genau der ist ja gerade nicht erreichbar. Dann bliebe das Handy
// auf einer leeren Fehlerseite sitzen, während die App sich von selbst wieder
// gefangen hätte.
let offlineTimer = null;
function zeigeOfflineHinweis() {
  const seit = App.wentOfflineAt ? Math.round((Date.now() - App.wentOfflineAt) / 1000) : 0;
  const mobil = aufMobilfunk();
  if (mobil) App.warMobilfunk = true;
  let el = $("offline-hinweis");
  if (!el) {
    // Erst nach 4 s einblenden - kurze Aussetzer soll niemand mitbekommen.
    // Ausnahme Mobilfunk: das geht NICHT von selbst weg, also sofort zeigen.
    if (seit < 4 && !mobil) {
      if (!offlineTimer) offlineTimer = setTimeout(() => { offlineTimer = null; zeigeOfflineHinweis(); }, 4000);
      return;
    }
    el = document.createElement("div");
    el.id = "offline-hinweis";
    el.className = "offline-hinweis";
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="offline-box">
      <div class="offline-titel">📡 Verbindung unterbrochen</div>
      ${mobil ? `<div class="offline-mobilfunk">
        <div class="offline-mobilfunk-titel">📱 Dein Handy ist auf Mobilfunk umgesprungen</div>
        Das WLAN hat gerade kein Internet – deshalb nutzt dein Handy mobile Daten und
        findet den Spieltisch nicht mehr.<br>
        <b>Mobile Daten ausschalten</b> (oder Flugmodus an und WLAN wieder an) –
        dann geht es sofort weiter.
      </div>` : ""}
      <div class="offline-text">Die App versucht es von selbst weiter – <b>Versuch ${App.reconnectTries || 1}</b>, seit ${seit} s.</div>
      <div class="offline-warn">Bitte die Seite <b>NICHT neu laden</b> und den Tab offen lassen.<br>Sobald das WLAN zurück ist, geht es automatisch weiter.</div>
      ${App.warteschlange.length
        ? `<div class="offline-warteschlange">✋ ${App.warteschlange.length} Eingabe${App.warteschlange.length === 1 ? "" : "n"} gemerkt – wird nachgereicht, sobald die Verbindung steht.</div>`
        : `<div class="offline-text small">Was du jetzt tippst, wird gemerkt und nachgereicht.</div>`}
      ${seit > 25 && !mobil ? `<div class="offline-text small" style="text-align:left; line-height:1.5">
        <b>Dauert es länger?</b> Hat das WLAN gerade kein Internet, schalten viele
        Handys still auf <b>Mobilfunk</b> um – dann ist der Laptop unerreichbar,
        obwohl „WLAN verbunden“ dasteht.<br>Abhilfe: mobile Daten kurz ausschalten.
      </div>` : ""}
      <div class="offline-text small">Adresse: ${esc(location.host)}</div>
      <button class="primary" data-act="jetzt-verbinden">Jetzt erneut versuchen</button>
    </div>`;
}

function versteckeOfflineHinweis() {
  if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
  const el = $("offline-hinweis");
  if (el) el.remove();
}

// Der Laptop kann nach einem WLAN-Aussetzer eine andere IP haben. Wir kennen
// aus /api/info alle seine Adressen - die der Reihe nach anklopfen und bei der
// ersten, die antwortet, weitermachen. Läuft höchstens einmal pro Minute.
async function adressFallback() {
  if (App._fallbackLaeuft) return;
  const zuletzt = Number(localStorage.getItem("fallbackZeit") || 0);
  if (Date.now() - zuletzt < 60000) return;
  App._fallbackLaeuft = true;
  localStorage.setItem("fallbackZeit", String(Date.now()));
  try {
    let adressen = [];
    try { adressen = JSON.parse(localStorage.getItem("serverAdressen") || "[]"); } catch { /* egal */ }
    for (const url of adressen) {
      if (url.includes(location.host)) continue;          // die aktuelle bringt nichts
      try {
        const r = await fetch(url + "api/info", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (!r.ok) continue;
        const info = await r.json();
        if (!info || !info.prettyUrl) continue;           // fremder Dienst, nicht unsere App
        location.replace(url);                            // dort geht es weiter
        return;
      } catch { /* nächste Adresse */ }
    }
  } finally {
    App._fallbackLaeuft = false;
  }
}

// Handys pausieren beim Sperren die Reconnect-Schleife. Beim Wieder-Aufwecken
// (Tab sichtbar / Fokus / Netz zurück) SOFORT neu verbinden statt zu warten.
function ensureConnected() {
  if (!App.ws || App.ws.readyState === WebSocket.CLOSING || App.ws.readyState === WebSocket.CLOSED) connect();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) ensureConnected(); });
window.addEventListener("focus", ensureConnected);
window.addEventListener("online", ensureConnected);

// Alle Adressen des Servers merken - Grundlage für adressFallback().
function merkeServerAdressen(info) {
  try {
    const urls = (info && info.urls) || [];
    if (urls.length) localStorage.setItem("serverAdressen", JSON.stringify(urls));
  } catch { /* Speicher voll/gesperrt - dann eben ohne */ }
}

function setStatus(kind) {
  const map = {
    online: ["good", "Verbunden"],
    offline: ["bad", "Getrennt – neuer Versuch…"],
    reconnect: ["warn", "Verbinde neu…"],
  };
  const [cls, txt] = map[kind] || ["", "…"];
  const s = $("status");
  if (s) { s.className = "pill " + cls; s.textContent = txt; }
}

// --- Aussetzer überbrücken ---------------------------------------------------
// Bisher verschwand jede Aktion, die während eines WLAN-Aussetzers getippt
// wurde, ersatzlos: der Spieler tippt „Zug bestätigen", nichts passiert, und
// niemand merkt warum. Jetzt warten solche Aktionen und werden beim
// Wiederverbinden nachgereicht.
const WARTE_MAX_ALTER = 25000;   // älter als das wäre keine gültige Absicht mehr
const WARTE_MAX_ANZAHL = 20;

function merkeFuerSpaeter(obj) {
  // Herzschlag und Protokollmeldungen nachzureichen wäre sinnlos.
  if (obj.type === "ping" || obj.type === "clientlog") return;
  const text = JSON.stringify(obj);
  // Wer aus Ungeduld fünfmal tippt, soll nicht fünf Aktionen auslösen.
  if (App.warteschlange.some((e) => e.text === text)) return;
  App.warteschlange.push({ text, zeit: Date.now() });
  if (App.warteschlange.length > WARTE_MAX_ANZAHL) App.warteschlange.shift();
  zeigeOfflineHinweis();      // Zähler im Hinweis mitführen
}

function warteschlangeSenden() {
  if (!App.warteschlange.length) return;
  const jetzt = Date.now();
  const frisch = App.warteschlange.filter((e) => jetzt - e.zeit < WARTE_MAX_ALTER);
  const verworfen = App.warteschlange.length - frisch.length;
  App.warteschlange = [];
  let ok = 0;
  frisch.forEach((e) => { try { App.ws.send(e.text); ok++; } catch { /* Leitung doch wieder weg */ } });
  if (ok) toast(`${ok} Aktion${ok === 1 ? "" : "en"} nachgereicht.`);
  if (verworfen) toast(`${verworfen} zu alte Aktion${verworfen === 1 ? "" : "en"} verworfen.`);
}

function gmAction(action) { wsSend({ type: "gm_action", action }); }

function wsSend(obj) {
  if (App.ws && App.ws.readyState === 1) {
    try { App.ws.send(JSON.stringify(obj)); return true; }
    catch { /* Socket kippte genau jetzt -> unten einreihen */ }
  }
  merkeFuerSpaeter(obj);
  return false;
}
