import { deckFor, type GameState, type OperationCard } from "@sengoku-jidai/engine";
import type { SeatId } from "../types.js";
import { HIDDEN, isRealCard } from "./hidden.js";

/** Cards nobody has shown yet, per kind: the ruleset's full deck minus every real card visible
 *  in `state` (both hands and the discard pile). Placeholders are ignored — they ARE this pool. */
export function unseenPool(state: GameState): Partial<Record<OperationCard, number>> {
  const pool: Partial<Record<OperationCard, number>> = {};
  for (const card of deckFor(state.rules.rulesetId)) pool[card] = (pool[card] ?? 0) + 1;
  const seen = [...state.players.red.hand, ...state.players.black.hand, ...state.discard];
  for (const card of seen) {
    if (isRealCard(card) && pool[card]) pool[card] = pool[card]! - 1;
  }
  return pool;
}

/** Probability that `holder` has at least one `card` among their placeholders, treating those
 *  placeholders as a uniform draw from the unseen pool: 1 − C(U−c, n) / C(U, n). A real `card`
 *  already in the hand is certain; a kind in `absent` (this line of search assumed they do not
 *  hold it) is impossible. */
export function holdProbability(
  state: GameState,
  holder: SeatId,
  card: OperationCard,
  absent: ReadonlySet<OperationCard>
): number {
  const hand = state.players[holder].hand;
  if (hand.includes(card)) return 1;
  if (absent.has(card)) return 0;
  const pool = unseenPool(state);
  const copies = pool[card] ?? 0;
  if (copies <= 0) return 0;
  let unseen = 0;
  for (const n of Object.values(pool)) unseen += n ?? 0;
  const drawn = Math.min(hand.filter((c) => c === HIDDEN).length, unseen);
  // C(U−c, n) / C(U, n) as a running product; a non-positive factor means no draw avoids the card.
  let miss = 1;
  for (let i = 0; i < drawn; i++) {
    const factor = (unseen - copies - i) / (unseen - i);
    if (factor <= 0) return 1;
    miss *= factor;
  }
  return 1 - miss;
}
