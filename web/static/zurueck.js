// Wege zurück am Handy (Kalle 28.11.2026, Variante Z-A: „Zurück links oben ist
// gut"). Ein Kumpel fand aus geöffneten Fenstern nicht heraus: das „Schließen"
// war klein und stand zwischen A−/A+, und die Zurück-Geste des Handys verließ
// gleich die ganze App statt nur das Fenster.
// Teil der Client-Logik, klassische <script>-Datei (Reihenfolge in index.html).
//
// Jeder Knopf, der ein Fenster/Blatt schließt, trägt ``data-zurueck``. Ist so
// ein Knopf sichtbar, legt das Handy einen Eintrag in den Browser-Verlauf;
// die Zurück-Geste nimmt diesen Eintrag weg und „drückt" den obersten
// Zurück-Knopf. Schließt man das Fenster selbst, verschwindet der Eintrag
// wieder - sonst müsste man danach zweimal zurück, um die App zu verlassen.

// Großer Knopf „‹ Zurück" für die Kopfzeile eines Fensters (links oben).
function zurueckKnopf(act) {
  return `<button type="button" class="zurueck-knopf" data-act="${act}" data-zurueck><span aria-hidden="true">‹</span> Zurück</button>`;
}

(function zurueckGeste() {
  let eintrag = false;     // liegt gerade unser Eintrag oben im Verlauf?
  let schlucken = false;   // das nächste popstate kommt von unserem history.back()
  let geplant = false;

  function oberster() {
    const alle = [...document.querySelectorAll("[data-zurueck]")].filter((e) => e.getClientRects().length);
    // Später im DOM = später geöffnet und obenauf (Rückfragen und das große
    // Foto hängen am Ende von <body>).
    return alle[alle.length - 1] || null;
  }
  function pruefen() {
    geplant = false;
    // Nur am Handy: am Laptop des SL hat „Zurück" im Browser keine Fenster
    // dieser Art, und ein fremder Verlaufseintrag würde nur stören.
    if (typeof App === "undefined" || App.role !== "player") return;
    const offen = !!oberster();
    if (offen && !eintrag) {
      try { history.pushState({ swiZurueck: true }, ""); eintrag = true; } catch { /* egal */ }
    } else if (!offen && eintrag) {
      eintrag = false;
      schlucken = true;
      history.back();
    }
  }
  // Als Microtask gleich nach dem Neuzeichnen - nicht per requestAnimationFrame:
  // das ruht in verdeckten Fenstern, und eine schnelle Zurück-Geste kam dann
  // vor dem Eintrag an und verließ die App (fiel im Browser-Test auf).
  function spaeter() {
    if (geplant) return;
    geplant = true;
    queueMicrotask(pruefen);
  }
  window.addEventListener("popstate", () => {
    if (schlucken) { schlucken = false; return; }
    if (!eintrag) return;
    eintrag = false;
    const k = oberster();
    if (k) k.click();
    // Lag darunter noch ein Fenster (z. B. Rückfrage über dem Steckbrief),
    // bekommt es gleich wieder seinen eigenen Eintrag.
    spaeter();
  });
  new MutationObserver(spaeter).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
})();
