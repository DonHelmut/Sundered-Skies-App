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
    assert fresh_game.import_data(data) is True
    assert [r["name"] for r in fresh_game.roster] == ["Held"]
    assert [b["name"] for b in fresh_game.bestiary] == ["Goblin"]


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
