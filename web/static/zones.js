// Kampfzonen – gemeinsamer, zustandsloser Renderer (SL, Spieler, TV).
// Konvergenz-Ansicht (senkrecht): Gegner oben, Spieler unten, ⚔️ Nahkampf als
// geteilte Mitte. `zone` 0..4 = Schritte bis Nahkampf; die Seite ergibt sich aus
// `kind`. Bewegung/Popup liegen in app.js. Global als `Zones`.
(function () {
  const FALLBACK = [
    { key: "melee", label: "Nahkampf", emoji: "⚔️" },
    { key: "near", label: "Nahbereich", emoji: "👣" },
    { key: "far", label: "Fernbereich", emoji: "🏹" },
    { key: "distant", label: "Weitbereich", emoji: "🎯" },
    { key: "out", label: "Außer Reichweite", emoji: "🚫" },
  ];
  // Bänder oben -> unten: Gegner 4..1, Nahkampf 0 (geteilt), Spieler 1..4.
  const BANDS = [
    { z: 4, side: "npc" }, { z: 3, side: "npc" }, { z: 2, side: "npc" }, { z: 1, side: "npc" },
    { z: 0, side: "melee" },
    { z: 1, side: "player" }, { z: 2, side: "player" }, { z: 3, side: "player" }, { z: 4, side: "player" },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function initials(name) {
    const p = String(name || "?").trim().split(/\s+/);
    return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
  }
  function zoneOf(c) {
    const z = c && c.zone;
    return (typeof z === "number" && z >= 0 && z <= 4) ? z : 1;
  }
  // Feind = gegnerischer NPC. Verbündete NPCs (ally) zählen zur Spielerseite.
  function isEnemy(c) { return c.kind === "npc" && !c.ally; }

  function tokenChip(c, activeId) {
    const cls = ["zone-token",
      isEnemy(c) ? "enemy" : "player",
      c.ally ? "ally" : "",
      c.isWildCard ? "wc" : "",
      c.id === activeId ? "active" : "",
      (c.status && c.status.out) ? "out" : "",
      c.ran ? "ran" : ""].filter(Boolean).join(" ");
    const inner = c.image
      ? `<img src="${esc(c.image)}" alt="">`
      : `<span class="tinit">${esc(initials(c.name))}</span>`;
    return `<button type="button" class="${cls}" data-act="token-info" data-id="${esc(c.id)}" title="${esc(c.name)}">` +
      `<span class="tdisc">${inner}</span><span class="tname">${esc(c.name)}</span></button>`;
  }

  // combatants: Array; opts: { zones, activeId, interactive, mover:{id,zone,canMove} }
  function renderTarget(combatants, opts) {
    opts = opts || {};
    const zones = (opts.zones && opts.zones.length === 5) ? opts.zones : FALLBACK;
    const activeId = opts.activeId || null;
    const mover = opts.mover || null;
    const pending = opts.pending || null;   // {id, tz} – Bahn wartet auf Bestätigung
    // Pausierte (benched) Figuren nehmen nicht am Kampf teil -> nicht auf der Karte.
    const list = (combatants || []).filter((c) => !c.benched);

    const rows = BANDS.map((b) => {
      let members;
      if (b.side === "melee") members = list.filter((c) => zoneOf(c) === 0);
      else if (b.side === "npc") members = list.filter((c) => isEnemy(c) && zoneOf(c) === b.z);
      else members = list.filter((c) => !isEnemy(c) && zoneOf(c) === b.z);

      const z = zones[b.z];
      const chips = members.map((c) => tokenChip(c, activeId)).join("");

      // Erreichbar per Tipp? Spieler bewegt sich auf seiner Seite / in die Mitte,
      // 1 Schritt gratis, 2 Schritte = Rennen. Nur wenn Budget frei.
      let reachCls = "", goAttr = "", hint = "";
      if (mover && mover.canMove && (b.side === "melee" || b.side === "player")) {
        const steps = Math.abs(b.z - mover.zone);
        if (steps === 1 || steps === 2) {
          const confirming = pending && pending.id === mover.id && pending.tz === b.z;
          reachCls = " reachable" + (steps === 2 ? " run" : "") + (confirming ? " confirming" : "");
          goAttr = ` data-act="zone-goto" data-id="${esc(mover.id)}" data-tz="${b.z}"`;
          hint = confirming
            ? `<span class="zb-hint">✓ ${steps === 2 ? "Rennen – " : ""}nochmal tippen</span>`
            : `<span class="zb-hint">${steps === 2 ? "🏃 Rennen" : "→ hierher"}</span>`;
        }
      }
      const empty = members.length ? "" : " empty";
      const cls = "zone-band band-" + b.side + empty + reachCls;
      return `<div class="${cls}"${goAttr}>` +
        `<div class="zb-label"><span class="zb-emoji">${z.emoji}</span>` +
        `<span class="zb-name">${esc(z.label)}</span>${hint}</div>` +
        `<div class="zb-tokens">${chips}</div></div>`;
    }).join("");

    return `<div class="zones-target zones-conv"${opts.interactive ? "" : ' data-readonly="1"'}>${rows}</div>`;
  }

  window.Zones = { LABELS: FALLBACK, renderTarget, zoneOf };
})();
