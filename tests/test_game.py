"""Kern-Spielregeln über Game.apply – mit isoliertem Datenverzeichnis."""

import json


def _add_npc(g, name="Gegner", zone=None, wildcard=False):
    a = {"type": "add_npc", "name": name, "isWildCard": wildcard}
    if zone is not None:
        a["zone"] = zone
    g.apply(a)
    return g.combatants[-1]


def test_add_npc_defaults(fresh_game):
    c = _add_npc(fresh_game, "Skree")
    assert c["kind"] == "npc"
    assert c["ally"] is False
    assert c["benched"] is False
    assert c["zone"] == 4                 # DEFAULT_ZONE_NPC


def test_add_npc_with_zone(fresh_game):
    c = _add_npc(fresh_game, "Skree", zone=2)
    assert c["zone"] == 2


def test_deal_gives_everyone_a_card(fresh_game):
    _add_npc(fresh_game, "A")
    _add_npc(fresh_game, "B")
    fresh_game.apply({"type": "new_round"})
    assert all(c["card"] for c in fresh_game.combatants)
    assert fresh_game.round == 1


def test_benched_gets_no_card_and_unbench_restores(fresh_game):
    a = _add_npc(fresh_game, "A")
    b = _add_npc(fresh_game, "B")
    fresh_game.apply({"type": "new_round"})
    fresh_game.apply({"type": "bench", "id": a["id"], "on": True})
    a = fresh_game._combatant(a["id"])
    assert a["benched"] is True and a["card"] is None
    # Nächste Runde: pausiert -> keine Karte, der andere schon.
    fresh_game.apply({"type": "new_round"})
    assert fresh_game._combatant(a["id"])["card"] is None
    assert fresh_game._combatant(b["id"])["card"] is not None
    # Wieder rein -> bekommt nächste Runde wieder eine Karte.
    fresh_game.apply({"type": "bench", "id": a["id"], "on": False})
    fresh_game.apply({"type": "new_round"})
    assert fresh_game._combatant(a["id"])["card"] is not None


def test_wounds_clamped(fresh_game):
    c = _add_npc(fresh_game, "WC", wildcard=True)
    fresh_game.apply({"type": "set_status", "id": c["id"], "wounds": 99})
    assert fresh_game._combatant(c["id"])["status"]["wounds"] == 3
    fresh_game.apply({"type": "set_status", "id": c["id"], "wounds": -5})
    assert fresh_game._combatant(c["id"])["status"]["wounds"] == 0


def test_auto_incap_on_fourth_wound(fresh_game):
    c = _add_npc(fresh_game, "Boss", wildcard=True)
    assert fresh_game.auto_incap is True
    fresh_game.apply({"type": "set_status", "id": c["id"], "wounds": 4})
    st = fresh_game._combatant(c["id"])["status"]
    assert st["wounds"] == 3 and st["out"] is True


def test_auto_incap_off_clamps_without_out(fresh_game):
    c = _add_npc(fresh_game, "Boss", wildcard=True)
    fresh_game.apply({"type": "set_auto_incap", "on": False})
    fresh_game.apply({"type": "set_status", "id": c["id"], "wounds": 4})
    st = fresh_game._combatant(c["id"])["status"]
    assert st["wounds"] == 3 and st["out"] is False


def test_apply_hit_shaken_then_wound_then_out(fresh_game):
    c = _add_npc(fresh_game, "Ork", wildcard=True)
    cid = c["id"]
    fresh_game.apply({"type": "apply_hit", "id": cid})   # 1. Treffer -> Angeschlagen
    assert fresh_game._combatant(cid)["status"]["shaken"] is True
    assert fresh_game._combatant(cid)["status"]["wounds"] == 0
    for _ in range(3):
        fresh_game.apply({"type": "apply_hit", "id": cid})  # je +1 Wunde -> 3 Wunden
    st = fresh_game._combatant(cid)["status"]
    assert st["wounds"] == 3 and st["out"] is False
    fresh_game.apply({"type": "apply_hit", "id": cid})      # 4. Wunde -> K.O.
    st = fresh_game._combatant(cid)["status"]
    assert st["wounds"] == 3 and st["out"] is True


def test_apply_heal_reverses_hit_chain(fresh_game):
    c = _add_npc(fresh_game, "Ork", wildcard=True)
    cid = c["id"]
    for _ in range(5):                       # bis K.O. (1x shaken + 4 Wunden)
        fresh_game.apply({"type": "apply_hit", "id": cid})
    assert fresh_game._combatant(cid)["status"]["out"] is True
    fresh_game.apply({"type": "apply_heal", "id": cid})     # erst wieder wach
    st = fresh_game._combatant(cid)["status"]
    assert st["out"] is False and st["wounds"] == 3
    for _ in range(3):
        fresh_game.apply({"type": "apply_heal", "id": cid})  # Wunden abbauen
    st = fresh_game._combatant(cid)["status"]
    assert st["wounds"] == 0 and st["shaken"] is True
    fresh_game.apply({"type": "apply_heal", "id": cid})      # zuletzt Angeschlagen
    assert fresh_game._combatant(cid)["status"]["shaken"] is False


