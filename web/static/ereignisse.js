// Ereignisse: ein Klick-/Tasten-Handler für alles (Delegation per
// data-Attribut), weil die Ansicht ständig neu gezeichnet wird.
// Teil der Client-Logik (früher alles in app.js, aufgeteilt 01.10.2026).
// Klassische <script>-Dateien mit gemeinsamem globalem Bereich: Reihenfolge in
// index.html zählt (app.js zuerst, start.js zuletzt) – Code, der beim LADEN
// läuft, darf nur auf Dinge aus früheren Dateien zugreifen.

// --- Ereignisse (Delegation) ------------------------------------------------

document.addEventListener("click", (e) => {
  // Klick auf den abgedunkelten Hintergrund des Token-Popups schließt es.
  if (App.tokenPopupId && e.target.classList && e.target.classList.contains("token-popup")) {
    App.tokenPopupId = null; render(); return;
  }
  const target = e.target.closest("[data-act]");
  if (!target) return;
  // Daumen-Knopf gerade gewechselt? Dann galt der Tipp noch dem alten Knopf
  // (Doppeltipp, weil der erste scheinbar nicht ankam) - nicht auslösen.
  if (target.closest(".daumen-leiste .dl-haupt, .daumen-leiste .dl-neben") && Date.now() - (App._daumenSeit || 0) < 700) {
    e.preventDefault(); return;
  }
  const act = target.getAttribute("data-act");
  const id = target.getAttribute("data-id");
  const S = App.state;

  const handlers = {
    // SL – Kampf
    "new-round": () => gmAction({ type: "new_round" }),
    "alle-wieder-rein": () => gmAction({ type: "unbench_all" }),
    "clear-all": async () => {
      if (await frage("Kampf abräumen?\n\nAlle Gegner und Verbündeten werden entfernt, die Spieler pausiert (sie bleiben verbunden und behalten ihren Charakter). Die Zonen sind danach leer.\n\nRückgängig geht mit ↶.", "Abräumen", true)) gmAction({ type: "clear_all" });
    },
    "reset": async () => { if (await frage("Initiative komplett zurücksetzen?", "Zurücksetzen", true)) gmAction({ type: "reset" }); },
    "release": () => gmAction({ type: "release" }),
    "confirm-turn": () => gmActionOrPlayer({ type: "confirm_turn" }),
    "skip-turn": () => gmAction({ type: "confirm_turn" }),   // ohne Timer zum nächsten
    "redraw": () => gmAction({ type: "redraw", id }),
    "set-active": () => gmAction({ type: "set_active", id }),
    "edit-combatant": () => { App.editCombatantId = App.editCombatantId === id ? null : id; render(); },
    "save-combatant": () => saveCombatant(id),
    "cancel-edit-combatant": () => { App.editCombatantId = null; render(); },
    "bild-entfernen": async () => {
      if (await frage("Porträt dieser Figur entfernen?", "Entfernen", true)) gmAction({ type: "set_image", id, url: null });
    },
    "bench": () => gmAction({ type: "bench", id, on: target.getAttribute("data-on") === "1" }),
    "remove-combatant": async () => {
      const c = findCombatant(id);
      const msg = c && c.playerId ? `Spieler "${c.name}" endgültig entfernen (Kick)?` : `${c ? c.name : "Teilnehmer"} entfernen?`;
      if (await frage(msg, "Entfernen", true)) gmAction({ type: "remove_combatant", id });
    },
    "resume": () => gmAction({ type: "resume_session" }),
    "discard-session": () => gmAction({ type: "discard_session" }),
    // SL – Charakterliste
    "new-char": () => renderCharForm(null),
    "roster-to-combat": () => {
      const z = parseInt(($("rosterzone") || {}).value, 10);
      gmAction({ type: "add_from_roster", id, zone: isNaN(z) ? undefined : z });
    },
    "edit-char": () => renderCharForm(S.roster.find((r) => r.id === id)),
    "cancel-char": () => { const h = $("charform"); if (h) h.innerHTML = ""; },
    "save-char": saveChar,
    "delete-char": async () => { if (await frage("Charakter löschen?", "Löschen", true)) gmAction({ type: "roster_delete", id }); },
    // SL – Gegner-Bibliothek
    "bestiary-new": () => renderBestiaryForm(null),
    "bestiary-edit": () => renderBestiaryForm((S.bestiary || []).find((r) => r.id === id)),
    "bestiary-save": saveBestiary,
    "bestiary-cancel": () => { const h = $("bestiaryform"); if (h) h.innerHTML = ""; },
    "bestiary-delete": async () => { if (await frage("Gegner-Typ löschen?", "Löschen", true)) gmAction({ type: "bestiary_delete", id }); },
    "bestiary-to-combat": () => {
      const z = parseInt(($("bestzone") || {}).value, 10);
      const anzahl = parseInt(($("bestcount") || {}).value, 10);
      gmAction({
        type: "add_npc_from_bestiary", id,
        zone: isNaN(z) ? undefined : z,
        count: isNaN(anzahl) ? 1 : anzahl,
        anon: !!($("bestanon") || {}).checked,
      });
    },
    "set-anon": () => gmAction({ type: "set_anon", id, on: target.getAttribute("data-on") === "1" }),
    "bilder-aufraeumen": () => bilderAufraeumen(),
    // SL – Gruppen
    "group-new": async () => {
      const name = await eingabe("Name der Gruppe? (z. B. Ork-Trupp)", "", "Anlegen");
      if (name && name.trim()) gmAction({ type: "group_create", name: name.trim() });
    },
    "group-rename": async () => {
      const g = (App.state.groups || []).find((x) => x.id === target.dataset.group);
      const name = await eingabe("Gruppe umbenennen:", g ? g.name : "", "Umbenennen");
      if (name && name.trim()) gmAction({ type: "group_rename", group: target.dataset.group, name: name.trim() });
    },
    "group-delete": async () => {
      if (await frage("Gruppe auflösen? Die Figuren bleiben im Kampf.", "Auflösen")) {
        gmAction({ type: "group_delete", group: target.dataset.group });
      }
    },
    // SL – Verbündeten-Bibliothek
    "ally-new": () => renderAllyForm(null),
    "ally-edit": () => renderAllyForm((S.allies || []).find((r) => r.id === id)),
    "ally-save": saveAlly,
    "ally-cancel": () => { const h = $("allyform"); if (h) h.innerHTML = ""; },
    "ally-delete": async () => { if (await frage("Verbündeten-Typ löschen?", "Löschen", true)) gmAction({ type: "ally_delete", id }); },
    // SL – Begegnungen (gespeicherte Gruppen)
    "encounter-save": async () => {
      const name = await eingabe("Name des Kampfes? (z. B. Skree-Überfall)", "", "Speichern");
      if (name && name.trim()) gmAction({ type: "save_encounter", name: name.trim() });
    },
    "encounter-to-combat": () => gmAction({ type: "add_encounter", id }),
    "encounter-copy": () => { gmAction({ type: "encounter_copy", id }); toast("Kopie angelegt"); },
    "kb-neu": () => { App.kampfEntwurf = kampfEntwurfAus(null); render(); const f = $("kb-name"); if (f) f.focus(); },
    "kb-bearbeiten": () => { App.kampfEntwurf = kampfEntwurfAus((S.encounters || []).find((x) => x.id === id)); render(); },
    "kb-abbrechen": () => { App.kampfEntwurf = null; render(); },
    "kb-speichern": () => kampfSpeichern(),
    "kb-anzahl": () => {
      const z = App.kampfEntwurf && App.kampfEntwurf.zeilen[Number(target.dataset.i)];
      if (!z) return;
      z.anzahl = Math.max(1, Math.min(20, z.anzahl + Number(target.dataset.d)));
      render();
    },
    "kb-weg": () => { App.kampfEntwurf.zeilen.splice(Number(target.dataset.i), 1); render(); },
    "schnellkampf-start": () => {
      const sel = $("schnellkampf");
      if (sel && sel.value) handlers["encounter-start"].call(null, sel.value);
    },
    "encounter-delete": async () => { if (await frage("Vorbereiteten Kampf löschen?", "Löschen", true)) gmAction({ type: "delete_encounter", id }); },
    "ally-to-combat": () => {
      const z = parseInt(($("allyzone") || {}).value, 10);
      gmAction({ type: "add_ally_from_library", id, zone: isNaN(z) ? undefined : z });
    },
    // SL – Nachrichten
    "send-message": sendMessage,
    "clear-image": () => { App.pendingImageUrl = null; render(); },
    "clear-messages": () => gmAction({ type: "clear_messages" }),
    "clear-tv": () => gmAction({ type: "clear_tv_image" }),
    // Spieler-Anfragen
    "toggle-req-mode": () => { App.reqMode = !App.reqMode; render(); },
    "player-request": () => {
      const k = target.getAttribute("data-kind");
      if (target.closest(".daumen-leiste") && (k === "recover" || k === "status")) {
        const m = myCombatant();
        if (m) App.erholGetippt = { id: m.id, t: Date.now() };
        setTimeout(render, 4100);     // falls der Server schweigt: Knopf wieder zeigen
      }
      let detail = {};
      try { detail = JSON.parse(target.getAttribute("data-detail") || "{}"); } catch { /* ignore */ }
      gmActionOrPlayer({ type: "request", kind: target.getAttribute("data-kind"), detail, label: target.getAttribute("data-label") });
      App.reqMode = false;   // nach dem Absenden wieder zuklappen (ruhige Ansicht)
      render();
    },
    "req-apply": () => gmAction({ type: "resolve_request", id, apply: true }),
    "req-dismiss": () => gmAction({ type: "resolve_request", id, apply: false }),
    // Spieler
    "join-als": () => doJoin(id || null, false),
    "join-neu": () => doJoin(null, true),
    "join-modus": () => {
      App.joinEntwurf.modus = target.dataset.modus; App.joinFehler = null; render();
      if (target.dataset.modus === "neu") { const f = $("joinneu"); if (f) f.focus(); }
    },
    "leave": doLeave,
    "hold": () => gmActionOrPlayer({ type: "hold", id }),
    "intervene": () => gmActionOrPlayer({ type: "intervene", id }),
    "reveal-card": () => revealBigCard(target),
    // Kampfzonen: Bewegen NUR über Bahn-Tipp + Bestätigung (s. zoneGoto).
    "set-zone": () => gmAction({ type: "set_zone", id, zone: parseInt(target.getAttribute("data-zone"), 10) }),
    // token-info + zone-goto werden per pointerdown behandelt (robuster, s. u.)
    "tp-remove": async () => {
      const c = findCombatant(id);
      const msg = c && c.playerId ? `Spieler "${c.name}" entfernen (Kick)?` : `${c ? c.name : "Teilnehmer"} entfernen?`;
      if (await frage(msg, "Entfernen", true)) gmAction({ type: "remove_combatant", id });
      App.tokenPopupId = null;
    },
    "attack-request": () => {
      if (!angriffMelden(id)) return;
      App.tokenPopupId = null; render();
    },
    "close-token-popup": () => { App.tokenPopupId = null; render(); },
    // Fremden Bogen / Gegner-Spielwerte ansehen (Blatt über allem).
    "bogen-ansicht": () => {
      App.bogenAnsicht = { id, quelle: target.getAttribute("data-quelle") || "kampf" };
      App.tokenPopupId = null; App.kontextMenue = null; render();
    },
    "bogen-ansicht-zu": () => { App.bogenAnsicht = null; render(); },
    "bogen-ansicht-reiter": () => { App.bogenAnsichtReiter = target.getAttribute("data-reiter"); render(); },
    "zur-aktiven-zeile": () => zurAktivenZeile(true),
    "zustand-umschalten": () => {
      // Gemerkt in App.rowStatusOpen, damit ein Broadcast-Render es nicht zuklappt.
      if (App.rowStatusOpen.has(id)) App.rowStatusOpen.delete(id); else App.rowStatusOpen.add(id);
      render();
    },
    "leiste-einstellungen": () => { App.leisteEinstellungen = !App.leisteEinstellungen; App.trefferWahl = false; render(); },
    "treffer-wahl": () => { App.trefferWahl = !App.trefferWahl; App.trefferSteigerung = 0; App.leisteEinstellungen = false; render(); },
    "treffer-stufe": () => { App.trefferSteigerung = parseInt(target.dataset.n, 10) || 0; render(); },
    "treffer-auf": () => trefferAuf(id, e.shiftKey),
    "auswahl-leeren": () => { App.auswahl.clear(); render(); },
    "auswahl-gruppe": async () => {
      const name = await eingabe("Name der Gruppe?", "Trupp", "Gruppe anlegen");
      if (!name) return;
      gmAction({ type: "group_create", name: name.trim(), ids: [...App.auswahl] });
      App.auswahl.clear();
    },
    // Nur für die ziehbaren Marker/Chips des SL: bei denen darf pointerdown
    // nichts abfangen (sonst kein Ziehen), also öffnet der Klick das Fenster.
    // Ein echtes Ziehen löst gar keinen Klick aus - beides kommt sich nicht ins Gehege.
    // Im Ziel-Modus (🎯 Treffer offen) ist ein Token auf dem Board das Ziel.
    "token-info": () => {
      if (App.role === "gm" && App.trefferWahl && id !== S.activeId) { trefferAuf(id, e.shiftKey); return; }
      App.tokenPopupId = id; render();
    },
    "open-image": () => {
      App.overlayImage = target.getAttribute("data-url");
      const holder = target.closest("[data-cid]");
      const c = holder ? findCombatant(holder.getAttribute("data-cid")) : null;
      App.overlayName = target.getAttribute("data-name") || (c ? c.name : null);
      render();
    },
    "close-overlay": () => { App.overlayImage = null; App.overlayName = null; render(); },
    "dismiss-msg": () => {
      App.lastSeenMsgTs = Number(target.getAttribute("data-ts")) || Date.now();
      localStorage.setItem("lastSeenMsgTs", App.lastSeenMsgTs);
      render();
    },
    // Status (SL für alle, Spieler für sich selbst)
    "st-shaken": () => toggleStatus(id, "shaken"),
    "st-out": () => toggleStatus(id, "out"),
    "st-cond": () => toggleStatus(id, target.getAttribute("data-cond")),
    // Smart-Treffer (SW-Logik in einem Klick) + Erholen (frei / per Benny)
    "apply-hit": () => gmAction({ type: "apply_hit", id }),
    "apply-heal": () => gmAction({ type: "apply_heal", id }),
    "recover": () => gmAction({ type: "recover", id, benny: target.getAttribute("data-benny") === "1" }),
    // Ausgeschaltete Gegner aufräumen (SL) – nur Gegner, nicht Verbündete/Spieler
    "clear-defeated": async () => {
      const n = target.getAttribute("data-n") || "";
      if (await frage(`${n} ausgeschaltete Gegner aus dem Kampf entfernen?`, "Entfernen")) gmAction({ type: "clear_defeated" });
    },
    // Firewall in einem Klick freigeben (Windows-SL) -> löst UAC-Abfrage aus
    "firewall-allow": () => allowFirewall(),
    "fokus": () => fokusUmschalten(),
    "nur-offene": () => { App.nurOffene = !App.nurOffene; render(); },
    // Begegnung einsetzen, Spieler zurueckholen und austeilen - in einem Schritt.
    "encounter-start": async (wahlId) => {
      const kampfId = wahlId || id;
      const npcs = (S.combatants || []).filter((c) => c.kind === "npc").length;
      let ersetzen = false;
      if (npcs) {
        // Drei klare Knöpfe statt „OK = … / Abbrechen = …" (Abbrechen hieß
        // dort „dazustellen" - verwirrend, und wirklich abbrechen ging nicht).
        const wahl = await dialog({ text: `Es stehen noch ${npcs} Gegner/Verbündete im Kampf.`, knoepfe: [
          { text: "Abbrechen", wert: null, abbruch: true },
          { text: "Dazustellen", wert: "dazu" },
          { text: "Alte entfernen & frisch starten", wert: "neu", art: "primary", standard: true }] });
        if (!wahl) return;
        ersetzen = wahl === "neu";
      }
      gmAction({ type: "start_encounter", id: kampfId, ersetzen });
      const k = (S.encounters || []).find((x) => x.id === kampfId);
      if (k && k.note) toast("📝 " + k.note);   // die SL-Notiz genau dann, wenn sie gebraucht wird
    },
    "alle-zeigen": () => { App.alleZeigen = !App.alleZeigen; render(); },
    "bogen-reiter": () => { App.bogenReiter = target.getAttribute("data-reiter"); render(); },
    "bogen-bearbeiten": () => {
      const m = myCombatant();
      App.bogenEntwurf = bogenVon(m);
      App.talentEntwurf = { talents: [...(m.talents || [])], gluck: !!m.gluck, grosses_gluck: !!m.grosses_gluck };
      render();
    },
    "bogen-abbrechen": () => { App.bogenEntwurf = null; App.talentEntwurf = null; render(); },
    "bogen-speichern": () => {
      const mine = myCombatant();
      if (mine && App.bogenEntwurf) gmActionOrPlayer({ type: "sheet_update", id: mine.id, bogen: App.bogenEntwurf });
      if (mine && App.talentEntwurf) gmActionOrPlayer({ type: "talents_update", id: mine.id, ...App.talentEntwurf });
      App.bogenEntwurf = null;
      App.talentEntwurf = null;
      toast("📜 Gespeichert");
      render();
    },
    "bogen-dazu": () => {
      const liste = target.getAttribute("data-liste");
      if (!App.bogenEntwurf) return;
      App.bogenEntwurf[liste].push(liste === "waffen"
        ? { name: "", art: "nah", fertigkeit: "", schaden: "", info: "" }
        : { name: "", wert: "" });
      render();
    },
    "bogen-weg": () => {
      const liste = target.getAttribute("data-liste");
      if (!App.bogenEntwurf) return;
      App.bogenEntwurf[liste].splice(parseInt(target.getAttribute("data-i"), 10), 1);
      render();
    },
    "effekt-add": () => {
      const name = (($("effname-" + id) || {}).value || "").trim();
      if (!name) { toast("Erst einen Effekt eintragen"); return; }
      const runden = parseInt(($("effrunden-" + id) || {}).value, 10) || 0;
      gmAction({ type: "effect_add", id, name, runden });
    },
    "effekt-weg": () => gmAction({ type: "effect_remove", id, effekt: target.getAttribute("data-effekt") }),
    "effekt-plus": () => gmAction({ type: "effect_adjust", id, effekt: target.getAttribute("data-effekt"), delta: 1 }),
    "effekt-minus": () => gmAction({ type: "effect_adjust", id, effekt: target.getAttribute("data-effekt"), delta: -1 }),
    "anordnung-zuruecksetzen": () => {
      try { localStorage.removeItem("panelAnordnung"); } catch { /* egal */ }
      slAnsichtSichern();
      render();
    },
    "einladung-whatsapp": () => einladungWhatsApp(),
    "einladung-teilen": () => einladungTeilen(),
    "einladung-kopieren": () => einladungKopieren(),
    "einladung-bild": () => einladungsBildKopieren(),
    "qr-gross": () => qrGrossZeigen(),
    "bib-reiter": () => {
      try { localStorage.setItem("bibReiter", target.dataset.reiter); } catch { /* egal */ }
      render();
    },
    "gruppe-menue": () => {
      const gid = target.dataset.group;
      App.gruppeMenue = App.gruppeMenue === gid ? null : gid;
      render();
    },
    "gruppe-aufklappen": () => {
      const k = target.dataset.key;
      if (App.gruppeOffen.has(k)) App.gruppeOffen.delete(k); else App.gruppeOffen.add(k);
      render();
    },
    "tasten-hilfe": () => { App.tastenHilfe = !App.tastenHilfe; render(); },
    "ton-testen": () => {
      e.preventDefault();   // sitzt im <label> - sonst schaltet der Klick das Häkchen um
      tonWecken(); playBeep(660, 150); setTimeout(() => playBeep(990, 170), 170);
      try { if (kannVibrieren) navigator.vibrate([130, 70, 130]); } catch { /* egal */ }
      dranBlitz();
    },
    "rs-wahl-auf": () => { App.rsWahlOffen = !App.rsWahlOffen; render(); },
    "figur-rueckseite": () => {
      const mine = myCombatant();
      if (!mine) return;
      gmActionOrPlayer({ type: "set_figur_rueckseite", id: mine.id, wert: target.dataset.wert || null });
      toast("🂠 Rückseite gewählt");
    },
    "rueckseite-standard": () => { gmAction({ type: "set_rueckseite", url: null }); toast("Rückseite: Standardbild"); },
    "rueckseite-gruen": () => { gmAction({ type: "set_rueckseite", url: "gruen" }); toast("Rückseite: schlicht grün"); },
    "km-treffer": () => { App.trefferSteigerung = parseInt(target.dataset.n, 10) || 0; App.trefferSchaden = ""; trefferAuf(id); },
    "angriff-eigene": () => { App.angriffEigene = !App.angriffEigene; render(); },
    "angriff-waehlen": () => {
      App.angriffWahl = !App.angriffWahl;
      App.angriffEigene = false;
      // Wer angreift, muss würfeln: Zug-Uhr sofort anhalten (Stefan: 6 s zu hart).
      if (App.angriffWahl && App.role !== "gm") { const m = myCombatant(); if (m) gmActionOrPlayer({ type: "timer_halt", id: m.id }); }
      render();
    },
    "daumen-aufdecken": () => {
      const karte = document.querySelector('#bigcard [data-act="reveal-card"]');
      if (!karte) return;
      // Erst nach oben, sonst dreht sich die Karte außer Sicht.
      const oben = window.scrollY < 40;
      if (!oben) try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
      setTimeout(() => revealBigCard(karte), oben ? 0 : 350);
    },
    "angriff-auf": () => { if (angriffMelden(id)) { App.angriffWahl = false; render(); } },
    // SL: Angriffs-Fenster wieder hervorholen bzw. auf später schieben
    "angriff-oeffnen": () => { App.angriffSpaeter.delete(id); render(); },
    "angriff-spaeter": () => { App.angriffSpaeter.add(id); render(); },
    "angriff-ergebnis": () => {
      const r = (S.requests || []).find((x) => x.id === id);
      if (!r) return;
      const angreifer = findCombatant(r.combatantId);
      const zugEnde = !!(angreifer && S.activeId === angreifer.id && App.angriffZugEnde);
      gmAction({ type: "resolve_attack", id, ergebnis: target.dataset.ergebnis,
        steigerungen: parseInt(target.dataset.stg, 10) || 0, zugEnde });
      App.angriffSchaden = "";
      toast(`⚔ Ergebnis an ${angreifer ? angreifer.name : "den Spieler"} geschickt${zugEnde ? " – Zug beendet" : ""}`);
    },
    "hilfe-umschalten": () => {
      const sec = target.dataset.sec;
      if (App.hilfeOffen.has(sec)) App.hilfeOffen.delete(sec); else App.hilfeOffen.add(sec);
      render();
    },
    "jetzt-verbinden": () => { App.wentOfflineAt = App.wentOfflineAt || Date.now(); ensureConnected(); adressFallback(); },
    // Rückgängig (SL)
    "undo": () => gmAction({ type: "undo" }),
    // Bennies
    "benny-plus": () => gmActionOrPlayer({ type: "benny_adjust", id, delta: 1 }),
    "benny-minus": () => gmActionOrPlayer({ type: "benny_adjust", id, delta: -1 }),
    // Benny an den oben gewaehlten Empfaenger - laeuft als kurze Nachricht
    // („🪙 +1 Benny"), damit der Spieler es auch mitbekommt.
    // Aus dem Verlauf/Archiv erneut schicken - an den oben gewaehlten Empfaenger,
    // nicht zwingend an den von damals (meist will man es jemand anderem zeigen).
    "nochmal-senden": () => {
      const m = (S.messages || []).find((x) => x.id === target.getAttribute("data-msg"));
      if (!m) return;
      const ziel = ($("msgtarget") || {}).value || m.target || "all";
      gmAction({ type: "message", target: ziel, text: m.text, imageUrl: m.imageUrl });
      toast(ziel === "all" ? "Nochmal an alle geschickt" : "Nochmal geschickt");
    },
    "auf-tv": () => {
      gmAction({ type: "message", target: "beamer", text: "", imageUrl: target.getAttribute("data-url") });
      toast("📺 Bild liegt auf dem TV");
    },
    "benny-geben": () => {
      const ziel = ($("msgtarget") || {}).value || "all";
      if (ziel === "beamer") { toast("Bennies gehen nur an Spieler"); return; }
      gmAction({ type: "message", target: ziel, text: "", bennies: 1 });
      toast(ziel === "all" ? "🪙 Jeder Spieler bekommt einen Benny" : "🪙 Benny verteilt");
    },
    "benny-refresh": async () => { if (await frage("Alle Wildcards auf Startwert auffrischen?", "Auffrischen", false)) gmAction({ type: "benny_refresh" }); },
    "sl-benny-plus": () => gmAction({ type: "sl_benny_adjust", delta: 1 }),
    "sl-benny-minus": () => gmAction({ type: "sl_benny_adjust", delta: -1 }),
  };
  if (handlers[act]) { e.preventDefault(); handlers[act](); }
  // Rechtsklick-Menü: nach der Aktion zu (außer „bleibt"-Knöpfe).
  if (App.kontextMenue && target.closest(".kontext-menue") && !target.classList.contains("km-bleibt")) kontextMenueZu();
});
// Klick irgendwo daneben schließt das Menü (vor allen anderen Klick-Handlern).
document.addEventListener("click", (e) => {
  if (App.kontextMenue && !e.target.closest(".kontext-menue")) kontextMenueZu();
}, true);

