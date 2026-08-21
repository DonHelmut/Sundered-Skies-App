"""Karten-Deck, Savage-Worlds-Sortierung und Talent-Logik.

Reine Logik, keine Server-/Netzwerkabhängigkeiten – dadurch gut testbar.

Deck: 54 Karten (52 Standard + 2 Joker).
Sortierung: höherer Kartenwert zuerst, Farb-Tiebreak Pik > Herz > Karo > Kreuz.
Joker: schwarzer Joker schlägt roten. Wird ein Joker ausgeteilt, wird das Deck
neu aufgebaut (bereits gehaltene Karten bleiben erhalten).
"""

from __future__ import annotations

import random
from typing import Iterable, Optional

Card = dict  # {"id": str, "suit": str, "rank": str, "jokerColor": Optional[str]}

SUITS = ["spades", "hearts", "diamonds", "clubs"]
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]

RANK_VALUE = {
    "JOKER": 15, "A": 14, "K": 13, "Q": 12, "J": 11, "10": 10,
    "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2,
}

# Savage-Worlds-Tiebreak bei gleichem Kartenwert.
SUIT_VALUE = {"spades": 4, "hearts": 3, "diamonds": 2, "clubs": 1, "joker": 0}


def make_card(suit: str, rank: str, joker_color: Optional[str] = None) -> Card:
    if suit == "joker":
        return {"id": f"joker-{joker_color}", "suit": "joker", "rank": "JOKER",
                "jokerColor": joker_color}
    return {"id": f"{suit}-{rank}", "suit": suit, "rank": rank, "jokerColor": None}


def full_deck() -> list[Card]:
    """Baut ein frisches, vollständiges 54-Karten-Deck."""
    cards = [make_card(s, r) for s in SUITS for r in RANKS]
    cards.append(make_card("joker", "JOKER", "black"))
    cards.append(make_card("joker", "JOKER", "red"))
    return cards


def is_joker(card: Optional[Card]) -> bool:
    return bool(card) and card["rank"] == "JOKER"


def rank_num(card: Card) -> int:
    return RANK_VALUE[card["rank"]]


def card_value(card: Card) -> int:
    """Vergleichswert – je höher, desto früher in der Initiative."""
    value = RANK_VALUE[card["rank"]] * 10
    if card["suit"] == "joker":
        # Schwarzer Joker schlägt roten Joker.
        value += 2 if card.get("jokerColor") == "black" else 1
    else:
        value += SUIT_VALUE[card["suit"]]
    return value


def shuffle(cards: Iterable[Card]) -> list[Card]:
    out = list(cards)
    random.shuffle(out)
    return out


class DeckManager:
    """Verwaltet Ziehstapel + Ablage während eines Austeilvorgangs.

    Ist das Deck leer, wird die Ablage zurückgemischt. Wird ein Joker gezogen,
    merkt sich das der Manager (``joker_drawn``) – das eigentliche komplette
    Neumischen passiert regelkonform *vor der nächsten Runde* (nicht mitten im
    Austeilen), damit keine Karten verloren gehen.
    """

    def __init__(self, deck: list[Card], discard: list[Card]) -> None:
        self.deck = list(deck)
        self.discard = list(discard)
        self.joker_drawn = False

    def draw_one(self) -> Card:
        if not self.deck:
            # Ist das Deck leer, Ablage zurückmischen (Savage-Worlds-Standard).
            self.deck = shuffle(self.discard)
            self.discard = []
        if not self.deck:
            # Sollte praktisch nie passieren – Sicherheitsnetz gegen Absturz.
            self.deck = shuffle(full_deck())
        card = self.deck.pop()
        if is_joker(card):
            self.joker_drawn = True
        return card


# --- Talent-Logik ------------------------------------------------------------

# Talente, welche die tatsächliche Kartenausgabe verändern.
TALENT_DRAW = {"schnell", "kuehler_kopf", "sehr_kuehler_kopf", "zoegerlich"}


def _select(cards: list[Card], mode: str) -> Card:
    """Wählt die beizubehaltende Karte. Bei 'worst' überschreibt ein Joker die
    Regel (man handelt normal auf den Joker)."""
    jokers = [c for c in cards if is_joker(c)]
    if mode == "worst" and jokers:
        return max(jokers, key=card_value)
    if mode == "worst":
        return min(cards, key=card_value)
    return max(cards, key=card_value)


def deal_one_combatant(dm: DeckManager, talents: Iterable[str]) -> tuple[Card, list[Card]]:
    """Zieht die Initiativekarte für einen Teilnehmer unter Beachtung der
    kartenrelevanten Talente. Nicht behaltene Karten wandern in die Ablage.

    Gibt ``(kept, sequence)`` zurück: ``sequence`` = ALLE gezogenen Karten in
    Ziehreihenfolge (inkl. der bei „Schnell" nachgezogenen und der bei Kühler
    Kopf/Zögerlich mehrfach gezogenen) – für die schrittweise Aufdeck-Animation.
    ``kept`` ist immer Teil der Sequenz."""
    tset = set(talents)

    if "sehr_kuehler_kopf" in tset:
        count, mode = 3, "best"
    elif "kuehler_kopf" in tset:
        count, mode = 2, "best"
    elif "zoegerlich" in tset:
        count, mode = 2, "worst"
    else:
        count, mode = 1, "best"

    seq = [dm.draw_one() for _ in range(count)]
    kept = _select(seq, mode)
    for c in seq:
        if c["id"] != kept["id"]:
            dm.discard.append(c)

    # Schnell: Karten von 5 oder weniger abwerfen und neu ziehen, bis >5.
    if "schnell" in tset:
        while (not is_joker(kept)) and rank_num(kept) <= 5:
            dm.discard.append(kept)
            kept = dm.draw_one()
            seq.append(kept)

    return kept, seq


def sort_order(combatants: list[dict]) -> list[str]:
    """Gibt die Teilnehmer-IDs in Initiative-Reihenfolge zurück.
    Teilnehmer ohne Karte landen am Ende (nach Erstellungszeit)."""
    def key(c: dict):
        card = c.get("card")
        if card is None:
            return (0, -c.get("createdAt", 0))
        return (1, card_value(card))

    ordered = sorted(combatants, key=key, reverse=True)
    return [c["id"] for c in ordered]
