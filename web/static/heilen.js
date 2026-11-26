"use strict";
// 🩹 Heilen-Runde nach dem Kampf (Kalle, 25.11.2026, Variante A gewählt).
// Der SL startet sie statt „Alle heilen"; im Kampf-Panel steht dann je
// verletztem Spieler eine Karte: K.O.-Probe (Konstitution) → Verletzung,
// „Wer heilt?" → Ergebnis, später 🌙 5 Tage Rast. Gewürfelt wird am Tisch,
// der SL tippt nur das Ergebnis - außer der Verletzungstabelle, die würfelt
// die App. Die Karten bleiben in fester Reihenfolge stehen, auch wenn jemand
// heil ist (nur blasser) - sonst rutschte die nächste Karte unter die Maus.
// Server: _do_heilrunde_* / _do_heil_* in game.py.

// Gewählter Heiler je Patient (nur am Laptop, bis „Fertig").
App.heilerWahl = App.heilerWahl || {};

const VERL_DAUER = { immer: "bleibt für immer", wunden: "bis alle Wunden heil", "24h": "24 Stunden" };

function heilPips(st) {
  const w = st.wounds || 0;
  return `<span class="hr-pips" title="${w} Wunde${w === 1 ? "" : "n"}">${[0, 1, 2].map((i) => `<b class="${i < w ? "v" : ""}"></b>`).join("")}</span>`;
}

// Selbst eingetragen (Kalle, 26.11.2026: „Verletzungen sind nur Vorschläge"):
// nur der Text, keine Folge aus der Tabelle.
const verlText = (v) => v.folge ? `${v.ort} · ${v.folge}` : v.ort;

function verletzungChip(c, v, weg) {
  return `<span class="hr-chip verl" title="${esc(VERL_DAUER[v.dauer] || "")}">🦴 ${esc(verlText(v))}${
    weg ? ` <button type="button" class="hr-x" data-act="verletzung-weg" data-id="${c.id}" data-vid="${esc(v.id)}" title="Verletzung wegnehmen">✕</button>` : ""}</span>`;
}