// Tastatur für den SL: bei 25 Figuren ist jeder gesparte Mausweg spürbar.
//   Leertaste / Enter → freigeben bzw. Zug bestätigen (der jeweils passende Schritt)
//   W                 → weiter (ohne Timer)
//   T / H             → Treffer / Heilung beim aktuellen Akteur
//   Z                 → Ziel wählen: wen trifft der aktuelle Akteur?
//   ?                 → Übersicht aller Tastenkürzel
// Läuft NICHT, während in ein Feld getippt wird - sonst schluckt es Buchstaben.
document.addEventListener("keydown", (e) => {
  if (App.role !== "gm" || !App.state) return;
  if (e.key === "Escape" && App.tastenHilfe) { App.tastenHilfe = false; render(); return; }
  if (e.key === "Escape" && App.bogenAnsicht) { App.bogenAnsicht = null; render(); return; }
  if (e.key === "Escape" && App.auswahl.size) { App.auswahl.clear(); render(); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (e.key === "?") { e.preventDefault(); App.tastenHilfe = !App.tastenHilfe; render(); return; }
  const s = App.state;
  const aktiv = s.combatants.find((c) => c.id === s.activeId);
  // Runde durch (niemand mehr dran) oder noch nichts ausgeteilt: Leertaste
  // teilt die naechste Runde aus. Vorher musste man dafuer zur Maus greifen.
  if (!aktiv) {
    if ((e.key === " " || e.key === "Enter") && s.combatants.some((c) => !c.benched)) {
      e.preventDefault();
      gmAction({ type: "new_round" });
    }
    return;
  }

  const taste = e.key.toLowerCase();
  if (App.trefferWahl && /^[0-3]$/.test(e.key)) {
    e.preventDefault();
    App.trefferSteigerung = parseInt(e.key, 10);
    render();
    return;
  }
  if (App.trefferWahl && e.key === "Escape") { App.trefferWahl = false; render(); return; }
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    gmAction(s.phase === "running" ? { type: "confirm_turn" } : { type: "release" });
  } else if (taste === "w") {
    e.preventDefault();
    gmAction({ type: "confirm_turn" });     // „Weiter" = Zug beenden ohne Timer
  } else if (taste === "t") {
    e.preventDefault();
    gmAction({ type: "apply_hit", id: aktiv.id });
  } else if (taste === "h") {
    e.preventDefault();
    gmAction({ type: "apply_heal", id: aktiv.id });
  } else if (taste === "z") {
    e.preventDefault();
    App.trefferWahl = !App.trefferWahl;     // „Ziel": wen trifft der Aktive?
    App.leisteEinstellungen = false;
    render();
  }
});