def test_player_benny_moves_to_gm_pool_when_enabled(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    fresh_game.apply({"type": "add_from_roster", "id": fresh_game.roster[-1]["id"]})
    c = fresh_game.combatants[-1]
    assert fresh_game.benny_to_gm is True
    pool0 = fresh_game.sl_bennies
    fresh_game.apply({"type": "benny_adjust", "id": c["id"], "delta": -1})
    assert fresh_game.sl_bennies == pool0 + 1        # Benny landet beim SL

    fresh_game.apply({"type": "set_benny_to_gm", "on": False})
    pool1 = fresh_game.sl_bennies
    fresh_game.apply({"type": "benny_adjust", "id": c["id"], "delta": -1})
    assert fresh_game.sl_bennies == pool1            # aus -> kein Transfer


def test_npc_benny_does_not_feed_gm_pool(fresh_game):
    c = _add_npc(fresh_game, "Boss", wildcard=True)
    pool0 = fresh_game.sl_bennies
    fresh_game.apply({"type": "benny_adjust", "id": c["id"], "delta": -1})
    assert fresh_game.sl_bennies == pool0            # SL-eigene NSCs zählen nicht


def test_recover_free_clears_shaken_only(fresh_game):
    c = _add_npc(fresh_game, "Ork", wildcard=True)
    cid = c["id"]
    fresh_game.apply({"type": "set_status", "id": cid, "shaken": True})
    b0 = fresh_game._combatant(cid)["bennies"]
    fresh_game.apply({"type": "recover", "id": cid})         # frei, ohne Benny
    assert fresh_game._combatant(cid)["status"]["shaken"] is False
    assert fresh_game._combatant(cid)["bennies"] == b0       # kein Benny verbraucht


def test_recover_with_benny_spends_one(fresh_game):
    c = _add_npc(fresh_game, "Held", wildcard=True)
    cid = c["id"]
    fresh_game.apply({"type": "set_status", "id": cid, "shaken": True})
    b0 = fresh_game._combatant(cid)["bennies"]
    fresh_game.apply({"type": "recover", "id": cid, "benny": True})
    assert fresh_game._combatant(cid)["status"]["shaken"] is False
    assert fresh_game._combatant(cid)["bennies"] == b0 - 1


def test_note_set_via_edit(fresh_game):
    c = _add_npc(fresh_game, "Ork")
    fresh_game.apply({"type": "edit_combatant", "id": c["id"], "note": "flieht bei 2 Wunden"})
    assert fresh_game._combatant(c["id"])["note"] == "flieht bei 2 Wunden"


def test_encounter_save_and_redeploy(fresh_game):
    fresh_game.apply({"type": "add_npc", "name": "Pirat", "isWildCard": False, "zone": 2})
    fresh_game.apply({"type": "ally_upsert", "name": "Gardist"})
    fresh_game.apply({"type": "add_ally_from_library", "id": fresh_game.allies[-1]["id"], "zone": 1})
    fresh_game.apply({"type": "save_encounter", "name": "Überfall"})
    assert len(fresh_game.encounters) == 1
    assert len(fresh_game.encounters[0]["members"]) == 2
    # Kampf leeren, dann Begegnung komplett wieder einsetzen.
    fresh_game.combatants.clear()
    fresh_game.apply({"type": "add_encounter", "id": fresh_game.encounters[0]["id"]})
    names = sorted(c["name"] for c in fresh_game.combatants)
    assert names == ["Gardist", "Pirat"]
    assert next(c for c in fresh_game.combatants if c["name"] == "Gardist")["ally"] is True
    assert next(c for c in fresh_game.combatants if c["name"] == "Pirat")["zone"] == 2


def test_export_import_roundtrip(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    fresh_game.apply({"type": "bestiary_upsert", "name": "Goblin"})
    data = fresh_game.export_data()
    fresh_game.roster = []
    fresh_game.bestiary = []
    bericht = fresh_game.import_data(data)
    assert bericht["ok"] is True
    assert bericht["verworfen"] == 0
    assert [r["name"] for r in fresh_game.roster] == ["Held"]
    assert [b["name"] for b in fresh_game.bestiary] == ["Goblin"]


def test_import_sortiert_muell_aus(fresh_game):
    """Eine kaputte Datei darf die Charakterliste nicht mit Muell fuellen -
    Importieren ERSETZT sie ja."""
    bericht = fresh_game.import_data({
        "roster": [{"name": "Held"}, {"kein": "name"}, "Text statt Objekt", None],
    })
    assert bericht["ok"] is True
    assert bericht["uebernommen"]["Charaktere"] == 1
    assert bericht["verworfen"] == 3
    assert [r["name"] for r in fresh_game.roster] == ["Held"]


def test_import_lehnt_fremde_datei_ab(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    bericht = fresh_game.import_data({"irgendwas": 123})
    assert bericht["ok"] is False
    assert bericht["fehler"]
    assert [r["name"] for r in fresh_game.roster] == ["Held"]   # nichts angefasst


def test_import_lehnt_nicht_json_objekt_ab(fresh_game):
    bericht = fresh_game.import_data(["Liste statt Objekt"])
    assert bericht["ok"] is False
    assert "keine Sicherungsdatei" in bericht["fehler"]


def test_set_zone_clamped(fresh_game):
    c = _add_npc(fresh_game, "A", zone=1)
    fresh_game.apply({"type": "set_zone", "id": c["id"], "zone": 9})
    assert fresh_game._combatant(c["id"])["zone"] == 4
    fresh_game.apply({"type": "set_zone", "id": c["id"], "zone": -3})
    assert fresh_game._combatant(c["id"])["zone"] == 0


def test_roster_add_with_zone(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    rid = fresh_game.roster[-1]["id"]
    fresh_game.apply({"type": "add_from_roster", "id": rid, "zone": 3})
    c = fresh_game.combatants[-1]
    assert c["kind"] == "player" and c["zone"] == 3


def test_bestiary_and_ally_add_with_zone(fresh_game):
    fresh_game.apply({"type": "bestiary_upsert", "name": "Pirat"})
    fresh_game.apply({"type": "add_npc_from_bestiary", "id": fresh_game.bestiary[-1]["id"], "zone": 2})
    enemy = fresh_game.combatants[-1]
    assert enemy["kind"] == "npc" and enemy["ally"] is False and enemy["zone"] == 2

    fresh_game.apply({"type": "ally_upsert", "name": "Gardist"})
    fresh_game.apply({"type": "add_ally_from_library", "id": fresh_game.allies[-1]["id"], "zone": 0})
    ally = fresh_game.combatants[-1]
    assert ally["ally"] is True and ally["zone"] == 0


def test_clear_defeated_removes_only_enemies(fresh_game):
    enemy = _add_npc(fresh_game, "Feind")
    fresh_game.apply({"type": "ally_upsert", "name": "Freund"})
    fresh_game.apply({"type": "add_ally_from_library", "id": fresh_game.allies[-1]["id"]})
    ally = fresh_game.combatants[-1]
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    fresh_game.apply({"type": "add_from_roster", "id": fresh_game.roster[-1]["id"]})
    player = fresh_game.combatants[-1]

    for c in (enemy, ally, player):
        fresh_game.apply({"type": "set_status", "id": c["id"], "out": True})
    fresh_game.apply({"type": "clear_defeated"})

    names = [c["name"] for c in fresh_game.combatants]
    assert "Feind" not in names          # Gegner entfernt
    assert "Freund" in names             # Verbündeter bleibt
    assert "Held" in names               # Spieler bleibt


def test_clear_all_removes_npcs_and_benches_players(fresh_game):
    enemy = _add_npc(fresh_game, "Feind")
    fresh_game.apply({"type": "group_create", "name": "Bande", "ids": [enemy["id"]]})
    fresh_game.apply({"type": "ally_upsert", "name": "Freund"})
    fresh_game.apply({"type": "add_ally_from_library", "id": fresh_game.allies[-1]["id"]})
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    fresh_game.apply({"type": "add_from_roster", "id": fresh_game.roster[-1]["id"]})
    fresh_game.apply({"type": "new_round"})

    fresh_game.apply({"type": "clear_all"})

    assert [c["name"] for c in fresh_game.combatants] == ["Held"]   # nur der Spieler bleibt
    held = fresh_game.combatants[0]
    assert held["benched"] is True and held["card"] is None      # aus dem Kampf, nicht vom Board
    assert fresh_game.groups == []
    assert fresh_game.round == 0 and fresh_game.active_id is None
    assert len(fresh_game.deck) == 54 and fresh_game.discard == []   # alle Karten zurück

    fresh_game.apply({"type": "unbench_all"})                   # nächster Kampf: alle wieder rein
    assert fresh_game.combatants[0]["benched"] is False
    fresh_game.apply({"type": "undo"})

    fresh_game.apply({"type": "undo"})                          # Versehen? Rückgängig holt alles zurück
    assert {"Feind", "Freund", "Held"} <= {c["name"] for c in fresh_game.combatants}


def test_bennies_are_remembered_on_the_character(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    char_id = fresh_game.roster[-1]["id"]
    fresh_game.apply({"type": "add_from_roster", "id": char_id})
    held = fresh_game.combatants[-1]
    start = held["bennies"]
    fresh_game.apply({"type": "benny_adjust", "id": held["id"], "delta": 2})

    # Figur fliegt raus und kommt neu -> der Stand bleibt, nicht der Startwert.
    fresh_game.apply({"type": "remove_combatant", "id": held["id"]})
    fresh_game.apply({"type": "add_from_roster", "id": char_id})
    assert fresh_game.combatants[-1]["bennies"] == start + 2

    # Charakter bearbeiten verliert den gemerkten Stand nicht.
    fresh_game.apply({"type": "roster_upsert", "id": char_id, "name": "Held II", "isWildCard": True})
    assert fresh_game.roster[-1]["bennies"] == start + 2

    # Auffrischen setzt auch den gemerkten Stand zurück.
    fresh_game.apply({"type": "benny_refresh"})
    assert fresh_game.roster[-1]["bennies"] == start


def test_message_can_carry_bennies(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Tessa", "isWildCard": True})
    tessa_char = fresh_game.roster[-1]["id"]
    fresh_game.apply({"type": "roster_upsert", "name": "Vorn", "isWildCard": True})
    vorn_char = fresh_game.roster[-1]["id"]
    p1 = fresh_game.register_player("P1", tessa_char, None)["id"]
    fresh_game.register_player("P2", vorn_char, None)
    tessa = next(c for c in fresh_game.combatants if c["name"] == "Tessa")
    vorn = next(c for c in fresh_game.combatants if c["name"] == "Vorn")
    t0, v0 = tessa["bennies"], vorn["bennies"]

    fresh_game.apply({"type": "message", "target": p1, "text": "Gut gespielt!", "bennies": 1})
    assert tessa["bennies"] == t0 + 1 and vorn["bennies"] == v0      # nur die Empfängerin
    assert "+1 Benny" in fresh_game.messages[-1]["text"]

    fresh_game.apply({"type": "message", "target": "all", "text": "", "bennies": 2})   # ohne Text geht auch
    assert tessa["bennies"] == t0 + 3 and vorn["bennies"] == v0 + 2
    assert fresh_game.messages[-1]["text"] == "🪙 +2 Bennies"


def test_rejoin_before_resume_keeps_saved_session(fresh_game):
    """Neustart mitten im Abend: Die Handys melden sich automatisch wieder an,
    BEVOR der SL „Fortsetzen" klickt. Das darf den gespeicherten Kampf nicht
    überschreiben, und das Handy muss danach wieder zu seiner Figur passen."""
    from server import game as game_mod
    fresh_game.apply({"type": "roster_upsert", "name": "Tessa", "isWildCard": True})
    char = fresh_game.roster[-1]["id"]
    pid = fresh_game.register_player("Stefan", char, None)["id"]
    _add_npc(fresh_game, "Ork")
    fresh_game.apply({"type": "new_round"})          # speichert den Kampf

    neu = game_mod.Game()                            # „Server-Neustart"
    assert neu.resume_available
    neu.register_player("Stefan", char, pid)         # Handy meldet sich sofort wieder
    neu.save_session()                               # (so wie app.py es beim Beitritt tut)
    assert neu.resume_available                      # Fortsetzen ist noch möglich
    assert neu.resume_session()
    namen = {c["name"] for c in neu.combatants}
    assert namen == {"Tessa", "Ork"} and neu.round == 1    # der Kampf ist noch da
    tessa = next(c for c in neu.combatants if c["name"] == "Tessa")
    assert tessa["playerId"] == pid                  # und das Handy passt zu seiner Figur


def test_sheet_is_kept_on_character_and_sanitized(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Tessa", "isWildCard": True})
    char = fresh_game.roster[-1]["id"]
    pid = fresh_game.register_player("Stefan", char, None)["id"]
    tessa = next(c for c in fresh_game.combatants if c["playerId"] == pid)
    undo_vorher = len(fresh_game._history)

    fresh_game.apply({"type": "sheet_update", "id": tessa["id"], "bogen": {
        "parade": "7", "robustheit": "8", "panzer": "2", "tempo": "6", "rennen": "W6",
        "attribute": {"ge": "W8", "ve": "W99", "hack": "W12"},
        "fertigkeiten": [{"name": "Kämpfen", "wert": "W8"}, {"name": ""}],
        "waffen": [{"name": "Rapier", "schaden": "St+W4", "info": "Parade +1"}],
        "talente": ["Flink", "x" * 500], "handicaps": ["Neugierig"], "ausruestung": ["Heiltrank ×3"],
        "boese": "<script>",
    }})
    bogen = fresh_game.roster[-1]["bogen"]
    assert bogen["attribute"] == {"ge": "W8", "ve": "", "wi": "", "st": "", "ko": ""}   # Unsinn raus
    assert [f["name"] for f in bogen["fertigkeiten"]] == ["Kämpfen"]                   # leere Zeile raus
    assert len(bogen["talente"][1]) == 40 and "boese" not in bogen
    assert len(fresh_game._history) == undo_vorher          # kein Eintrag im Rückgängig des SL

    # Figur fliegt raus, Spieler kommt neu: der Bogen ist wieder da.
    fresh_game.apply({"type": "remove_combatant", "id": tessa["id"]})
    fresh_game.register_player("Stefan", char, None)
    neu = next(c for c in fresh_game.combatants if c.get("characterId") == char)
    assert neu["bogen"]["waffen"][0]["name"] == "Rapier"
    # SL bearbeitet den Charakter -> Bogen bleibt erhalten.
    fresh_game.apply({"type": "roster_upsert", "id": char, "name": "Tessa", "isWildCard": True})
    assert fresh_game.roster[-1]["bogen"]["parade"] == "7"


def test_effects_count_down_each_new_round(fresh_game):
    ork = _add_npc(fresh_game, "Ork")
    fresh_game.apply({"type": "new_round"})
    fresh_game.apply({"type": "effect_add", "id": ork["id"], "name": "Betäubt", "runden": 2})
    fresh_game.apply({"type": "effect_add", "id": ork["id"], "name": "Brennt", "runden": 0})   # ohne Ablauf
    ork = fresh_game._combatant(ork["id"])

    fresh_game.apply({"type": "deal_current"})          # gleiche Runde neu austeilen: zählt NICHT
    assert [e["runden"] for e in ork["effekte"]] == [2, 0]

    fresh_game.apply({"type": "new_round"})
    assert [e["runden"] for e in ork["effekte"]] == [1, 0]
    fresh_game.apply({"type": "new_round"})
    assert [e["name"] for e in ork["effekte"]] == ["Brennt"]   # Betäubt abgelaufen
    assert "Betäubt bei Ork ist abgelaufen" in fresh_game.effekt_meldungen[-1]["text"]

    brennt = ork["effekte"][0]["id"]
    fresh_game.apply({"type": "effect_remove", "id": ork["id"], "effekt": brennt})
    assert ork["effekte"] == []


def test_effect_adjust_never_drops_to_zero(fresh_game):
    ork = _add_npc(fresh_game, "Ork")
    fresh_game.apply({"type": "effect_add", "id": ork["id"], "name": "Schutz", "runden": 1})
    eff = fresh_game._combatant(ork["id"])["effekte"][0]
    fresh_game.apply({"type": "effect_adjust", "id": ork["id"], "effekt": eff["id"], "delta": -1})
    assert fresh_game._combatant(ork["id"])["effekte"][0]["runden"] == 1   # Entfernen geht über ✕
    fresh_game.apply({"type": "effect_adjust", "id": ork["id"], "effekt": eff["id"], "delta": 1})
    assert fresh_game._combatant(ork["id"])["effekte"][0]["runden"] == 2


def test_remove_active_advances(fresh_game):
    a = _add_npc(fresh_game, "A")
    b = _add_npc(fresh_game, "B")
    fresh_game.apply({"type": "new_round"})
    active = fresh_game.active_id
    fresh_game.apply({"type": "remove_combatant", "id": active})
    assert fresh_game.active_id != active
    assert active not in [c["id"] for c in fresh_game.combatants]


def test_undo_restores_previous_state(fresh_game):
    _add_npc(fresh_game, "A")
    assert len(fresh_game.combatants) == 1
    _add_npc(fresh_game, "B")
    assert len(fresh_game.combatants) == 2
    fresh_game.apply({"type": "undo"})
    assert len(fresh_game.combatants) == 1


def test_status_request_wounds_delta_applies(fresh_game):
    # Spieler mit Anfrage „Wunde +1" -> nach Freigabe genau +1.
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    fresh_game.apply({"type": "add_from_roster", "id": fresh_game.roster[-1]["id"]})
    c = fresh_game.combatants[-1]
    fresh_game.requests.append({
        "id": "req1", "combatantId": c["id"], "kind": "status",
        "detail": {"woundsDelta": 1}, "name": c["name"],
    })
    fresh_game.apply({"type": "resolve_request", "id": "req1", "apply": True})
    assert fresh_game._combatant(c["id"])["status"]["wounds"] == 1
    assert fresh_game.requests == []


def test_undo_restores_and_persists_libraries(fresh_game, tmp_path):
    """Undo muss Bibliotheken zurückholen UND die Dateien mitziehen –
    sonst steht nach einem Neustart wieder der rückgängig gemachte Stand da."""
    from server import game as gmod
    import json

    fresh_game.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    fresh_game.apply({"type": "bestiary_upsert", "name": "Goblin"})
    fresh_game.apply({"type": "ally_upsert", "name": "Gardist"})

    # Versehentlich alles löschen ...
    fresh_game.apply({"type": "roster_delete", "id": fresh_game.roster[-1]["id"]})
    fresh_game.apply({"type": "bestiary_delete", "id": fresh_game.bestiary[-1]["id"]})
    fresh_game.apply({"type": "ally_delete", "id": fresh_game.allies[-1]["id"]})
    assert fresh_game.roster == [] and fresh_game.bestiary == [] and fresh_game.allies == []

    # ... und dreimal rückgängig machen.
    for _ in range(3):
        fresh_game.apply({"type": "undo"})

    assert [r["name"] for r in fresh_game.roster] == ["Korgo"]
    assert [b["name"] for b in fresh_game.bestiary] == ["Goblin"]
    assert [a["name"] for a in fresh_game.allies] == ["Gardist"]

    # Und die Dateien auf Platte müssen dazu passen (sonst ist es nach dem
    # nächsten Start wieder weg).
    assert json.loads(gmod.ROSTER_FILE.read_text(encoding="utf-8"))[0]["name"] == "Korgo"
    assert json.loads(gmod.BESTIARY_FILE.read_text(encoding="utf-8"))[0]["name"] == "Goblin"
    assert json.loads(gmod.ALLIES_FILE.read_text(encoding="utf-8"))[0]["name"] == "Gardist"


def test_extra_has_two_wounds_max(fresh_game):
    """Statisten vertragen 2 Wunden, die dritte schaltet aus (Wild Cards: 3)."""
    extra = _add_npc(fresh_game, "Statist", wildcard=False)
    fresh_game.apply({"type": "set_status", "id": extra["id"], "wounds": 2})
    st = fresh_game._combatant(extra["id"])["status"]
    assert st["wounds"] == 2 and st["out"] is False
    fresh_game.apply({"type": "set_status", "id": extra["id"], "wounds": 3})
    st = fresh_game._combatant(extra["id"])["status"]
    assert st["wounds"] == 2 and st["out"] is True     # dritte Wunde -> K.O.

    wc = _add_npc(fresh_game, "Boss", wildcard=True)
    fresh_game.apply({"type": "set_status", "id": wc["id"], "wounds": 3})
    st = fresh_game._combatant(wc["id"])["status"]
    assert st["wounds"] == 3 and st["out"] is False     # Wild Card haelt 3 aus


def test_apply_hit_chain_for_extra(fresh_game):
    c = _add_npc(fresh_game, "Statist", wildcard=False)
    cid = c["id"]
    fresh_game.apply({"type": "apply_hit", "id": cid})          # angeschlagen
    assert fresh_game._combatant(cid)["status"]["shaken"] is True
    fresh_game.apply({"type": "apply_hit", "id": cid})          # 1. Wunde
    fresh_game.apply({"type": "apply_hit", "id": cid})          # 2. Wunde
    st = fresh_game._combatant(cid)["status"]
    assert st["wounds"] == 2 and st["out"] is False
    fresh_game.apply({"type": "apply_hit", "id": cid})          # 3. -> ausgeschaltet
    st = fresh_game._combatant(cid)["status"]
    assert st["wounds"] == 2 and st["out"] is True


def test_hold_allowed_for_everyone(fresh_game):
    """In Savage Worlds darf JEDE Figur abwarten – nicht nur Joker-Halter."""
    a = _add_npc(fresh_game, "Ohne Joker")
    fresh_game.apply({"type": "new_round"})
    assert fresh_game._combatant(a["id"])["card"] is not None
    fresh_game.apply({"type": "hold", "id": a["id"]})
    assert fresh_game._combatant(a["id"])["held"] is True
    fresh_game.apply({"type": "intervene", "id": a["id"]})
    assert fresh_game._combatant(a["id"])["held"] is False
    assert fresh_game.active_id == a["id"]


def test_conditions_toggle_is_reported_and_saved(fresh_game):
    """Der Zustaende-Schalter muss im Snapshot stehen (sonst springt die Checkbox
    in der Oberflaeche sofort zurueck) UND in den Einstellungen landen."""
    from server import game as gmod
    import json

    snap = fresh_game.snapshot()
    assert snap["conditionsEnabled"] is True
    assert snap["conditions"]                      # Zustaende sichtbar

    fresh_game.apply({"type": "set_conditions_enabled", "on": False})
    snap = fresh_game.snapshot()
    assert snap["conditionsEnabled"] is False      # <- das fehlte und war der Bug
    assert snap["conditions"] == {}                # ueberall ausgeblendet

    # Dauerhaft: steht in settings.json und ueberlebt einen Neustart
    saved = json.loads(gmod.SETTINGS_FILE.read_text(encoding="utf-8"))
    assert saved["conditionsEnabled"] is False

    fresh_game.apply({"type": "set_conditions_enabled", "on": True})
    assert fresh_game.snapshot()["conditionsEnabled"] is True


def test_requests_can_be_switched_off(fresh_game):
    """Der SL kann Anfragen ganz abschalten: Schalter wird gemeldet+gespeichert,
    offene Anfragen verschwinden, und neue werden serverseitig abgewiesen."""
    from server import game as gmod
    import json

    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    fresh_game.apply({"type": "add_from_roster", "id": fresh_game.roster[-1]["id"]})
    cid = fresh_game.combatants[-1]["id"]

    assert fresh_game.snapshot()["requestsEnabled"] is True
    fresh_game.apply({"type": "request", "combatantId": cid, "kind": "benny",
                      "detail": {"delta": -1}, "label": "Benny"})
    assert len(fresh_game.requests) == 1

    fresh_game.apply({"type": "set_requests_enabled", "on": False})
    assert fresh_game.snapshot()["requestsEnabled"] is False
    assert fresh_game.requests == []                     # offene weggeraeumt
    assert json.loads(gmod.SETTINGS_FILE.read_text(encoding="utf-8"))["requestsEnabled"] is False

    # Ein veralteter Client darf nichts durchdruecken
    fresh_game.apply({"type": "request", "combatantId": cid, "kind": "benny",
                      "detail": {"delta": -1}, "label": "Benny"})
    assert fresh_game.requests == []

    fresh_game.apply({"type": "set_requests_enabled", "on": True})
    fresh_game.apply({"type": "request", "combatantId": cid, "kind": "benny",
                      "detail": {"delta": -1}, "label": "Benny"})
    assert len(fresh_game.requests) == 1


def test_datenordner_weicht_aus_statt_abzustuerzen(tmp_path, monkeypatch):
    r"""Nicht beschreibbarer Ort (App in C:\Programme / direkt aus dem Zip):
    die App muss ausweichen, nicht abstuerzen - sonst gibt es nicht mal ein Log."""
    from server import game
    gesperrt = tmp_path / "gesperrt"
    monkeypatch.setattr(game, "_dir_beschreibbar",
                        lambda p: "gesperrt" not in str(p))
    monkeypatch.setenv("SWI_DATA_DIR", str(gesperrt))
    ordner, ausgewichen = game._waehle_data_dir()

    assert "gesperrt" not in str(ordner)          # nicht der gesperrte Ort
    assert ausgewichen == str(gesperrt)           # und der Grund ist vermerkt


def test_datenordner_normal_ohne_hinweis(tmp_path, monkeypatch):
    """Beschreibbarer Ort: genau der wird genommen, ohne Ausweich-Hinweis."""
    from server import game
    monkeypatch.setenv("SWI_DATA_DIR", str(tmp_path / "daten"))
    ordner, ausgewichen = game._waehle_data_dir()

    assert ordner == tmp_path / "daten"
    assert ausgewichen is None


def _korgio(g):
    g.apply({"type": "roster_upsert", "name": "Korgio", "isWildCard": True})
    return g.roster[-1]["id"]


def test_wiederbeitritt_uebernimmt_figur_statt_zu_verdoppeln(fresh_game):
    """Kalle fliegt raus und waehlt Korgio erneut: Korgio darf NICHT zweimal
    auf dem Feld stehen - die vorhandene Figur wird uebernommen."""
    g = fresh_game
    cid = _korgio(g)
    erster = g.register_player("Kalle", character_id=cid, existing_player_id=None)
    figur = next(c for c in g.combatants if c.get("characterId") == cid)
    figur["wounds"] = 2                      # im Kampf schon Schaden kassiert
    g.set_player_connected(erster["id"], False)

    # Neuer Beitritt OHNE bekannte Spieler-ID (Speicher weg / rausgeflogen)
    zweiter = g.register_player("Kalle", character_id=cid, existing_player_id=None)

    figuren = [c for c in g.combatants if c.get("characterId") == cid]
    assert len(figuren) == 1                 # nicht verdoppelt
    assert figuren[0]["id"] == figur["id"]   # dieselbe Figur ...
    assert figuren[0]["wounds"] == 2         # ... mitsamt ihrem Zustand
    assert figuren[0]["playerId"] == zweiter["id"]
    assert erster["id"] not in [p["id"] for p in g.players]   # Karteileiche weg


def test_wiederbeitritt_nimmt_niemandem_die_figur_weg(fresh_game):
    """Ist der alte Spieler noch verbunden, bleibt sein Eintrag bestehen."""
    g = fresh_game
    cid = _korgio(g)
    erster = g.register_player("Kalle", character_id=cid, existing_player_id=None)

    g.register_player("Kalle (Zweitgeraet)", character_id=cid, existing_player_id=None)

    assert erster["id"] in [p["id"] for p in g.players]
    assert len([c for c in g.combatants if c.get("characterId") == cid]) == 1


def test_gast_beitritt_unveraendert(fresh_game):
    """Gaeste (ohne Charakter) bekommen weiterhin jeweils eine eigene Figur."""
    g = fresh_game
    g.register_player("Gast A", character_id=None, existing_player_id=None)
    g.register_player("Gast B", character_id=None, existing_player_id=None)
    assert len(g.combatants) == 2


def test_gleiche_gegner_werden_durchnummeriert(fresh_game):
    """Drei Orks sollen 'Ork 1', 'Ork 2', 'Ork 3' heissen - auch der erste."""
    g = fresh_game
    _add_npc(g, "Ork")
    assert g.combatants[-1]["name"] == "Ork"          # allein: keine Nummer
    _add_npc(g, "Ork")
    _add_npc(g, "Ork")
    namen = [c["name"] for c in g.combatants]
    assert namen == ["Ork 1", "Ork 2", "Ork 3"]       # der erste zieht nach


def test_nummerierung_stoert_andere_namen_nicht(fresh_game):
    g = fresh_game
    _add_npc(g, "Ork"); _add_npc(g, "Skree"); _add_npc(g, "Ork")
    assert [c["name"] for c in g.combatants] == ["Ork 1", "Skree", "Ork 2"]


def test_nummerierung_zaehlt_nach_dem_entfernen_weiter(fresh_game):
    """Ork 2 stirbt, der naechste wird Ork 3 - keine doppelten Nummern."""
    g = fresh_game
    for _ in range(3):
        _add_npc(g, "Ork")
    zweiter = next(c for c in g.combatants if c["name"] == "Ork 2")
    g.apply({"type": "remove_combatant", "id": zweiter["id"]})
    _add_npc(g, "Ork")
    namen = sorted(c["name"] for c in g.combatants)
    assert namen == ["Ork 1", "Ork 3", "Ork 4"]


def test_mehrere_gegner_auf_einmal(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "count": 3})
    assert [c["name"] for c in g.combatants] == ["Ork 1", "Ork 2", "Ork 3"]


def test_verdeckter_gegner_versteckt_den_namen_vor_spielern(fresh_game):
    """Der SL markiert einen Gegner als verdeckt - Spieler sehen einen
    Tarnnamen, und der echte Name verlaesst den Laptop gar nicht erst."""
    g = fresh_game
    _add_npc(g, "Schreckenswurm")
    g.apply({"type": "set_anon", "id": g.combatants[0]["id"], "on": True})

    sl = g.snapshot()
    spieler = g.snapshot(fuer_spieler=True)

    assert sl["combatants"][0]["name"] == "Schreckenswurm"
    getarnt = spieler["combatants"][0]
    assert getarnt["name"] != "Schreckenswurm"
    assert getarnt["anon"] is True
    assert "Schreckenswurm" not in json.dumps(spieler)


def test_verdeckt_gilt_nur_fuer_den_markierten_gegner(fresh_game):
    g = fresh_game
    _add_npc(g, "Ork")
    _add_npc(g, "Schattenkralle")
    g.apply({"type": "set_anon", "id": g.combatants[1]["id"], "on": True})

    namen = [c["name"] for c in g.snapshot(fuer_spieler=True)["combatants"]]
    assert namen[0] == "Ork"                    # bleibt sichtbar
    assert namen[1] != "Schattenkralle"         # ist verdeckt


def test_verdeckt_beim_anlegen_waehlbar(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Etwas Grosses", "anon": True})
    assert g.combatants[0]["anon"] is True
    assert "Etwas Grosses" not in json.dumps(g.snapshot(fuer_spieler=True))


def test_wieder_aufdecken(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "anon": True})
    g.apply({"type": "set_anon", "id": g.combatants[0]["id"], "on": False})
    assert g.snapshot(fuer_spieler=True)["combatants"][0]["name"] == "Ork"


def test_tarnname_bleibt_gleich(fresh_game):
    """Sonst flackert die Zeile bei jeder Aktualisierung."""
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "anon": True})
    assert g.snapshot(fuer_spieler=True)["combatants"][0]["name"] ==            g.snapshot(fuer_spieler=True)["combatants"][0]["name"]


def test_spieler_bekommen_das_bestiarium_nie(fresh_game):
    """Sonst stuenden die echten Namen dort weiterhin drin."""
    g = fresh_game
    g.apply({"type": "bestiary_upsert", "name": "Schreckenswurm"})
    assert g.snapshot(fuer_spieler=True)["bestiary"] == []
    assert g.snapshot()["bestiary"][0]["name"] == "Schreckenswurm"


def test_ohne_markierung_bleiben_namen_sichtbar(fresh_game):
    g = fresh_game
    _add_npc(g, "Ork")
    assert g.snapshot(fuer_spieler=True)["combatants"][0]["name"] == "Ork"


# --- Gruppen: mehrere Figuren gemeinsam bewegen ----------------------------

def _drei_orks(g):
    g.apply({"type": "add_npc", "name": "Ork", "count": 3, "zone": 4})
    return [c["id"] for c in g.combatants]


def test_gruppe_anlegen_und_gemeinsam_bewegen(fresh_game):
    g = fresh_game
    ids = _drei_orks(g)
    g.apply({"type": "group_create", "name": "Ork-Trupp", "ids": ids})
    gid = g.groups[0]["id"]

    g.apply({"type": "group_move", "group": gid, "zone": 2})

    assert [c["zone"] for c in g.combatants] == [2, 2, 2]
    assert g.groups[0]["name"] == "Ork-Trupp"


def test_gruppe_bewegt_nur_ihre_mitglieder(fresh_game):
    g = fresh_game
    ids = _drei_orks(g)
    _add_npc(g, "Einzelgaenger", zone=4)
    g.apply({"type": "group_create", "ids": ids[:2]})
    gid = g.groups[0]["id"]

    g.apply({"type": "group_move", "group": gid, "zone": 1})

    zonen = [c["zone"] for c in g.combatants]
    assert zonen == [1, 1, 4, 4]          # dritter Ork und Einzelgaenger bleiben


def test_pausierte_bleiben_beim_gruppenzug_stehen(fresh_game):
    g = fresh_game
    ids = _drei_orks(g)
    g.apply({"type": "group_create", "ids": ids})
    gid = g.groups[0]["id"]
    g.apply({"type": "bench", "id": ids[1], "on": True})

    g.apply({"type": "group_move", "group": gid, "zone": 0})

    assert [c["zone"] for c in g.combatants] == [0, 4, 0]


def test_figur_ist_immer_nur_in_EINER_gruppe(fresh_game):
    g = fresh_game
    ids = _drei_orks(g)
    g.apply({"type": "group_create", "name": "A", "ids": [ids[0]]})
    g.apply({"type": "group_create", "name": "B"})
    a, b = g.groups[0]["id"], g.groups[1]["id"]

    g.apply({"type": "group_assign", "id": ids[0], "group": b})

    assert g._mitglieder(a) == []
    assert [c["id"] for c in g._mitglieder(b)] == [ids[0]]


def test_gruppe_aufloesen_laesst_die_figuren_im_kampf(fresh_game):
    g = fresh_game
    ids = _drei_orks(g)
    g.apply({"type": "group_create", "ids": ids})
    gid = g.groups[0]["id"]

    g.apply({"type": "group_delete", "group": gid})

    assert g.groups == []
    assert len(g.combatants) == 3
    assert all(c.get("groupId") is None for c in g.combatants)


def test_gruppen_ueberleben_neustart_und_undo(fresh_game):
    g = fresh_game
    ids = _drei_orks(g)
    g.apply({"type": "group_create", "name": "Ork-Trupp", "ids": ids})
    g.save_session()

    g.groups = []                      # so, als waere die App neu gestartet
    g.combatants = []
    assert g.resume_session()
    assert g.groups[0]["name"] == "Ork-Trupp"
    assert len(g._mitglieder(g.groups[0]["id"])) == 3

    g.apply({"type": "group_delete", "group": g.groups[0]["id"]})
    g.apply({"type": "undo"})
    assert g.groups and g.groups[0]["name"] == "Ork-Trupp"


def test_verwaiste_zuordnung_wird_beim_laden_geloest(fresh_game):
    """Alte Sitzung mit geloeschter Gruppe darf keine Karteileiche hinterlassen."""
    g = fresh_game
    _drei_orks(g)
    for c in g.combatants:
        c["groupId"] = "grp-gibtsnichtmehr"
    g.save_session()
    g.resume_session()
    assert all(c["groupId"] is None for c in g.combatants)


# --- Bilder aufraeumen -----------------------------------------------------

def test_verwaiste_bilder_erkennen(fresh_game, tmp_path, monkeypatch):
    """Nur Bilder loeschen, auf die WIRKLICH nichts mehr zeigt."""
    from server import game as gm
    ordner = tmp_path / "uploads"
    ordner.mkdir()
    monkeypatch.setattr(gm, "UPLOAD_DIR", ordner)
    for name in ["benutzt.png", "im_bestiarium.png", "in_begegnung.png", "verwaist.png"]:
        (ordner / name).write_bytes(b"x" * 10)

    g = fresh_game
    _add_npc(g, "Ork")
    g.combatants[0]["image"] = "/uploads/benutzt.png"
    g.bestiary.append({"id": "b1", "name": "Skree", "image": "/uploads/im_bestiarium.png"})
    g.encounters.append({"id": "e1", "name": "Hinterhalt",
                         "members": [{"name": "Wache", "image": "/uploads/in_begegnung.png"}]})

    verwaist = [p.name for p in g.verwaiste_bilder()]
    assert verwaist == ["verwaist.png"]


def test_aufraeumen_loescht_nur_verwaiste(fresh_game, tmp_path, monkeypatch):
    from server import game as gm
    ordner = tmp_path / "uploads"
    ordner.mkdir()
    monkeypatch.setattr(gm, "UPLOAD_DIR", ordner)
    (ordner / "behalten.png").write_bytes(b"x" * 100)
    (ordner / "weg.png").write_bytes(b"x" * 250)

    g = fresh_game
    _add_npc(g, "Ork")
    g.combatants[0]["image"] = "/uploads/behalten.png"

    ergebnis = g.bilder_aufraeumen()

    assert ergebnis["geloescht"] == 1
    assert ergebnis["bytes"] == 250
    assert (ordner / "behalten.png").exists()
    assert not (ordner / "weg.png").exists()


# --- Zuege automatisch freigeben -------------------------------------------

def test_ohne_auto_freigabe_wartet_die_runde(fresh_game):
    g = fresh_game
    _add_npc(g, "Ork"); _add_npc(g, "Skree")
    g.apply({"type": "deal"})
    g.apply({"type": "release"})
    g.apply({"type": "confirm_turn"})
    assert g.phase == "gate"          # SL muss freigeben
    assert g.timer_ends_at is None


def test_mit_auto_freigabe_laeuft_der_naechste_zug_sofort(fresh_game):
    g = fresh_game
    _add_npc(g, "Ork"); _add_npc(g, "Skree")
    g.apply({"type": "set_auto_release", "on": True})
    g.apply({"type": "deal"})
    g.apply({"type": "release"})
    g.apply({"type": "confirm_turn"})
    assert g.phase == "running"       # kein Klick noetig
    assert g.timer_ends_at is not None


def test_auto_freigabe_stoppt_am_rundenende(fresh_game):
    """Ist niemand mehr dran, darf nicht ins Leere weitergeschaltet werden."""
    g = fresh_game
    _add_npc(g, "Ork")
    g.apply({"type": "set_auto_release", "on": True})
    g.apply({"type": "deal"})
    g.apply({"type": "release"})
    g.apply({"type": "confirm_turn"})
    assert g.active_id is None
    assert g.phase == "gate"


# --- Mehrfachauswahl: mehrere Figuren auf einmal umsetzen -------------------

def test_mehrere_auf_einmal_umsetzen(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "count": 4, "zone": 4})
    ids = [c["id"] for c in g.combatants[:3]]

    g.apply({"type": "set_zone_many", "ids": ids, "zone": 1})

    assert [c["zone"] for c in g.combatants] == [1, 1, 1, 4]


def test_umsetzen_ist_EIN_schritt_fuers_rueckgaengig(fresh_game):
    """Sonst muesste der SL viermal auf Rueckgaengig klicken."""
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "count": 3, "zone": 4})
    ids = [c["id"] for c in g.combatants]

    g.apply({"type": "set_zone_many", "ids": ids, "zone": 0})
    assert [c["zone"] for c in g.combatants] == [0, 0, 0]

    g.apply({"type": "undo"})
    assert [c["zone"] for c in g.combatants] == [4, 4, 4]


def test_pausierte_und_ausgeschaltete_bleiben_stehen(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "count": 3, "zone": 4})
    ids = [c["id"] for c in g.combatants]
    g.apply({"type": "bench", "id": ids[1], "on": True})
    g.apply({"type": "set_status", "id": ids[2], "out": True})

    g.apply({"type": "set_zone_many", "ids": ids, "zone": 0})

    assert [c["zone"] for c in g.combatants] == [0, 4, 4]


