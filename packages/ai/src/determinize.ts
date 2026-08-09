import type { GameState, OperationCard, SeatId } from "@sengoku-jidai/engine";
import type { AiRng } from "./rng.js";
import { shuffle } from "./rng.js";
import { other } from "./types.js";

/**
 * Sample a full state consistent with `seat`'s information set: keep `seat`'s own hand,
 * the public discard, and all board state; re-draw the OPPONENT's hidden hand and the
 * deck order from the remaining (unseen) cards. Hand sizes and the total 24-card multiset
 * are preserved. The input is not mutated.
 */
export function determinize(state: GameState, seat: SeatId, rng: AiRng): GameState {
  const clone = structuredClone(state) as GameState;
  const enemy = other(seat);

  // Count all cards present in the state.
  const totalInState: Record<string, number> = {};
  const add = (c: OperationCard) => (totalInState[c] = (totalInState[c] ?? 0) + 1);
  for (const c of clone.players.red.hand) add(c);
  for (const c of clone.players.black.hand) add(c);
  for (const c of clone.deck) add(c);
  for (const c of clone.discard) add(c);

  // Unseen-from-seat pool = total cards minus what seat can see (own hand + discard).
  const pool = { ...totalInState };
  for (const c of clone.players[seat].hand) pool[c] = (pool[c] ?? 0) - 1;
  for (const c of clone.discard) pool[c] = (pool[c] ?? 0) - 1;

  // The unseen cards are exactly the opponent's hand plus the draw deck.
  const unseen: OperationCard[] = [];
  for (const card of Object.keys(pool) as OperationCard[]) {
    for (let i = 0; i < (pool[card] ?? 0); i++) unseen.push(card as OperationCard);
  }
  const shuffled = shuffle(rng, unseen);

  const enemyHandSize = clone.players[enemy].hand.length;
  clone.players[enemy].hand = shuffled.slice(0, enemyHandSize);
  clone.deck = shuffled.slice(enemyHandSize);
  return clone;
}
