// Mimi die Katze – ein rein optisches, lokales Gimmick (pro Gerät an/aus, auch
// am Handy). Ist sie an, streift sie herum, döst, pfotelt an Karten und treibt
// ab und zu Schabernack.
//
// Schabernack mit „Sachen verstellen" (Design umschalten, Knöpfe drücken,
// Licht aus, Zeilen vertauschen …) ist IMMER nur Optik auf diesem Gerät und
// dreht sich nach ein paar Sekunden selbst zurück (Stefan: danach wieder die
// Einstellungen des Nutzers). Mimi klickt nie wirklich, schickt nichts an den
// Server und speichert nichts. Bei Eingaben/Dialogen/eigenem Zug lässt sie es.
// Stefan fand es zu viel -> verstellende Streiche selten und mit Abstand.
//
// Interaktion: Antippen öffnet ein kleines Menü (Futter, Trinken, Spielen,
// Streicheln). Ab und zu wünscht sie sich etwas – das zeigt sie nur leise
// („miau?") und im Menü leuchtet der Wunsch. Eine versorgte Mimi ist eine
// Weile ruhiger. Nichts davon drängt sich auf (Stefan: soll nicht nerven).

(function () {
  const KEY = "mimi-on";
  let on = localStorage.getItem(KEY) === "1";
  let cat = null;
  let timer = null;
  let need = null;              // "futter" | "trinken" | "spielen" | null
  let busy = false;
  let menue = null;
  let ruhigBis = 0;             // bis wann Mimi zufrieden (= keine Streiche) ist
  let letzterStreich = 0;       // Abstand zwischen verstellenden Streichen
  const STREICH_ABSTAND = 50000;
  // Rücksetzer für laufenden Schabernack - beim Ausschalten sofort alle ausführen.
  const zurueck = new Set();
  function spaeterZurueck(fn, ms) {
    const einmal = () => { if (zurueck.delete(einmal)) fn(); };
    zurueck.add(einmal);
    setTimeout(einmal, ms);
  }
  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const handy = () => { try { return window.matchMedia("(pointer: coarse)").matches || W() < 700; } catch { return W() < 700; } };

  // Mimi: schlanke, helle Tigerkatze (gestreift) mit rotem Umhang - frech,
  // verspielt, clever, cool und gerissen (Stefan). Die Bengal-Rosetten sahen
  // gezeichnet nicht gut aus -> klare Streifen. Mehrere Fellfarben
  // (MIMI_FELLE), gleiche Zeichnung. Seitenansicht, blickt nach rechts.
  // Die Klassen (mi-tail, mi-leg-*, mi-head, mi-eyes …) steuern die Animationen
  // in style.css - beim Umzeichnen beibehalten.
  const MIMI_FELLE = {
    rot:    { name: "Rote Tigerkatze", fell: "#f1b26a", fell2: "#e39f55", hell: "#fbe8c8", rand: "#9a5a22", streif: "#c9742f", auge: "#9bd96a" },
    creme:  { name: "Creme",           fell: "#f3dcb4", fell2: "#e8cc9c", hell: "#fcf3e2", rand: "#a0784a", streif: "#d4a86c", auge: "#e0b84c" },
    silber: { name: "Silber-Tabby",    fell: "#dcd9d3", fell2: "#cbc7c0", hell: "#f6f4ef", rand: "#6e6862", streif: "#6f6964", auge: "#8fd06c" },
    blau:   { name: "Blaugrau",        fell: "#bcc4cc", fell2: "#aab3bc", hell: "#eef1f4", rand: "#5d6671", streif: "#7b8591", auge: "#e3b34a" },
  };
  function catSVG(art) {
    const F = MIMI_FELLE[art] || MIMI_FELLE.rot;
    const FELL = F.fell, FELL2 = F.fell2, HELL = F.hell, RAND = F.rand, STREIF = F.streif, AUGE = F.auge,
      DUNKEL = "#2a1a0e", OHR = "#efb8aa", NASE = "#d98579", CAPE = "#a82a22", CAPE2 = "#65150f", GOLD = "#e8c25a";
    const L = 1;     // feine Linien
    const strich = (d, w = 1.6, o = 0.9) => `<path d="${d}" stroke="${STREIF}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity="${o}"/>`;
    // Alle vier Beine gleich geformt, schlank, mit Pfote und Zehen, zwei Streifen.
    const bein = (cls, x, farbe) => `<g class="mi-leg ${cls}">
        <path d="M${x},36 C${x - 0.4},44 ${x + 0.6},50 ${x + 0.8},55 L${x + 5.8},55 C${x + 6},50 ${x + 6.8},44 ${x + 7.2},36 Z" fill="${farbe}" stroke="${RAND}" stroke-width="${L}" stroke-linejoin="round"/>
        ${strich(`M${x + 0.8},45.4 q2.6,1 5.4,-0.2`, 1.3, 0.8)}${strich(`M${x + 1},49.8 q2.4,0.9 4.8,-0.2`, 1.2, 0.8)}
        <path d="M${x - 0.2},54.6 C${x - 0.4},58.6 ${x + 7.6},58.8 ${x + 7.6},55 C${x + 5.4},53.8 ${x + 2},53.8 ${x - 0.2},54.6 Z" fill="${HELL}" stroke="${RAND}" stroke-width="${L * 0.8}"/>
        <path d="M${x + 2.6},56.4 v1.3 M${x + 4.9},56.4 v1.3" stroke="${RAND}" stroke-width="0.5" stroke-linecap="round"/></g>`;
    return `<svg viewBox="0 -24 106 94" xmlns="http://www.w3.org/2000/svg">
      <g class="mi-tail">
        <path d="M24,31 C11,27 7,14 12,2 C15,-6 22,-10 27,-8 C29,-7 29,-5 27,-4 C22,-3 19,2 20,9 C21,17 26,21 29,26 Z" fill="${FELL}" stroke="${RAND}" stroke-width="${L}" stroke-linejoin="round"/>
        ${strich("M13.5,20 q3,-2.4 6.6,-0.4 M12,12 q3.6,-1.6 7.6,0.2 M12.4,4 q3.6,-1.2 7.4,0.8 M15.6,-3.4 q3,-1 6,1", 2)}
        <path d="M22,-8.6 C25,-9.4 28.6,-8 27.6,-5.4 C26,-4.2 23.6,-4.6 22,-5.4 Z" fill="${STREIF}"/>
      </g>
      ${bein("mi-leg-b1", 25, FELL2)}${bein("mi-leg-f1", 57, FELL2)}
      ${bein("mi-leg-b2", 33, FELL)}${bein("mi-leg-f2", 65, FELL)}
      <path d="M18,30 C18,24 26,20.5 36,20 L58,20 C66,20 72,24 72,30 C72,36 69,40.6 64,41 C60,41.3 57,39.2 52,38.3 C46,37.3 40,37.8 34,39.2 C28,40.6 22,39.8 19.6,36.2 C18.6,34.6 18,32.4 18,30 Z"
        fill="${FELL}" stroke="${RAND}" stroke-width="${L}" stroke-linejoin="round"/>
      <path d="M37,38.8 C42,37.6 48,37.4 53,38.4 M58.6,39.6 C60.6,40.4 62.6,40.6 64.4,40.2" stroke="${HELL}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.8"/>
      ${strich("M20.6,31 q1.4,3.4 0.4,6.2 M25,33 q1.2,2.8 0.4,5.6 M40,34.4 q0.8,1.6 0.4,2.8 M46,34 q0.8,1.6 0.4,3 M52,33 q0.8,2 0.2,3.6")}
      ${strich("M61.4,25 q2,4.6 1,9.6 M65.4,24.6 q2,4.4 1.2,9.2 M68.8,27 q1.4,3.4 0.8,7", 1.6)}
      <g class="mi-cape">
        <path d="M67,19 C60,13.4 47,12.6 36,14.6 C27,16.4 19.6,22.6 16,31.4 C21.4,35.8 28.4,38.8 35.6,39.2 C43,39.6 50,36.8 55.4,31.8 C61.8,29.4 67,25 67,19 Z"
          fill="${CAPE}" stroke="${CAPE2}" stroke-width="${L}" stroke-linejoin="round"/>
        <path d="M16.6,30.8 C21.8,35 28.6,38 35.6,38.4 C42.8,38.8 49.6,36 54.8,31.4" stroke="${GOLD}" stroke-width="1.2" fill="none" opacity="0.9"/>
        <path d="M45,15.4 C38,20 33,27 31.4,37 M55,17.4 C49.6,22 46.4,28.6 45.6,36.6" stroke="${CAPE2}" stroke-width="0.8" fill="none" opacity="0.35"/>
        <path d="M37,15.8 C29,18.4 23,24.6 19.4,31" stroke="#d45a45" stroke-width="1.1" fill="none" opacity="0.5"/>
        <circle cx="66" cy="20.5" r="2.5" fill="${GOLD}" stroke="#8a6a2f" stroke-width="0.7"/>
      </g>
      <g class="mi-head" transform="rotate(-6 76 24)">
        <path d="M68.4,13 C66.2,4 67,-5.4 69.4,-9 C73.8,-4.6 77.8,1.6 79.6,8 Z" fill="${FELL}" stroke="${RAND}" stroke-width="${L}" stroke-linejoin="round"/>
        <path d="M70.2,9.6 C69,3.6 69.6,-2 70.8,-4.8 C73.6,-1.8 76,2.4 77.2,7.2 Z" fill="${OHR}"/>
        <path d="M83.6,9.6 C85.4,1.6 89,-5.2 92.4,-7.6 C93.8,-1.8 93.4,5 90.8,12.4 Z" fill="${FELL}" stroke="${RAND}" stroke-width="${L}" stroke-linejoin="round"/>
        <path d="M85.6,8.8 C87,3.2 89.4,-1.8 91.4,-3.6 C92,0.6 91.6,5.4 89.8,10.2 Z" fill="${OHR}"/>
        <path d="M66,24 C65,13.6 71.6,7 80,7 C88,7 93.4,12 94.6,18 C97.6,20.4 99,23.4 98.4,26.4 C97.4,30.6 93.6,33.6 87,34.2 C76.6,35 66.8,31.6 66,24 Z" fill="${FELL}" stroke="${RAND}" stroke-width="${L}" stroke-linejoin="round"/>
        <path d="M86,24 C88,20.6 94,20.4 97.6,23.4 C98.8,27.4 96,31.6 90.6,32.8 C86.6,33 84.6,30 86,24 Z" fill="${HELL}"/>
        <path d="M78,31.4 C82,33.8 87,34.2 91,33" stroke="${HELL}" stroke-width="2" fill="none" stroke-linecap="round"/>
        ${strich("M69,19.4 q2.2,0.6 4.2,0.2 M68.4,23.4 q2.4,0.8 4.6,0.4 M70,27.6 q2,0.6 3.8,0.2", 1.3, 0.75)}
        <g class="mi-eyes">
          <path d="M80,17.4 Q85.4,12.6 91.4,17.6 Q86.4,23.4 80,17.4 Z" fill="${AUGE}" stroke="${DUNKEL}" stroke-width="0.9"/>
          <ellipse cx="86.2" cy="18" rx="0.95" ry="3.2" fill="#10200c"/>
          <circle cx="87.6" cy="16.2" r="0.85" fill="#fff"/><circle cx="84.2" cy="19.8" r="0.4" fill="#fff" opacity="0.7"/>
          <path d="M80.8,12.8 L88.4,14.2" stroke="${DUNKEL}" stroke-width="0.7" fill="none" stroke-linecap="round" opacity="0.45"/>
        </g>
        <g class="mi-eyes-closed"><path d="M80,18 Q85.6,21.2 91.2,18" stroke="${DUNKEL}" stroke-width="1.1" fill="none" stroke-linecap="round"/></g>
        <path d="M96.8,22.8 l2.4,1.2 -2,1.6 Z" fill="${NASE}"/>
        <path d="M98.2,25.6 v1.1 M98.2,26.7 q-1.6,1.4 -3.8,0.6 q-0.8,-0.4 -1.2,-1.4" stroke="${RAND}" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="91.6" cy="26.2" r="0.35" fill="${RAND}"/><circle cx="93" cy="27.4" r="0.35" fill="${RAND}"/><circle cx="91.4" cy="28.2" r="0.35" fill="${RAND}"/>
        <path d="M90,26 q-4.4,-2.4 -9.6,-2 M90.4,27.6 q-4.6,0 -10,1.4 M90,29.2 q-4,1.8 -8.4,4.2" stroke="#fffaf0" stroke-width="0.5" fill="none" opacity="0.9" stroke-linecap="round"/>
      </g>
    </svg>`;
  }
  function fell() {
    let f = null;
    try { f = localStorage.getItem("mimi-fell"); } catch { /* egal */ }
    return MIMI_FELLE[f] ? f : "rot";
  }
  // Für die Musterseite: alle Fellfarben zeichnen können.
  window.mimiBild = (art) => catSVG(art);
  window.MIMI_FELLE = MIMI_FELLE;

  function mountToggle() {
    const btn = document.createElement("button");
    btn.id = "mimi-toggle";
    btn.style.cssText = "padding:2px 6px;font-size:15px;line-height:1;border-radius:8px;";
    btn.textContent = "🐈";
    const titel = () => { btn.style.opacity = on ? "1" : "0.45"; btn.title = on ? "Mimi läuft herum – antippen: Futter, Trinken, Spielen. Klick hier: weg" : "Mimi die Katze an/aus"; };
    titel();
    btn.addEventListener("click", () => {
      on = !on;
      localStorage.setItem(KEY, on ? "1" : "0");
      titel();
      if (on) spawn(); else despawn();
    });
    // Fellfarbe pro Gerät (jeder Spieler seine eigene Mimi).
    const wahl = document.createElement("select");
    wahl.id = "mimi-fell";
    wahl.title = "Mimis Fellfarbe";
    wahl.style.cssText = "width:auto;padding:1px 4px;font-size:12px;";
    wahl.innerHTML = Object.entries(MIMI_FELLE).map(([k, f]) => `<option value="${k}"${k === fell() ? " selected" : ""}>${f.name}</option>`).join("");
    wahl.addEventListener("change", () => {
      try { localStorage.setItem("mimi-fell", wahl.value); } catch { /* egal */ }
      if (cat) cat.innerHTML = catSVG(fell());
    });
    // In die Skin-Leiste einreihen (kein Überlappen); sonst eigener Cluster (TV).
    const host = document.getElementById("skins");
    if (host) { host.insertBefore(wahl, host.firstChild); host.insertBefore(btn, host.firstChild); }
    else {
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;top:6px;right:8px;z-index:71;display:flex;gap:6px;";
      box.appendChild(btn);
      document.body.appendChild(box);
    }
  }

  function spawn() {
    if (cat) return;
    cat = document.createElement("div");
    cat.className = "mimi";
    cat.innerHTML = catSVG(fell());
    cat.style.left = rnd(20, W() - 140) + "px";
    cat.style.top = (H() - 150) + "px";
    cat.addEventListener("click", (e) => { e.stopPropagation(); menueUmschalten(); });
    document.body.appendChild(cat);
    setState("sit");
    schedule(2500);
  }
  function despawn() {
    clearTimeout(timer);
    [...zurueck].forEach((fn) => fn());      // Verstelltes sofort zurück
    menueZu();
    if (cat) { cat.remove(); cat = null; }
    need = null; busy = false;
  }

  function setState(s) {
    if (!cat) return;
    cat.classList.remove("mi-sit", "mi-walk", "mi-sleep", "mi-happy", "mi-paw", "mi-eat");
    cat.classList.add("mi-" + s);
  }
  function faceTowards(x) {
    if (!cat) return;
    cat.classList.toggle("mi-flip-x", x < parseFloat(cat.style.left || "0") + 44);
  }

  function schedule(ms) {
    clearTimeout(timer);
    // Gemütlich: lange Pausen (Stefan: war zu viel).
    const base = ms != null ? ms : rnd(6000, 13000);
    timer = setTimeout(nextAntic, base);
  }

  function nextAntic() {
    if (!on || !cat || busy || menue) { schedule(); return; }
    const jetzt = Date.now();
    // Verstellende Streiche: selten, mit Abstand, nicht wenn Mimi zufrieden ist,
    // nicht bei Eingaben/eigenem Zug. Am Handy ohne Licht-aus/Umfärben.
    const streichErlaubt = jetzt > ruhigBis && jetzt - letzterStreich > STREICH_ABSTAND && !beschaeftigt() && Math.random() < 0.36;
    if (streichErlaubt) {
      letzterStreich = jetzt;
      const streiche = handy() ? [knopf, lichtAus, zeilenTausch, pfotenSpur] : [knopf, skinWechsel, lichtAus, zeilenTausch, pfotenSpur];
      pick(streiche)();
      return;
    }
    const bag = [
      "walk", "walk", "walk", "sit", "sit", "sit", "paw", "wolle",
      ...(jetzt > ruhigBis ? ["knock"] : []),
      ...(Math.random() < 0.2 ? ["sleep"] : []),
      ...(Math.random() < 0.08 ? ["miau"] : []),
      ...(Math.random() < 0.03 ? ["exit"] : []),
      ...(Math.random() < 0.02 && !handy() && jetzt > ruhigBis ? ["flip"] : []),
      ...(!need && Math.random() < 0.18 ? ["want"] : []),
    ];
    ({ sleep, sit, walk, paw, knock, flip, want, miau, exit: exitAndReturn, wolle }[pick(bag)] || sit)();
  }

  function sit() { setState("sit"); schedule(); }
  function sleep() {
    setState("sleep");
    say("Zzz", 4500, true);
    schedule(rnd(8000, 15000));
  }
  // Ein Sprung von der aktuellen Position nach (x,y): Bogen statt Gleiten.
  function leapTo(x, y, then, allowOffscreen) {
    if (!cat) return;
    busy = true;
    faceTowards(x);
    setState("sit");
    cat.classList.remove("mi-jump");
    void cat.offsetWidth;            // Animation sicher neu starten
    cat.classList.add("mi-jump");
    cat.style.transition = "left 0.5s ease, top 0.5s ease";
    cat.style.left = (allowOffscreen ? x : Math.max(2, Math.min(W() - 96, x))) + "px";
    cat.style.top = Math.max(50, Math.min(H() - 100, y)) + "px";
    setTimeout(() => {
      if (!cat) return;
      cat.classList.remove("mi-jump");
      cat.style.transition = "";
      then();
    }, 560);
  }
  const fertig = () => { busy = false; if (cat) setState("sit"); schedule(); };

  function walk(done) {
    const target = Math.random() < 0.5 ? rnd(10, W() * 0.4) : rnd(W() * 0.6, W() - 130);
    const hops = Math.random() < 0.5 ? 2 : 1;
    const step = (n) => {
      const fromX = parseFloat(cat.style.left) || 0;
      const nx = n >= hops ? target : fromX + (target - fromX) * 0.55;
      leapTo(nx, rnd(H() * 0.4, H() - 140), () => {
        if (n >= hops) { if (done) { busy = false; setState("sit"); done(); } else fertig(); }
        else step(n + 1);
      });
    };
    step(1);
  }

  function nearestCard() {
    const cards = [...document.querySelectorAll(".card-svg")].filter((c) => c.getBoundingClientRect().width > 0);
    if (!cards.length) return null;
    return pick(cards).closest(".card-holder") || cards[0];
  }
  function goToCard(holder, then) {
    const r = holder.getBoundingClientRect();
    leapTo(r.left - 46, r.top + r.height * 0.35, () => {
      if (!cat) return;
      cat.classList.remove("mi-flip-x");
      setState("sit");
      then(r, holder);
    });
  }
  function paw() {
    const holder = nearestCard();
    if (!holder) { walk(); return; }
    goToCard(holder, () => {
      cat.classList.add("mi-paw");
      holder.classList.add("mi-wiggle");
      setTimeout(() => holder.classList.remove("mi-wiggle"), 700);
      setTimeout(fertig, 800);
    });
  }
  function knock() {
    const holder = nearestCard();
    if (!holder) { walk(); return; }
    goToCard(holder, () => {
      cat.classList.add("mi-paw");
      say("😹", 1400);
      holder.classList.add("mi-knockoff");
      setTimeout(() => holder.classList.remove("mi-knockoff"), 1400);
      setTimeout(fertig, 1500);
    });
  }
  function flip() {
    document.documentElement.classList.add("mimi-flip");
    say("😼", 1300);
    spaeterZurueck(() => document.documentElement.classList.remove("mimi-flip"), 1300);
    schedule(rnd(12000, 20000));
  }

  // Dramatischer Auftritt: aus dem Sichtfeld springen und wieder rein.
  function exitAndReturn() {
    busy = true;
    const exitX = Math.random() < 0.5 ? -140 : W() + 40;
    leapTo(exitX, rnd(H() * 0.4, H() - 140), () => {
      if (!cat) return;
      setTimeout(() => {
        if (!cat) return;
        const enterLeft = Math.random() < 0.5;
        cat.style.transition = "none";
        cat.style.left = (enterLeft ? -120 : W() + 20) + "px";
        cat.style.top = (H() - 150) + "px";
        void cat.offsetWidth;
        const target = enterLeft ? rnd(30, W() * 0.4) : rnd(W() * 0.6, W() - 130);
        leapTo(target, rnd(H() * 0.45, H() - 140), fertig);
      }, rnd(700, 1600));
    }, true);
  }

  // --- Schabernack, der kurz etwas verstellt -------------------------------
  function beschaeftigt() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    return !!document.querySelector(".app-dialog-hg, .angriff-popup, .kontext-menue, .msg-overlay, .dl-blatt, .myturn-banner, .kampf-bau");
  }
  function sichtbar(el) {
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 12 && r.top > 60 && r.bottom < H() - 20 && r.left > 0 && r.right < W();
  }
  // Auf einen Knopf springen und ihn „drücken" - nur die Optik, kein Klick.
  function knopf() {
    const kandidaten = [...document.querySelectorAll("#app button, #skin-gear")]
      .filter((b) => sichtbar(b) && !b.disabled && !b.closest(".aktionsleiste, .kopf-menue-inhalt"));
    if (!kandidaten.length) { walk(); return; }
    const b = pick(kandidaten);
    const r = b.getBoundingClientRect();
    leapTo(r.left - 70, r.top + r.height / 2 - 60, () => {
      if (!cat) return;
      cat.classList.remove("mi-flip-x");
      cat.classList.add("mi-paw");
      b.classList.add("mi-gedrueckt");
      say(pick(["*klick*", "*drück*", "😼"]), 1100);
      spaeterZurueck(() => b.classList.remove("mi-gedrueckt"), 700);
      setTimeout(fertig, 900);
    });
  }
  // Das Design kurz umschalten - danach wieder das, was der Nutzer eingestellt hat.
  const SKINS = ["sand", "skies", "blood", "dark", "glutstein", "nebelmeer", "pergament"];
  function skinWechsel() {
    const jetzt = SKINS.find((s) => document.body.classList.contains("theme-" + s));
    if (!jetzt) { knopf(); return; }                 // TV & Co. ohne Designs
    const gear = document.getElementById("skin-gear");
    const umschalten = () => {
      const anders = pick(SKINS.filter((s) => s !== jetzt));
      document.body.classList.remove(...SKINS.map((s) => "theme-" + s));
      document.body.classList.add("theme-" + anders);
      say("😼 hihi", 1500);
      spaeterZurueck(() => {
        // Die Einstellung des Nutzers - auch falls er in der Zwischenzeit selbst umgestellt hat.
        let eigen = null;
        try { eigen = localStorage.getItem("skin"); } catch { /* egal */ }
        const ziel = SKINS.includes(eigen) ? eigen : jetzt;
        document.body.classList.remove(...SKINS.map((s) => "theme-" + s));
        document.body.classList.add("theme-" + ziel);
      }, rnd(2500, 4000));
      fertig();
    };
    if (gear && sichtbar(gear)) {
      const r = gear.getBoundingClientRect();
      leapTo(r.left - 80, r.top + 10, () => {
        if (!cat) return;
        cat.classList.add("mi-paw");
        gear.classList.add("mi-gedrueckt");
        spaeterZurueck(() => gear.classList.remove("mi-gedrueckt"), 600);
        setTimeout(umschalten, 450);
      });
    } else umschalten();
  }
  // Licht aus: alles dunkel, nur Mimis Augen leuchten.
  function lichtAus() {
    if (!cat) return;
    busy = true;
    setState("sit");
    const nacht = document.createElement("div");
    nacht.className = "mimi-nacht";
    const r = cat.getBoundingClientRect();
    const links = cat.classList.contains("mi-flip-x");
    const ax = r.left + (links ? 0.2 : 0.8) * r.width, ay = r.top + 0.47 * r.height;
    nacht.innerHTML = `<span class="mimi-auge" style="left:${ax - 7}px;top:${ay}px"></span><span class="mimi-auge" style="left:${ax + 5}px;top:${ay}px"></span>`;
    document.body.appendChild(nacht);
    say("👀", 1800);
    spaeterZurueck(() => nacht.remove(), 2600);
    setTimeout(fertig, 2700);
  }
  // Zwei Zeilen der Reihenfolge kurz vertauschen (nur Optik).
  function zeilenTausch() {
    const zeilen = [...document.querySelectorAll(".combatant")].filter(sichtbar);
    if (zeilen.length < 2) { paw(); return; }
    const i = Math.floor(rnd(0, zeilen.length - 1));
    const a = zeilen[i], b = zeilen[i + 1];
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    leapTo(ra.left - 80, ra.top, () => {
      if (!cat) return;
      cat.classList.remove("mi-flip-x");
      cat.classList.add("mi-paw");
      [a, b].forEach((z) => z.classList.add("mi-tausch"));
      a.style.transform = `translate(${rb.left - ra.left}px, ${rb.top - ra.top}px)`;
      b.style.transform = `translate(${ra.left - rb.left}px, ${ra.top - rb.top}px)`;
      say("🙀", 1400);
      spaeterZurueck(() => {
        a.style.transform = ""; b.style.transform = "";
        setTimeout(() => [a, b].forEach((z) => z.classList.remove("mi-tausch")), 400);
      }, 2200);
      setTimeout(fertig, 900);
    });
  }
  // Wollknäuel rollt über den Boden, Mimi jagt hinterher.
  function wolle(dannFroh) {
    if (!cat) return;
    const vonLinks = Math.random() < 0.5;
    const y = H() - 70;
    const k = document.createElement("div");
    k.className = "mimi-wolle";
    k.textContent = "🧶";
    k.style.left = (vonLinks ? -40 : W() + 10) + "px";
    k.style.top = y + "px";
    document.body.appendChild(k);
    void k.offsetWidth;
    k.style.left = (vonLinks ? W() + 40 : -60) + "px";
    k.style.transform = `rotate(${vonLinks ? 900 : -900}deg)`;
    spaeterZurueck(() => k.remove(), 2400);
    const ziel = vonLinks ? W() * 0.75 : W() * 0.2;
    leapTo((parseFloat(cat.style.left) + ziel) / 2, y - 60, () => leapTo(ziel, y - 60, () => {
      if (dannFroh === true) { busy = false; froh("♥"); schedule(); } else { say("🐾", 900); fertig(); }
    }));
  }
  // Pfotenabdrücke quer über den Bildschirm, die langsam verblassen.
  function pfotenSpur() {
    if (!cat) return;
    const start = parseFloat(cat.style.left) || 0;
    const ziel = start < W() / 2 ? rnd(W() * 0.55, W() - 130) : rnd(20, W() * 0.4);
    const y = rnd(H() * 0.35, H() - 140);
    const n = 9;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const p = document.createElement("div");
        p.className = "mimi-pfote";
        p.textContent = "🐾";
        p.style.left = (start + (ziel - start) * (i / n) + 40) + "px";
        p.style.top = (y + 62 + (i % 2 ? 7 : -7)) + "px";
        p.style.transform = `rotate(${ziel > start ? 90 : -90}deg)`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 3200);
      }, i * 120);
    }
    leapTo((start + ziel) / 2, y, () => leapTo(ziel, y, fertig));
  }

  // Miau-Nachricht: NUR das SL-Gerät verschickt sie (Hook prüft die Rolle).
  const CAT_PHRASES = ["Miau!", "Miauuu~", "Schnurr…", "*maunzt*", "Miau? 🐾", "*gähnt* … miau", "Miau miau!", "Fttt!"];
  function miau() {
    say("Miau!", 1400);
    if (window.mimiSend) window.mimiSend(pick(CAT_PHRASES));
    schedule();
  }
  // Ein Wunsch - nur leise angedeutet, im Menü leuchtet er dann.
  function want() {
    need = pick(["futter", "trinken", "spielen"]);
    setState("sit");
    say("miau?", 1600);
    schedule(rnd(6000, 12000));
  }

  // --- Interaktion: Antippen öffnet das Menü ---------------------------------
  const WAHL = [
    { key: "futter", icon: "🍖", text: "Futter" },
    { key: "trinken", icon: "💧", text: "Trinken" },
    { key: "spielen", icon: "🧶", text: "Spielen" },
    { key: "streicheln", icon: "✋", text: "Streicheln" },
  ];
  let menueTimer = null;
  function menueZu() {
    clearTimeout(menueTimer);
    if (menue) { menue.remove(); menue = null; }
  }
  function menueUmschalten() {
    if (!cat) return;
    if (menue) { menueZu(); return; }
    const r = cat.getBoundingClientRect();
    menue = document.createElement("div");
    menue.className = "mimi-menue";
    menue.innerHTML = WAHL.map((w) => `<button type="button" data-mimi="${w.key}" class="${need === w.key ? "wunsch" : ""}" title="${w.text}">${w.icon}</button>`).join("");
    document.body.appendChild(menue);
    const mb = menue.getBoundingClientRect();
    menue.style.left = Math.max(6, Math.min(W() - mb.width - 6, r.left + r.width / 2 - mb.width / 2)) + "px";
    menue.style.top = Math.max(6, r.top - mb.height - 6) + "px";
    menue.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mimi]");
      e.stopPropagation();
      if (b) { menueZu(); versorgen(b.dataset.mimi); }
    });
    menueTimer = setTimeout(menueZu, 6000);   // schließt von selbst - soll nicht nerven
  }
  document.addEventListener("click", (e) => { if (menue && !e.target.closest(".mimi-menue, .mimi")) menueZu(); });

  function froh(txt) {
    if (!cat) return;
    setState("sit");
    cat.classList.add("mi-happy");
    setTimeout(() => cat && cat.classList.remove("mi-happy"), 500);
    if (txt) say(txt, 1400);
  }
  function versorgen(was) {
    if (!cat || busy) return;
    clearTimeout(timer);
    const gewuenscht = need === was;
    // Zufrieden = eine Weile keine Streiche (gewünscht: länger).
    const ruhig = was === "streicheln" ? 60000 : gewuenscht ? 180000 : 90000;
    ruhigBis = Math.max(ruhigBis, Date.now() + ruhig);
    if (gewuenscht || was !== "streicheln") need = null;
    if (was === "spielen") { wolle(true); return; }
    if (was === "streicheln") {
      setState("sleep");                       // Augen zu, schnurrt
      say("schnurr… ♥", 2000, true);
      setTimeout(() => { froh(); schedule(); }, 2200);
      return;
    }
    // Futter/Trinken: Napf neben Mimi, sie frisst/trinkt, dann glücklich.
    const r = cat.getBoundingClientRect();
    const rechts = !cat.classList.contains("mi-flip-x");
    const napf = document.createElement("div");
    napf.className = "mimi-napf";
    napf.textContent = was === "futter" ? "🍖" : "💧";
    napf.style.left = (rechts ? r.right - 6 : r.left - 26) + "px";
    napf.style.top = (r.bottom - 30) + "px";
    document.body.appendChild(napf);
    busy = true;
    setState("eat");
    say(was === "futter" ? "mampf" : "schlabber", 1600);
    spaeterZurueck(() => napf.remove(), 2600);
    setTimeout(() => {
      busy = false;
      froh(gewuenscht ? "♥♥" : "♥");
      schedule();
    }, 2400);
  }

  function say(txt, ms, follow) {
    if (!cat) return;
    const s = document.createElement("div");
    s.className = "mimi-say";
    s.textContent = txt;
    document.body.appendChild(s);
    const place = () => {
      if (!cat) return;
      const r = cat.getBoundingClientRect();
      s.style.left = (r.left + r.width * 0.5) + "px";
      s.style.top = (r.top - 12) + "px";
    };
    place();
    if (follow) { const iv = setInterval(place, 200); setTimeout(() => clearInterval(iv), ms); }
    setTimeout(() => s.remove(), ms);
  }

  window.addEventListener("resize", () => {
    if (cat) cat.style.left = Math.min(parseFloat(cat.style.left), W() - 130) + "px";
  });

  // Nur zum Ausprobieren (Konsole/Musterseite): einen Streich gezielt auslösen.
  window.mimiStreich = (name) => {
    if (!cat) spawn();
    busy = false;
    ({ wolle, knopf, skin: skinWechsel, licht: lichtAus, tausch: zeilenTausch, pfoten: pfotenSpur, paw, knock, flip,
       want, menue: menueUmschalten, futter: () => versorgen("futter"), trinken: () => versorgen("trinken"),
       spielen: () => versorgen("spielen"), streicheln: () => versorgen("streicheln") }[name] || sit)();
  };

  mountToggle();
  if (on) spawn();
})();
