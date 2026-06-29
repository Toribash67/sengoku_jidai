import type { OperationCard } from "./state.js";

/**
 * The Rivers operation-card deck. Each id IS the artwork filename in `assets/maps/rivers/cards/`
 * (`<id>.png`), so the web needs no id→file mapping. Card-specific abilities are not yet
 * implemented; for now any card may be discarded to reroll a combat's dice.
 */
export const RIVERS_CARDS: readonly OperationCard[] = [
  "ambush",
  "commandeer",
  "counterattack",
  "ground_assault",
  "mobilise",
  "river_assault",
  "ship_strike",
  "shore_strike"
];

/** Copies of each kind in the physical deck. With 8 kinds this makes a 24-card deck. */
export const RIVERS_CARD_COPIES = 3;

/**
 * The physical Rivers deck: `RIVERS_CARD_COPIES` copies of each kind (24 cards), in a fixed
 * unshuffled order. A game shuffles this once at setup into the shared draw pile. `RIVERS_CARDS`
 * stays the canonical list of distinct kinds.
 */
export const RIVERS_DECK: readonly OperationCard[] = RIVERS_CARDS.flatMap((card) =>
  Array.from({ length: RIVERS_CARD_COPIES }, () => card)
);