def test_unbekannte_ids_stoeren_nicht(fresh_game):
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "zone": 4})
    echte = g.combatants[0]["id"]
    g.apply({"type": "set_zone_many", "ids": [echte, "gibtsnicht"], "zone": 2})
    assert g.combatants[0]["zone"] == 2


def test_gruppenzug_laesst_ausgeschaltete_stehen(fresh_game):
    """Deckt den Fehler ab, dass 'out' im Status-Objekt liegt: ausgeschaltete
    Gegner sind beim Gruppenzug mitgewandert."""
    g = fresh_game
    g.apply({"type": "add_npc", "name": "Ork", "count": 3, "zone": 4})
    ids = [c["id"] for c in g.combatants]
    g.apply({"type": "group_create", "ids": ids})
    g.apply({"type": "set_status", "id": ids[2], "out": True})

    g.apply({"type": "group_move", "group": g.groups[0]["id"], "zone": 0})

    assert [c["zone"] for c in g.combatants] == [0, 0, 4]


# --- Charakter darf niemandem weggenommen werden ---------------------------

def test_aktiv_gespielter_charakter_gilt_als_belegt(fresh_game):
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgio", "isWildCard": True})
    cid = g.roster[-1]["id"]
    g.register_player("Kalle", character_id=cid, existing_player_id=None)

    assert g.charakter_aktiv_belegt(cid) == "Korgio"


