import type { OperationCard } from "@sengoku-jidai/engine";

/** How long to hold on to each card kind when one must be discarded to reroll: higher is kept
 *  longer. Hand-set (defensive surprise cards rank highest); a tuning target for the eval work.
 *  "hidden" is a card of unknown identity (see hidden.ts), ranked as an average card. */
export const CARD_KEEP_RANK: Record<string, number> = {
  ambush: 5,
  take_cover: 5,
  ship_strike: 3,
  siege_assault: 3,
  ground_assault: 3,
  river_assault: 3,
  commandeer: 3,
  hidden: 3,
  counterattack: 2,
  mobilise: 2,
  shore_strike: 2,
  volley: 2
};

/** The card to discard for a reroll: the lowest-ranked in hand, first-seen on ties. */
export function cardToSpend(hand: readonly OperationCard[]): OperationCard | null {
  let best: OperationCard | null = null;
  for (const card of hand) {
    if (best === null || (CARD_KEEP_RANK[card] ?? 0) < (CARD_KEEP_RANK[best] ?? 0)) best = card;
  }
  return best;
}