// Kampfzonen-Auswahl per pointerdown statt click: die Aktion schließt sofort ab,
// unabhängig von einem gleich eintreffenden Broadcast-Render (behebt das „nur auf
// dem Icon loslassen"-Problem). Token = Info-Popup; freie Bahn = dorthin bewegen.
let tippStart = null;   // gemerkter Tipp: erst beim LOSLASSEN wird gehandelt

// Der Klick, den der Browser nach dem Loslassen nachschiebt, landet an derselben
// Stelle - und dort liegt dann das gerade geöffnete Fenster. Also einmal schlucken.
function schluckNaechstenKlick() {
  const weg = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener("click", weg, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", weg, true), 350);
}

// Strg-Klick auf eine Zeile der Reihenfolge (SL) sammelt ebenfalls - vorher
// ging das nur im Zonen-Board, in der Liste passierte beim Strg-Klick nichts.
document.addEventListener("pointerdown", (e) => {
  if (App.role !== "gm" || !(e.ctrlKey || e.metaKey)) return;
  const zeile = e.target.closest && e.target.closest(".order .combatant[data-cid]");
  if (!zeile || e.target.closest("button, input, select, label, a")) return;
  e.preventDefault();
  const id = zeile.dataset.cid;
  if (App.auswahl.has(id)) App.auswahl.delete(id); else App.auswahl.add(id);
  schluckNaechstenKlick();
  render();
}, true);

document.addEventListener("pointerdown", (e) => {
  // Nur die linke Taste bzw. der Finger. Ein Rechtsklick öffnete sonst beim
  // Loslassen das Info-Fenster über dem Rechtsklick-Menü (Stresstest 28.09.).
  if (e.button !== 0) { tippStart = null; return; }
  const t = e.target.closest('[data-act="token-info"], [data-act="zone-goto"]');
  if (!t) {
    tippStart = null;
    // Tipp daneben bricht eine schwebende Bewegungs-Bestätigung ab.
    if (App.pendingMove) { App.pendingMove = null; render(); }
    return;
  }
  const ziehbar = t.getAttribute("draggable") === "true";
  // Strg/Cmd-Klick (nur SL) sammelt Figuren, statt das Info-Fenster zu öffnen.
  if (ziehbar && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const id = t.getAttribute("data-id");
    if (App.auswahl.has(id)) App.auswahl.delete(id); else App.auswahl.add(id);
    render();
    return;
  }
  // NUR MERKEN - gehandelt wird beim Loslassen (pointerup). Früher öffnete das
  // Info-Fenster schon beim Aufsetzen, direkt unter dem Finger; beim Loslassen
  // landete der Tipp dann IM Fenster: auf dem Hintergrund (Fenster sofort wieder
  // zu - "geht beim Tippen nicht auf"), oder gar auf "Angreifen" (ungewollte
  // Aktion). Nur langes Halten klappte, weil das Handy den Tipp dann verwirft.
  // Gemerkt werden reine Werte statt des Elements: ein Neuzeichnen zwischen
  // Aufsetzen und Loslassen (Zustands-Update) schadet so nicht.
  tippStart = {
    x: e.clientX, y: e.clientY,
    act: t.getAttribute("data-act"), id: t.getAttribute("data-id"), tz: t.getAttribute("data-tz"),
  };
  // Ziehbare Marker (SL) NICHT abfangen: preventDefault() unterbindet das
  // native Ziehen, und Drag & Drop wäre tot.
  if (!ziehbar) e.preventDefault();
});

document.addEventListener("pointercancel", () => { tippStart = null; });   // Handy scrollt

document.addEventListener("pointerup", (e) => {
  const s = tippStart;
  tippStart = null;
  if (!s || gezogeneId) return;                                     // gezogen, kein Tipp
  if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) return;    // gewischt/gescrollt
  schluckNaechstenKlick();
  if (s.act === "token-info") {
    // Ist „🎯 Treffer" offen, ist die angetippte Figur das Ziel. (Der Weg über
    // den Klick-Handler kam nie an: der Klick wird oben geschluckt - mit der
    // Maus öffnete sich darum nur das Info-Fenster.)
    if (App.role === "gm" && App.trefferWahl && App.state && s.id !== App.state.activeId) {
      trefferAuf(s.id, e.shiftKey);
      return;
    }
    App.tokenPopupId = s.id;
    render();
  } else {
    zoneGoto(s.id, Number(s.tz));
  }
});