def test_getrennter_spieler_blockiert_nicht(fresh_game):
    """Genau dafuer ist die Uebernahme da: Verbindung weg oder Speicher leer."""
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgio", "isWildCard": True})
    cid = g.roster[-1]["id"]
    p = g.register_player("Kalle", character_id=cid, existing_player_id=None)
    g.set_player_connected(p["id"], False)

    assert g.charakter_aktiv_belegt(cid) is None


def test_eigener_wiederbeitritt_blockiert_sich_nicht_selbst(fresh_game):
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgio", "isWildCard": True})
    cid = g.roster[-1]["id"]
    p = g.register_player("Kalle", character_id=cid, existing_player_id=None)

    assert g.charakter_aktiv_belegt(cid, ausser_player_id=p["id"]) is None


def test_freier_charakter_ist_nicht_belegt(fresh_game):
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgio", "isWildCard": True})
    assert g.charakter_aktiv_belegt(g.roster[-1]["id"]) is None


def test_alle_aus_der_bibliothek_bekommen_das_bild(fresh_game):
    """Das Bild wurde frueher NACH dem Anlegen auf combatants[-1] gesetzt -
    bei 'Anzahl 3' bekam damit nur der letzte Gegner ein Portraet."""
    g = fresh_game
    g.apply({"type": "bestiary_upsert", "name": "Ork"})
    g.bestiary[-1]["image"] = "/uploads/ork.png"

    g.apply({"type": "add_npc_from_bestiary", "id": g.bestiary[-1]["id"], "count": 3})

    assert [c["image"] for c in g.combatants] == ["/uploads/ork.png"] * 3
    assert [c["name"] for c in g.combatants] == ["Ork 1", "Ork 2", "Ork 3"]


