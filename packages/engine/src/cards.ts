import type { OperationCard } from "./state.js";

/**
 * The Rivers operation-card deck. Each id IS the artwork filename in `assets/maps/rivers/cards/`
 * (`<id>.png`), so the web needs no id→file mapping. Each kind has its own ability (deploy-time
 * and combat-time); additionally, any card may be discarded to reroll a combat's dice.
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

/**
 * The Fortress operation-card deck: the Rivers deck minus Ship Strike and Shore Strike, plus
 * the three Siege cards (Siege Assault, Take Cover, Volley). Artwork lives in `assets/maps/fortress/cards/` (`<id>.png`).
 */
export const FORTRESS_CARDS: readonly OperationCard[] = [
  "ambush",
  "commandeer",
  "counterattack",
  "ground_assault",
  "mobilise",
  "river_assault",
  "siege_assault",
  "take_cover",
  "volley"
];

/** Copies of each kind in the Fortress deck. With 9 kinds this makes a 27-card deck. */
export const FORTRESS_CARD_COPIES = 3;

export const FORTRESS_DECK: readonly OperationCard[] = FORTRESS_CARDS.flatMap((card) =>
  Array.from({ length: FORTRESS_CARD_COPIES }, () => card)
);

/** The unshuffled physical deck a ruleset plays with. */
export function deckFor(rulesetId: string): readonly OperationCard[] {
  return rulesetId === "fortress" ? FORTRESS_DECK : RIVERS_DECK;
}
