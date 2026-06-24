import type { OperationCard } from "./state.js";

/**
 * The Rivers operation-card deck. Each id IS the artwork filename in `cards/rivers/`
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