def test_verbuendeter_behaelt_bild_und_seite(fresh_game):
    g = fresh_game
    g.apply({"type": "ally_upsert", "name": "Wache"})
    g.allies[-1]["image"] = "/uploads/wache.png"

    g.apply({"type": "add_ally_from_library", "id": g.allies[-1]["id"]})

    c = g.combatants[-1]
    assert c["ally"] is True
    assert c["image"] == "/uploads/wache.png"
    assert c["zone"] == 1          # DEFAULT_ZONE_PLAYER


# --- Beitritt mit veralteter Charakter-ID (Stefans Fall "Korgo") -----------

def test_veraltete_charakter_id_wird_abgelehnt_statt_figurlos(fresh_game):
    """Eine ID aus einer frueheren Runde darf keinen Spieler OHNE Figur
    erzeugen - das Handy hing sonst in der Beitrittsschleife."""
    g = fresh_game
    anzahl_vorher = len(g.players)
    ergebnis = g.register_player("Seppl", character_id="char-gibtsnichtmehr",
                                 existing_player_id="plr-vonfrueher")
    assert ergebnis is None
    assert len(g.players) == anzahl_vorher        # keine Karteileiche


def test_nach_ablehnung_klappt_der_richtige_charakter(fresh_game):
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    korgo = g.roster[-1]["id"]
    g.register_player("Seppl", character_id="char-gibtsnichtmehr",
                      existing_player_id="plr-vonfrueher")

    p = g.register_player("Seppl", character_id=korgo, existing_player_id=None)

    meine = [c for c in g.combatants if c.get("playerId") == p["id"]]
    assert [c["name"] for c in meine] == ["Korgo"]


