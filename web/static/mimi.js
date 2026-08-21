// Mimi die Katze – ein rein optisches, lokales Gimmick (pro Gerät an/aus).
// EIN Schalter: ist sie an, rennt sie herum und treibt Schabernack (pfotelt an
// Karten, schmeißt mal eine runter, dreht kurz den Bildschirm, springt mit Cape
// rein und raus). Bedürfnisse erscheinen NICHT über dem Kopf – erst beim
// Anklicken zeigt sie, was sie will, ein weiterer Klick erfüllt es.

(function () {
  const KEY = "mimi-on";
  let on = localStorage.getItem(KEY) === "1";
  let cat = null;
  let timer = null;
  let need = null;          // "food" | "water" | "play" | null
  let needShown = false;    // wurde das Bedürfnis schon (per Klick) aufgedeckt?
  let busy = false;
  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Gefleckter Serval mit grünen Augen, Luchs-Ohren und rotem Schal.
  // Seitenansicht, blickt nach rechts. Handgezeichnet – Vibe des Referenzbilds.
  function catSVG() {
    const FUR = "#e9a84e", FUR2 = "#e0942f", EDGE = "#9c6118", SPOT = "#33240f",
      TIP = "#20160c", EYE = "#6ff05c", SCARF = "#a83223", SCARF2 = "#7c2016";
    const CAPE = "#a12822", CAPE2 = "#5c130f", CAPEHI = "#d1503a";   // zerfetzter roter Umhang (Referenzbild)
    const sp = (x, y, r) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.78}" fill="${SPOT}"/>`;
    return `<svg viewBox="0 -24 106 94" xmlns="http://www.w3.org/2000/svg">
      <g class="mi-tail">
        <path d="M24,32 q-13,-10 -9,-31 q1,-17 16,-19 q-10,9 -5,21 q5,11 -6,15 q12,3 4,20 Z" fill="${FUR}" stroke="${EDGE}" stroke-width="2"/>
        <path d="M17,-9 q-1,-6 6,-9 M14,1 q-2,-6 5,-10 M15,12 q-1,-5 6,-8" stroke="${TIP}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      </g>
      <g class="mi-legs">
        <rect class="mi-leg mi-leg-b1" x="24" y="42" width="7" height="17" rx="3.5" fill="${FUR2}" stroke="${EDGE}" stroke-width="1.5"/>
        <rect class="mi-leg mi-leg-b2" x="34" y="42" width="7" height="17" rx="3.5" fill="${FUR}" stroke="${EDGE}" stroke-width="1.5"/>
        <rect class="mi-leg mi-leg-f1" x="58" y="42" width="7" height="17" rx="3.5" fill="${FUR2}" stroke="${EDGE}" stroke-width="1.5"/>
        <rect class="mi-leg mi-leg-f2" x="67" y="42" width="7" height="17" rx="3.5" fill="${FUR}" stroke="${EDGE}" stroke-width="1.5"/>
      </g>
      <ellipse cx="46" cy="33" rx="32" ry="15.5" fill="${FUR}" stroke="${EDGE}" stroke-width="2"/>
      ${sp(50, 41, 2.7)}${sp(59, 37, 2.5)}${sp(64, 43, 2.2)}${sp(42, 39, 2.3)}${sp(36, 43, 2)}${sp(54, 45, 1.9)}
      <g class="mi-cape">
        <path d="M64,21 Q54,9 39,11 Q24,13 17,23 Q9,33 4,48 L8,41 L11,49 L16,41 L21,48 L26,40 L32,47 L38,39 L44,46 L50,38 L56,42 Q64,33 64,21 Z" fill="${CAPE}" stroke="${CAPE2}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M39,13 Q23,18 9,43" stroke="${CAPEHI}" stroke-width="1.6" fill="none" opacity="0.5"/>
        <path d="M55,24 q-7,5 -16,5" stroke="${CAPE2}" stroke-width="1.3" fill="none" opacity="0.6"/>
      </g>
      <g class="mi-head">
        <path d="M66,14 l-3,-14 12,7 Z" fill="${FUR}" stroke="${EDGE}" stroke-width="2"/>
        <path d="M63,0 l3,7" stroke="${TIP}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <path d="M60,-3 l3,4 M62,-4 l3,4" stroke="${TIP}" stroke-width="1.2"/>
        <path d="M86,14 l5,-14 -12,7 Z" fill="${FUR}" stroke="${EDGE}" stroke-width="2"/>
        <path d="M90,0 l-3,7" stroke="${TIP}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="78" cy="24" r="14" fill="#efb662" stroke="${EDGE}" stroke-width="2"/>
        ${sp(72, 18, 1.9)}${sp(84, 18, 1.9)}${sp(78, 14, 1.7)}${sp(70, 28, 1.7)}
        <g class="mi-eyes">
          <ellipse cx="82" cy="23" rx="4.3" ry="5.3" fill="${EYE}"/>
          <rect x="81" y="18.5" width="2" height="9" rx="1" fill="#16240f"/>
        </g>
        <g class="mi-eyes-closed"><path d="M78,23 q4,3 8,0" stroke="#2b2016" stroke-width="2" fill="none" stroke-linecap="round"/></g>
        <path d="M90,26 l5,2 -5,2 Z" fill="#c05a3a"/>
        <path d="M91,23 h7 M91,28 h7" stroke="#efe0c2" stroke-width="1" opacity="0.85"/>
      </g>
    </svg>`;
  }

  function mountToggle() {
    const mk = (id, title) => {
      const b = document.createElement("button");
      b.id = id; b.title = title;
      b.style.cssText = "padding:2px 6px;font-size:15px;line-height:1;border-radius:8px;";
      return b;
    };
    const btn = mk("mimi-toggle", "Mimi die Katze an/aus");
    btn.textContent = "🐈";
    btn.style.opacity = on ? "1" : "0.45";
    btn.addEventListener("click", () => {
      on = !on;
      localStorage.setItem(KEY, on ? "1" : "0");
      btn.style.opacity = on ? "1" : "0.45";
      btn.title = on ? "Mimi läuft herum – Klick: weg" : "Mimi die Katze an/aus";
      if (on) spawn(); else despawn();
    });

    // In die Skin-Leiste einreihen (kein Überlappen); sonst eigener Cluster (TV).
    const host = document.getElementById("skins");
    if (host) {
      host.insertBefore(btn, host.firstChild);
    } else {
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
    cat.innerHTML = catSVG();
    cat.style.left = rnd(20, W() - 140) + "px";
    cat.style.top = (H() - 150) + "px";
    cat.addEventListener("click", onClick);
    document.body.appendChild(cat);
    setState("sit");
    schedule(1800);
  }
  function despawn() {
    clearTimeout(timer);
    if (cat) { cat.remove(); cat = null; }
    need = null; needShown = false; busy = false;
  }

  function setState(s) {
    if (!cat) return;
    cat.classList.remove("mi-sit", "mi-walk", "mi-sleep", "mi-happy", "mi-paw");
    cat.classList.add("mi-" + s);
  }
  function faceTowards(x) {
    if (!cat) return;
    cat.classList.toggle("mi-flip-x", x < parseFloat(cat.style.left || "0") + 44);
  }

  function schedule(ms) {
    clearTimeout(timer);
    const base = ms != null ? ms : rnd(5500, 12000);   // gemütlich – längere Pausen
    timer = setTimeout(nextAntic, base);
  }

  function nextAntic() {
    if (!on || !cat || busy) { schedule(); return; }
    // Gemütlich: streift mal umher, döst gern, ein bisschen Schabernack – aber
    // ruhig. Aus dem Bild springen und Bildschirm-Dreher nur ganz selten.
    const frisky = need ? 2 : 1;
    const bag = [
      "walk", "walk", "walk",
      "sit", "sit", "sit",
      "paw", "knock",
      ...(Math.random() < 0.16 ? ["sleep"] : []),
      ...(Math.random() < 0.14 ? ["miau"] : []),
      ...(Math.random() < 0.04 ? ["exit"] : []),           // selten aus dem Bild springen
      ...(Math.random() < 0.05 * frisky ? ["flip"] : []),  // selten der Bildschirm-Dreher
      ...(!need && Math.random() < 0.3 ? ["want"] : []),
    ];
    ({ sleep, sit, walk, paw, knock, flip, want, miau, exit: exitAndReturn }[pick(bag)] || sit)();
  }

  function sit() { setState("sit"); schedule(); }
  function sleep() {
    setState("sleep");
    say("Zzz", 4500, true);
    schedule(rnd(6000, 12000));   // nur ein kurzes Nickerchen – dann wieder los
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
    cat.style.top = y + "px";
    setTimeout(() => {
      if (!cat) return;
      cat.classList.remove("mi-jump");
      cat.style.transition = "";
      then();
    }, 560);
  }

  function walk(done) {
    // Flink in 1–2 Sätzen von A nach B hüpfen.
    const target = Math.random() < 0.5 ? rnd(10, W() * 0.4) : rnd(W() * 0.6, W() - 130);
    const hops = Math.random() < 0.5 ? 2 : 1;
    const step = (n) => {
      const fromX = parseFloat(cat.style.left) || 0;
      const nx = n >= hops ? target : fromX + (target - fromX) * 0.55;
      leapTo(nx, rnd(H() * 0.4, H() - 140), () => {
        if (n >= hops) { busy = false; setState("sit"); if (done) done(); else schedule(); }
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
      cat.classList.remove("mi-flip-x"); // schaut zur Karte (nach rechts)
      setState("sit");
      then(r, holder);
    });
  }
  function paw() {
    const holder = nearestCard();
    if (!holder) { walk(); return; }   // keine Karten da -> lieber weiterrennen
    goToCard(holder, () => {
      cat.classList.add("mi-paw");
      holder.classList.add("mi-wiggle");
      setTimeout(() => holder.classList.remove("mi-wiggle"), 700);
      setTimeout(() => { if (cat) cat.classList.remove("mi-paw"); busy = false; schedule(); }, 800);
    });
  }
  function knock() {
    const holder = nearestCard();
    if (!holder) { walk(); return; }   // keine Karten da -> lieber weiterrennen
    goToCard(holder, () => {
      cat.classList.add("mi-paw");
      say("😹", 1400);
      holder.classList.add("mi-knockoff");
      setTimeout(() => holder.classList.remove("mi-knockoff"), 1400);
      setTimeout(() => { if (cat) cat.classList.remove("mi-paw"); busy = false; schedule(); }, 1500);
    });
  }
  function flip() {
    document.documentElement.classList.add("mimi-flip");
    say("😼", 1300);
    setTimeout(() => document.documentElement.classList.remove("mimi-flip"), 1300);
    schedule(rnd(10000, 20000));
  }

  // Dramatischer Auftritt: mit Cape aus dem Sichtfeld springen und wieder rein.
  function exitAndReturn() {
    busy = true;
    cat.classList.add("mi-caped");
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
        leapTo(target, rnd(H() * 0.45, H() - 140), () => {
          if (cat) cat.classList.remove("mi-caped");   // gelandet -> Cape ab
          busy = false; setState("sit"); schedule();
        });
      }, rnd(700, 1600));
    }, true);
  }

  // Miau-Nachricht: NUR das SL-Gerät verschickt sie (Hook prüft die Rolle).
  const CAT_PHRASES = ["Miau!", "Miauuu~", "Schnurr…", "*maunzt*", "Miau? 🐾", "*gähnt* … miau", "Miau miau!", "Fttt!"];
  function miau() {
    say("Miau!", 1400);
    if (window.mimiSend) window.mimiSend(pick(CAT_PHRASES));
    schedule();
  }
  function want() {
    need = pick(["food", "water", "play"]);
    needShown = false;
    setState("sit");
    say("miau?", 1600);           // leiser Hinweis, KEIN Dauer-Icon
    schedule(rnd(4000, 9000));
  }

  // --- Klick-Interaktion: erst zeigen, was sie will, dann erfüllen ----------
  const NEED_ICON = { food: "🍖", water: "💧", play: "🧶" };
  function onClick() {
    if (!cat) return;
    if (need && !needShown) {
      needShown = true;
      say(NEED_ICON[need], 1800);           // Icon erscheint erst jetzt, beim Klick
      return;
    }
    if (need && needShown) {                 // zweiter Klick = geben
      say(NEED_ICON[need] + "♥", 1400);
      need = null; needShown = false;
      happy();
      return;
    }
    happy();                                 // ohne Bedürfnis: einfach streicheln
    say("♥", 1200);
  }
  function happy() {
    if (!cat) return;
    setState("sit");
    cat.classList.add("mi-happy");
    setTimeout(() => cat && cat.classList.remove("mi-happy"), 500);
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

  mountToggle();
  if (on) spawn();
})();