function heilKarteHtml(c, e, hr) {
  const st = c.status || {};
  const ko = !!st.out;
  const heil = !ko && !(st.wounds || 0);
  const abzug = Math.min(3, st.wounds || 0);
  const knopf = (act, erg, text, kl = "") =>
    `<button type="button" class="${kl}" data-act="${act}" data-id="${c.id}" data-erg="${erg}">${text}</button>`;
  const zeilen = [];
  // 1) K.O.-Probe + Verletzung (nur wer außer Gefecht war)
  // Auch wer schon wieder wach ist, schuldet die Probe (e.warKo) - sonst fiel
  // der Verletzungswurf weg, sobald zuerst geheilt wurde.
  if (e.ko === null && (ko || e.warKo)) {
    zeilen.push(`<div class="hr-schritt"><span class="hr-was">Konstitution${abzug ? ` <small>−${abzug}</small>` : ""}</span>
      <span class="hr-erg">${knopf("heil-ko", "patzer", "☠ Patzer", "patzer")}${knopf("heil-ko", "nein", "Nicht geschafft")}${
        knopf("heil-ko", "ja", "Geschafft", "gut")}${knopf("heil-ko", "steig", "Steigerung", "top")}</span></div>`);
  } else if (e.ko === "patzer") {
    zeilen.push(`<div class="hr-schritt"><span class="hr-chip tot">☠ Patzer bei der Konstitution</span></div>`);
  } else if (e.ko && !e.verl) {
    zeilen.push(`<div class="hr-schritt"><span class="hr-was">Verletzung</span>
      <button type="button" class="primary small" data-act="heil-verletzung" data-id="${c.id}">🎲 Würfeln</button>
      <button type="button" class="ghost small" data-act="heil-verletzung-selbst" data-id="${c.id}">✎ Selbst eintragen</button></div>`);
  } else if (e.verletzung) {
    const v = e.verletzung;
    zeilen.push(`<div class="hr-schritt">${v.wurf ? `<span class="hr-wurf" title="2W6${v.zusatz ? " + W6" : ""}">🎲 ${v.wurf.join(" + ")}${v.zusatz ? ` · ${v.zusatz}` : ""}</span>` : ""}
      <span class="hr-chip verl">🦴 ${esc(verlText(v))}</span><span class="hr-grau">${esc(VERL_DAUER[v.dauer])}</span>
      <button type="button" class="ghost small" data-act="verletzung-text" data-id="${c.id}" data-vid="${esc(v.id)}" title="Verletzung ändern">✎</button></div>`);
  }
  if (e.blutet) zeilen.push(`<div class="hr-schritt"><span class="hr-chip tot">🩸 Verblutet – Heilen hält es auf</span></div>`);
  // 2) Heilen in der Goldenen Stunde
  if (hr.goldene && !heil && e.ko !== "patzer") {
    const heiler = App.state.combatants.filter((x) => x.kind === "player" && !x.benched && x.id !== c.id);
    const frei = heiler.filter((x) => !(x.status || {}).out && !e.heiler.includes(x.id));
    let wahl = App.heilerWahl[c.id];
    if (!frei.some((x) => x.id === wahl)) wahl = (frei[0] || {}).id;
    const gewaehlt = heiler.find((x) => x.id === wahl);
    zeilen.push(`<div class="hr-schritt"><span class="hr-was">Wer heilt?</span>${heiler.map((x) => {
      const benutzt = e.heiler.includes(x.id);
      const kann = !benutzt && !(x.status || {}).out;
      return `<button type="button" class="hr-chip heiler${x.id === wahl ? " an" : ""}${benutzt ? " weg" : ""}" ${kann ? "" : "disabled"}
        data-act="heiler-wahl" data-id="${c.id}" data-heiler="${x.id}">${x.id === wahl ? "🩹 " : ""}${esc(x.name)}</button>`;
    }).join("")}</div>`);
    if (gewaehlt) {
      const hk = (erg, text, kl = "") => `<button type="button" class="${kl}" data-act="heil-wurf" data-id="${c.id}" data-heiler="${gewaehlt.id}" data-erg="${erg}">${text}</button>`;
      zeilen.push(`<div class="hr-schritt"><span class="hr-was">Heilen <small>${esc(gewaehlt.name)}</small></span><span class="hr-erg">${
        hk("nein", "Nicht geschafft")}${ko ? hk("1", "Wieder wach", "top") : `${hk("1", "−1 Wunde", "gut")}${hk("2", "−2 Wunden", "top")}`}</span></div>`);
    }
  }
  // 3) 🌙 Rast (natürliche Heilung) - erst nach „5 Tage Rast"
  if (hr.rast && e.ko !== "patzer" && !heil) {
    if (!e.rastErg) {
      zeilen.push(`<div class="hr-schritt"><span class="hr-was">🌙 Konstitution${abzug ? ` <small>−${abzug}</small>` : ""}</span>
        <span class="hr-erg">${knopf("heil-rast-wurf", "patzer", "Patzer", "patzer")}${knopf("heil-rast-wurf", "nein", "Nicht geschafft")}${
          knopf("heil-rast-wurf", "1", ko ? "Wieder wach" : "−1 Wunde", "gut")}${knopf("heil-rast-wurf", "2", ko ? "Wach −1 Wunde" : "−2 Wunden", "top")}</span></div>`);
    }
  }
  // Was zuletzt geschah, rechts in der Namenszeile (macht die Karte nicht
  // höher); bei Geheilten als grüne Marke statt leerer Karte.
  const letzte = (e.log || []).slice(-1)[0];
  if (letzte && heil) {
    zeilen.push(`<div class="hr-schritt"><span class="hr-chip ok">${esc(letzte)} · keine Wunden</span></div>`);
  }
  const andere = (c.verletzungen || []).filter((v) => !e.verletzung || v.id !== e.verletzung.id);
  if (andere.length) zeilen.push(`<div class="hr-schritt">${andere.map((v) => verletzungChip(c, v, false)).join("")}</div>`);
  return `<div class="hr-karte${ko ? " ko" : ""}${heil ? " fertig" : ""}" data-hr="${c.id}">
    <div class="hr-name">${c.image ? `<img class="hr-bild" src="${esc(c.image)}" alt="">` : `<span class="hr-bild">${esc(zoneInitials(c.name))}</span>`}
      ${esc(c.name)} ${heilPips(st)}${ko ? ` <span class="hr-ko">💀 außer Gefecht</span>` : ""}
      ${letzte && !heil ? `<span class="hr-spacer"></span><span class="hr-grau">${esc(letzte)}</span>` : ""}</div>
    ${zeilen.join("")}
  </div>`;
}