// Bahn-Tipp der eigenen Figur: 1 Schritt = normal, 2 = Rennen. Gegen Missclicks
// erst BESTÄTIGEN (zweiter Tipp auf dieselbe Bahn führt aus).
function zoneGoto(id, tz) {
  const c = App.state && App.state.combatants.find((x) => x.id === id);
  if (!c || isNaN(tz)) return;
  const delta = tz - Zones.zoneOf(c);
  const steps = Math.abs(delta);
  if (steps < 1 || steps > 2) return;
  if (App.pendingMove && App.pendingMove.id === id && App.pendingMove.tz === tz) {
    App.pendingMove = null;
    gmActionOrPlayer({ type: "move_zone", id, dir: delta < 0 ? -1 : 1, run: steps === 2 });
  } else {
    App.pendingMove = { id, tz, run: steps === 2 };
    render();
  }
}

// Spieler und SL nutzen denselben Kanal; der Server erlaubt Spielern nur eng
// begrenzte Aktionen (eigenen Zug bestätigen, Abwarten, Eingreifen).
function gmActionOrPlayer(action) { wsSend({ type: "gm_action", action }); }

// Hook für Mimi: NUR das SL-Gerät verschickt Mimis Miau-Nachrichten (sonst
// würde jede lokale Mimi spammen). Ziel: zufälliger verbundener Spieler oder alle.
window.mimiSend = function (text) {
  if (App.role !== "gm" || !App.state) return;
  const connected = (App.state.players || []).filter((p) => p.connected);
  const target = connected.length && Math.random() < 0.55
    ? connected[Math.floor(Math.random() * connected.length)].id : "all";
  gmAction({ type: "message", sender: "mimi", target, text });
};