def test_bekannter_spieler_ohne_figur_bekommt_die_gewaehlte(fresh_game):
    """Der zweite Teil des Fehlers: Wer als Spieler bekannt war, aber keine
    Figur hatte, bekam bei erneutem Beitritt die gewaehlte Figur NICHT -
    der Wiederbeitritt kehrte vorher einfach zurueck."""
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    korgo = g.roster[-1]["id"]
    # Spieler ohne Figur (so, wie ihn der alte Fehler hinterlassen hat)
    g.players.append({"id": "plr-ohne", "name": "Seppl", "connected": True,
                      "characterId": "char-alt"})

    p = g.register_player("Seppl", character_id=korgo, existing_player_id="plr-ohne")

    assert p["id"] == "plr-ohne"                  # derselbe Spieler ...
    meine = [c for c in g.combatants if c.get("playerId") == "plr-ohne"]
    assert [c["name"] for c in meine] == ["Korgo"]  # ... jetzt MIT Figur
    assert p["characterId"] == korgo


def test_wiederbeitritt_mit_figur_bleibt_unveraendert(fresh_game):
    """Gegenprobe: Hat der Spieler schon eine Figur, bleibt alles wie es war."""
    g = fresh_game
    g.apply({"type": "roster_upsert", "name": "Korgo", "isWildCard": True})
    korgo = g.roster[-1]["id"]
    p = g.register_player("Seppl", character_id=korgo, existing_player_id=None)
    figur = next(c for c in g.combatants if c.get("playerId") == p["id"])

    p2 = g.register_player("Seppl", character_id=korgo, existing_player_id=p["id"])

    assert p2["id"] == p["id"]
    assert [c["id"] for c in g.combatants if c.get("playerId") == p["id"]] == [figur["id"]]