function heilrundeHtml() {
  const s = App.state;
  const hr = s.heilrunde;
  const karten = (hr.ids || []).map((id) => {
    const c = findCombatant(id);
    const e = (hr.e || {})[id];
    return c && e ? heilKarteHtml(c, e, hr) : "";
  }).join("");
  return `<div class="hr">
    <div class="hr-kopf"><span class="hr-titel">🩹 Heilen-Runde</span>
      ${/* „Tag 5" steht IM selben Knopf statt daneben: ein eigenes Feld
            schob „Fertig" in eine zweite Zeile. */ ""}
      <button type="button" class="hr-uhr${hr.goldene ? "" : " aus"}" data-act="heil-goldene" title="${hr.goldene ? "Goldene Stunde beenden" : "Goldene Stunde wieder an"}">${
        hr.goldene ? "⏳ Goldene Stunde" : hr.rast ? `🌙 Tag ${hr.rast * 5}` : "⏳ Stunde vorbei"}</button>
      <span class="hr-spacer"></span>
      <button type="button" class="ghost small" data-act="undo" ${s.canUndo ? "" : "disabled"} title="Letzte Aktion rückgängig">↶ Zurück</button>
      <button type="button" class="ghost small" data-act="heil-rast">🌙 5 Tage Rast</button>
      <button type="button" class="primary small" data-act="heilrunde-ende">✓ Fertig</button></div>
    ${karten}
  </div>`;
}

// Klicks der Heilen-Runde (in ereignisse.js eingehängt).
function heilKlick(act, t) {
  const id = t.getAttribute("data-id");
  const erg = t.getAttribute("data-erg");
  switch (act) {
    case "heilrunde-start": gmAction({ type: "heilrunde_start" }); return true;
    case "heilrunde-ende": App.heilerWahl = {}; gmAction({ type: "heilrunde_ende" }); return true;
    case "heil-goldene": gmAction({ type: "heilrunde_goldene" }); return true;
    case "heil-rast": gmAction({ type: "heil_rast" }); return true;
    case "heil-ko": gmAction({ type: "heil_ko", id, erg }); return true;
    case "heil-verletzung": gmAction({ type: "heil_verletzung", id }); return true;
    case "heil-wurf": gmAction({ type: "heil_wurf", id, heiler: t.getAttribute("data-heiler"), erg }); return true;
    case "heil-rast-wurf": gmAction({ type: "heil_rast_wurf", id, erg }); return true;
    case "heiler-wahl": App.heilerWahl[id] = t.getAttribute("data-heiler"); render(); return true;
    case "verletzung-weg": gmAction({ type: "verletzung_weg", id, vid: t.getAttribute("data-vid") }); return true;
    case "heil-verletzung-selbst":
      eingabe("Welche Verletzung?", "", "Eintragen").then((text) => { if (text) gmAction({ type: "heil_verletzung", id, text }); });
      return true;
    case "verletzung-text": {
      const c = findCombatant(id);
      const v = ((c && c.verletzungen) || []).find((x) => x.id === t.getAttribute("data-vid"));
      eingabe("Verletzung ändern:", v ? verlText(v) : "", "Ändern").then((text) => {
        if (text) gmAction({ type: "verletzung_text", id, vid: t.getAttribute("data-vid"), text });
      });
      return true;
    }
    default: return false;
  }
}

// Verletzungs-Marken am Handy (unter dem Wund-Abzug) und in der SL-Zeile.
function verletzungenHandyHtml(c) {
  const l = (c && c.verletzungen) || [];
  return l.length ? `<div class="hr-marken">${l.map((v) => verletzungChip(c, v, false)).join("")}</div>` : "";
}
function verletzungTags(c) {
  return ((c && c.verletzungen) || []).map((v) =>
    `<span class="tag verl-tag" title="${esc(verlText(v))} · ${esc(VERL_DAUER[v.dauer] || "")}">🦴 ${esc(v.ort)}</span>`).join("");
}
