"""Reine Kartenlogik – deterministisch, ohne Zufall/IO."""
from server import engine as E


def test_full_deck_is_54_with_two_jokers():
    deck = E.full_deck()
    assert len(deck) == 54
    jokers = [c for c in deck if E.is_joker(c)]
    assert len(jokers) == 2
    assert {j["jokerColor"] for j in jokers} == {"black", "red"}


def test_card_value_higher_rank_wins():
    assert E.card_value(E.make_card("clubs", "A")) > E.card_value(E.make_card("spades", "K"))


def test_suit_tiebreak_spades_over_clubs():
    same_rank_spades = E.card_value(E.make_card("spades", "9"))
    same_rank_clubs = E.card_value(E.make_card("clubs", "9"))
    assert same_rank_spades > same_rank_clubs


def test_black_joker_beats_red_joker():
    assert E.card_value(E.make_card("joker", "JOKER", "black")) > \
           E.card_value(E.make_card("joker", "JOKER", "red"))


def test_joker_beats_ace():
    assert E.card_value(E.make_card("joker", "JOKER", "red")) > \
           E.card_value(E.make_card("spades", "A"))


def test_sort_order_higher_first_and_cardless_last():
    combatants = [
        {"id": "low", "card": E.make_card("clubs", "3")},
        {"id": "high", "card": E.make_card("spades", "A")},
        {"id": "none", "card": None, "createdAt": 5},
    ]
    order = E.sort_order(combatants)
    assert order[0] == "high"
    assert order[1] == "low"
    assert order[-1] == "none"


def test_deckmanager_flags_joker_drawn():
    dm = E.DeckManager([E.make_card("joker", "JOKER", "black")], [])
    dm.draw_one()
    assert dm.joker_drawn is True


def test_deckmanager_reshuffles_discard_when_empty():
    dm = E.DeckManager([], [E.make_card("hearts", "7")])
    card = dm.draw_one()          # Deck leer -> Ablage zurückmischen
    assert card["rank"] == "7"


def test_talent_schnell_never_keeps_five_or_lower():
    # Deck (oben = zuletzt gezogen): erst eine 4 (wird verworfen), dann eine K.
    deck = [E.make_card("clubs", "K"), E.make_card("clubs", "4")]
    dm = E.DeckManager(deck, [])
    kept, seq = E.deal_one_combatant(dm, ["schnell"])
    assert E.rank_num(kept) > 5
    assert len(seq) >= 2          # mindestens die verworfene 4 + die behaltene K


def test_talent_kuehler_kopf_keeps_best_of_two():
    deck = [E.make_card("spades", "K"), E.make_card("clubs", "2")]  # zieht 2, dann K
    dm = E.DeckManager(deck, [])
    kept, seq = E.deal_one_combatant(dm, ["kuehler_kopf"])
    assert kept["rank"] == "K"
    assert len(seq) == 2