def test_gast_ohne_charakter_weiterhin_moeglich(fresh_game):
    g = fresh_game
    p = g.register_player("Gast", character_id=None, existing_player_id=None)
    assert p is not None
    assert len([c for c in g.combatants if c.get("playerId") == p["id"]]) == 1


def test_player_sets_own_talents(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Tessa", "isWildCard": True})
    char = fresh_game.roster[-1]["id"]
    pid = fresh_game.register_player("Stefan", char, None)["id"]
    tessa = next(c for c in fresh_game.combatants if c["playerId"] == pid)
    undo_vorher = len(fresh_game._history)

    fresh_game.apply({"type": "talents_update", "id": tessa["id"],
                      "talents": ["schnell", "kuehler_kopf", "sehr_kuehler_kopf", "gibtsnicht"],
                      "gluck": True, "grosses_gluck": False})
    assert tessa["talents"] == ["schnell", "sehr_kuehler_kopf"]    # Unsinn raus, stärkeres gilt
    assert fresh_game.roster[-1]["talents"] == ["schnell", "sehr_kuehler_kopf"]
    assert fresh_game.roster[-1]["gluck"] is True
    assert len(fresh_game._history) == undo_vorher                  # kein Undo-Eintrag beim SL

    fresh_game.apply({"type": "new_round"})                         # „Schnell" wirkt beim Ziehen
    assert tessa["card"] is not None


def test_house_rule_extra_out_on_third_wound_wildcard_on_fourth(fresh_game):
    ork = _add_npc(fresh_game, "Ork", wildcard=False)
    boss = _add_npc(fresh_game, "Boss", wildcard=True)
    for c, raus_bei in ((ork, 3), (boss, 4)):
        fresh_game.apply({"type": "apply_hit", "id": c["id"]})          # erst Angeschlagen
        for wunde in range(1, raus_bei + 1):
            fresh_game.apply({"type": "apply_hit", "id": c["id"]})      # je +1 Wunde
            assert fresh_game._combatant(c["id"])["status"]["out"] is (wunde == raus_bei)


def test_gm_chooses_when_extras_are_out(fresh_game):
    for ko in (1, 2, 3):
        fresh_game.apply({"type": "set_statisten_ko", "value": ko})
        ork = _add_npc(fresh_game, f"Ork{ko}", wildcard=False)
        fresh_game.apply({"type": "apply_hit", "id": ork["id"]})          # Angeschlagen
        for wunde in range(1, ko + 1):
            fresh_game.apply({"type": "apply_hit", "id": ork["id"]})
            assert fresh_game._combatant(ork["id"])["status"]["out"] is (wunde == ko)
    assert fresh_game.snapshot()["statistenKo"] == 3
    # Wild-Card-Gegner bleiben unabhängig davon bei der 4. Wunde.
    fresh_game.apply({"type": "set_statisten_ko", "value": 1})
    boss = _add_npc(fresh_game, "Boss", wildcard=True)
    fresh_game.apply({"type": "set_status", "id": boss["id"], "wounds": 3})
    assert fresh_game._combatant(boss["id"])["status"]["out"] is False


def test_tv_bild_wird_nicht_aufgeraeumt(fresh_game, tmp_path):
    from server import game as gmod
    bild = gmod.UPLOAD_DIR / "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
    bild.write_bytes(b"png")
    fresh_game.apply({"type": "message", "target": "beamer", "text": "", "imageUrl": f"/uploads/{bild.name}"})
    assert bild.name in fresh_game.benutzte_bilder()      # liegt sichtbar auf dem TV
    fresh_game.bilder_aufraeumen()
    assert bild.exists()


def test_spieler_legt_charakter_selbst_an(fresh_game):
    char = fresh_game.charakter_anlegen("  Tessa  ")
    assert char["name"] == "Tessa" and char["isWildCard"] is True
    assert fresh_game.roster[-1]["id"] == char["id"]
    # Gleicher Name (auch anders geschrieben) -> derselbe Charakter, keine Dublette.
    assert fresh_game.charakter_anlegen("tessa")["id"] == char["id"]
    assert len(fresh_game.roster) == 1
    assert fresh_game.charakter_anlegen("   ") is None

    pid = fresh_game.register_player("Stefan", char["id"], None)["id"]
    assert any(c.get("playerId") == pid and c["name"] == "Tessa" for c in fresh_game.combatants)


def test_start_encounter_deals_and_brings_players_back(fresh_game):
    fresh_game.apply({"type": "roster_upsert", "name": "Held", "isWildCard": True})
    fresh_game.apply({"type": "add_from_roster", "id": fresh_game.roster[-1]["id"]})
    held = fresh_game.combatants[-1]
    fresh_game.apply({"type": "add_npc", "name": "Pirat", "isWildCard": False, "zone": 2, "count": 2})
    fresh_game.apply({"type": "save_encounter", "name": "Überfall"})
    enc = fresh_game.encounters[-1]["id"]
    for c in [c for c in fresh_game.combatants if c["name"].startswith("Pirat")]:
        fresh_game.apply({"type": "remove_combatant", "id": c["id"]})
    _add_npc(fresh_game, "Alter Gegner")          # steht noch vom letzten Kampf da
    fresh_game.apply({"type": "bench", "id": held["id"], "on": True})     # Spieler pausiert

    fresh_game.apply({"type": "start_encounter", "id": enc, "ersetzen": True})

    namen = [c["name"] for c in fresh_game.combatants]
    assert "Alter Gegner" not in namen                    # alte Gegner ersetzt
    assert "Held" in namen and len([n for n in namen if n.startswith("Pirat")]) == 2
    assert fresh_game._combatant(held["id"])["benched"] is False
    assert all(c["card"] for c in fresh_game.combatants)  # direkt ausgeteilt
    assert fresh_game.round == 1

    # Ohne "ersetzen" kommen die neuen Figuren zu den alten dazu.
    vorher = len(fresh_game.combatants)
    fresh_game.apply({"type": "start_encounter", "id": enc})
    assert len(fresh_game.combatants) == vorher + 2