document.addEventListener("change", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.getAttribute("data-act");
  if (act === "set-timer") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) gmAction({ type: "set_timer", seconds: v });
  } else if (act === "set-benny-start") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) gmAction({ type: "set_benny_start", value: v });
  } else if (act === "pick-image") {
    uploadImage(t.files[0]);
  } else if (act === "pick-char-image") {
    uploadCharImage(t.files[0], t.getAttribute("data-id"));
  } else if (act === "pick-figur-rueckseite") {
    uploadFigurRueckseite(t.files[0], t.dataset.profil === "1");
  } else if (act === "kb-char" || act === "kb-char-zone") {
    const c = App.kampfEntwurf && App.kampfEntwurf.chars[t.dataset.id];
    if (!c) return;
    if (act === "kb-char") c.dabei = t.checked; else c.zone = parseInt(t.value, 10);
    render();
  } else if (act === "kb-zone" || act === "kb-anon") {
    const z = App.kampfEntwurf && App.kampfEntwurf.zeilen[Number(t.dataset.i)];
    if (!z) return;
    if (act === "kb-zone") z.zone = parseInt(t.value, 10); else z.anon = t.checked;
    render();
  } else if (act === "kb-dazu") {
    const [art, vid] = String(t.value || "").split(":");
    const liste = art === "b" ? App.state.bestiary : App.state.allies;
    const v = (liste || []).find((x) => x.id === vid);
    if (v && App.kampfEntwurf) {
      const ally = art === "a";
      const zone = ally ? lastAllyZone() : lastNpcZone();
      const key = `${v.id}|${ally ? 1 : 0}|${zone}|0`;
      const vorhanden = App.kampfEntwurf.zeilen.find((z) => z.key === key);
      if (vorhanden) vorhanden.anzahl += 1;
      else App.kampfEntwurf.zeilen.push({ key, anzahl: 1, zone, anon: false,
        proto: { name: v.name, isWildCard: !!v.isWildCard, talents: v.talents || [], gluck: !!v.gluck, grosses_gluck: !!v.grosses_gluck,
                 ally, image: v.image || null, vorlage: v.id, parade: v.parade, robustheit: v.robustheit, panzer: v.panzer, spielwerte: v.spielwerte || "" } });
    }
    t.value = "";
    render();
  } else if (act === "pick-rueckseite") {
    uploadRueckseite(t.files[0]);
    t.value = "";                    // dasselbe Bild nochmal wählen geht sonst nicht
  } else if (act === "pick-bestiary-image") {
    uploadBestiaryImage(t.files[0]);
  } else if (act === "pick-ally-image") {
    uploadAllyImage(t.files[0]);
  } else if (act === "group-move") {
    // Verlässlicher Weg neben dem Ziehen – und der einzige auf dem Handy.
    const z = parseInt(t.value, 10);
    if (!isNaN(z)) gmAction({ type: "group_move", group: t.dataset.group, zone: z });
    t.value = "";
  } else if (act === "remember-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZone", String(v)); } catch {} }
  } else if (act === "remember-ally-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZoneAlly", String(v)); } catch {} }
  } else if (act === "remember-player-zone") {
    const v = parseInt(t.value, 10);
    if (!isNaN(v)) { try { localStorage.setItem("lastZonePlayer", String(v)); } catch {} }
  } else if (act === "set-statisten-ko") {
    gmAction({ type: "set_statisten_ko", value: parseInt(t.value, 10) });
  } else if (act === "toggle-auto-incap") {
    gmAction({ type: "set_auto_incap", on: t.checked });
  } else if (act === "toggle-auto-release") {
    gmAction({ type: "set_auto_release", on: t.checked });
  } else if (act === "toggle-conditions") {
    gmAction({ type: "set_conditions_enabled", on: t.checked });
  } else if (act === "angriff-zugende") {
    App.angriffZugEnde = t.checked;
  } else if (act === "toggle-kampfhilfe") {
    gmAction({ type: "set_kampfhilfe", name: t.dataset.name, on: t.checked });
  } else if (act === "toggle-requests") {
    gmAction({ type: "set_requests_enabled", on: t.checked });
  } else if (act === "toggle-benny-to-gm") {
    gmAction({ type: "set_benny_to_gm", on: t.checked });
  } else if (act === "toggle-notify") {
    try { localStorage.setItem("notifyTurn", t.checked ? "on" : "off"); } catch {}
    if (t.checked) playBeep(880, 120);   // kurzes Feedback, dass Ton geht
  } else if (act === "pick-import") {
    importBackup(t.files[0]);
    t.value = "";
  }
});

