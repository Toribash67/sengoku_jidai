import { createRngState, type GameState, type OperationCard } from "@sengoku-jidai/engine";
import type { SeatId } from "../types.js";
import { other } from "../types.js";

/** A card whose identity the observer does not know. AI-side only: the engine's `OperationCard`
 *  union has no such member, and the engine only ever tests hands with includes/indexOf/length —
 *  so a placeholder counts toward hand size, can be discarded to reroll, and enables no ability. */
export const HIDDEN = "hidden" as OperationCard;

export function isRealCard(card: OperationCard): boolean {
  return card !== HIDDEN;
}

/** Everything `seat` is entitled to know, as an ordinary GameState: the opponent's hand and the
 *  deck become placeholders (sizes kept), and the rng is replaced by a constant. The single place
 *  the new search touches a full state — nothing downstream can read hidden information. */
export function observe(state: GameState, seat: SeatId): GameState {
  const enemy = other(seat);
  const clone = structuredClone(state) as GameState;
  clone.players[enemy].hand = clone.players[enemy].hand.map(() => HIDDEN);
  clone.deck = clone.deck.map(() => HIDDEN);
  clone.rngState = createRngState("observed");
  return clone;
}

/** A copy of `state` where one of `seat`'s placeholders is known to be `card` (the branch of the
 *  search that assumes they hold it). Null when that hand has no placeholder left. */
export function grantCard(state: GameState, seat: SeatId, card: OperationCard): GameState | null {
  const hand = state.players[seat].hand;
  const i = hand.indexOf(HIDDEN);
  if (i < 0) return null;
  const next = [...hand];
  next[i] = card;
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], hand: next } }
  };
}