// Firewall für die App freigeben (alle Kandidaten-Ports). Löst beim SL eine UAC-Abfrage aus.
async function allowFirewall() {
  App._firewallDone = true;
  App._firewallFail = false;
  render();
  try {
    await fetch("/api/firewall-allow", { method: "POST" });
  } catch { /* egal – UAC läuft ggf. trotzdem */ }
  // Nachsehen, ob die Regel jetzt TATSÄCHLICH existiert. Nur „gestartet" zu
  // melden hilft niemandem – auf Firmen-Laptops scheitert die Elevation still.
  setTimeout(() => {
    fetch("/api/info").then((r) => r.json()).then((info) => {
      App._info = info;
      merkeServerAdressen(info);
      App._firewallDone = false;
      App._firewallFail = info.firewallRuleActive === false;
      render();
    }).catch(() => {});
  }, 5000);
}

// Sicherung wiederherstellen: ersetzt Charaktere + Bibliotheken + Begegnungen.
async function importBackup(file) {
  if (!file) return;
  if (!await frage("Sicherung einspielen? Ersetzt Charakterliste, Gegner-/Verbündeten-Bibliothek und Begegnungen (der laufende Kampf bleibt).", "Einspielen", true)) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/import", { method: "POST", body: fd });
    if (res.status === 400) { hinweis("Das war keine gültige Sicherungsdatei."); return; }
    if (res.status === 403) { hinweis("Import geht nur am Spielleiter-Laptop."); return; }
    if (!res.ok) { hinweis("Import fehlgeschlagen."); return; }

    // Genau berichten, was übernommen wurde – Importieren ERSETZT die Listen,
    // da will man nicht raten, ob die Datei wirklich gepasst hat.
    const b = await res.json();
    if (!b.ok) { hinweis("Nicht eingespielt.\n\n" + (b.fehler || "Unbekannter Grund.")); return; }
    const zeilen = Object.entries(b.uebernommen || {}).map(([was, n]) => `• ${n} ${was}`);
    hinweis("Sicherung eingespielt.\n\n" + (zeilen.join("\n") || "(nichts)") +
      (b.verworfen ? `\n\n${b.verworfen} unbrauchbare Einträge wurden übersprungen.` : ""));
  } catch { hinweis("Import fehlgeschlagen."); }
}

// Hochgeladene Bilder, auf die nichts mehr zeigt, wegräumen. Jedes ersetzte
// Porträt bleibt sonst für immer im data-Ordner liegen.
async function bilderAufraeumen() {
  try {
    const info = await (await fetch("/api/bilder-verwaist")).json();
    if (!info.anzahl) { toast("Keine überflüssigen Bilder gefunden."); return; }
    const kb = Math.round(info.bytes / 1024);
    if (!await frage(`${info.anzahl} Bild(er) werden von nichts mehr verwendet (${kb} KB).\n\nJetzt löschen?`, "Löschen", true)) return;
    const erg = await (await fetch("/api/bilder-aufraeumen", { method: "POST" })).json();
    toast(`${erg.geloescht} Bild(er) gelöscht, ${Math.round(erg.bytes / 1024)} KB frei.`);
  } catch { hinweis("Aufräumen fehlgeschlagen."); }
}
