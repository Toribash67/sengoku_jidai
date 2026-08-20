import {
  getMap,
  resolveCommand,
  type Command,
  type GameState,
  type OperationCard,
  type SeatId
} from "@sengoku-jidai/engine";
import { rollTotalDistribution } from "./combatOdds.js";
import { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "./eval.js";

/**
 * Fixed (non-searched) policy for the combat/decision nodes, used for the search's INTERNAL
 * resolution (settle / rollouts) where cost matters: roll without spending a card, always resolve
 * the reviewed roll, never reroll or ambush, and answer a pending decision by declining when
 * possible (else the first choice — e.g. selectCombat, which has no decline). Returns null when
 * nothing is pending for `seat`. The bots' ACTUAL combat responses use `combatResponse` instead.
 */
export function resolvePending(state: GameState, seat: SeatId): Command | null {
  const pc = state.pendingCombat;
  if (pc && pc.responsibleSeat === seat) {
    if (pc.phase === "awaiting-roll") return { type: "combatRoll", pendingId: pc.id };
    if (pc.phase === "rolled") return { type: "combatResolve", pendingId: pc.id };
  }
  const pd = state.pendingDecision;
  if (pd && pd.seat === seat) {
    const decline = pd.choices.find((c) => c.id === "decline") ?? pd.choices[0]!;
    return { type: "choosePendingDecision", pendingId: pd.id, choice: decline };
  }
  return null;
}

/**
 * Eval-driven combat/decision policy for a bot's ACTUAL response (used at the root, not inside the
 * search — so it can afford a one-ply expected-value lookahead without inflating the search's hot
 * path). Plays the deploy AI's combat-time cards when they are worth it, valuing the card cost via
 * the eval's `card` term (spending a card lowers √hand, so a play must beat that). Falls back to
 * `resolvePending` for everything it does not special-case.
 */
export function combatResponse(
  state: GameState,
  seat: SeatId,
  weights: EvalWeights = DEFAULT_WEIGHTS
): Command | null {
  const pc = state.pendingCombat;
  if (pc && pc.responsibleSeat === seat) {
    if (pc.phase === "awaiting-roll") {
      // Ambush: the defender of a land Advance may add two defence dice (discarding the card).
      // Play it when the extra dice raise the expected outcome by more than the card's hold value.
      if (pc.kind === "advance" && state.players[seat].hand.includes("ambush")) {
        const fort = getMap(state.mapId).areas[pc.area]?.fort === true;
        const base = 1 + (fort ? 1 : 0);
        const without = expectedResolveValue(state, seat, base, weights);
        const with_ = expectedResolveValue(
          dropCard(state, seat, "ambush"),
          seat,
          base + 2,
          weights
        );
        if (with_ > without) return { type: "combatRoll", pendingId: pc.id, card: "ambush" };
      }
      return { type: "combatRoll", pendingId: pc.id };
    }
    if (pc.phase === "rolled") {
      // Reroll: if a spare card can be spent and the expected re-throw (same dice count, minus the
      // spent card) beats resolving the concrete current roll, discard a card and re-throw. This is
      // re-invoked on the fresh roll, so it naturally chains until resolving is best or cards run
      // out. The eval treats cards as interchangeable, so we spend the first in hand.
      const hand = state.players[seat].hand;
      if (hand.length > 0) {
        const nDice = pc.rolls?.length ?? 1;
        const resolveNow = resolveCommand(
          state,
          { seat },
          {
            type: "combatResolve",
            pendingId: pc.id
          }
        );
        const current =
          resolveNow.status === "accepted"
            ? evaluate(resolveNow.nextState, seat, weights)
            : -Infinity;
        const spend = hand[0]!;
        const rerollValue = expectedResolveValue(
          dropCard(state, seat, spend),
          seat,
          nDice,
          weights
        );
        if (rerollValue > current) return { type: "combatReroll", pendingId: pc.id, card: spend };
      }
      return { type: "combatResolve", pendingId: pc.id };
    }
  }

  // Ship Strike: after a Shell, the attacker may take a second Shell from the same space (spending
  // the card). Pick the offered choice — a target sea or Decline — with the best one-ply eval.
  const pd = state.pendingDecision;
  if (pd && pd.seat === seat && pd.kind === "shipStrike") {
    let best = pd.choices[0]!;
    let bestV = -Infinity;
    for (const choice of pd.choices) {
      const r = resolveCommand(
        state,
        { seat },
        {
          type: "choosePendingDecision",
          pendingId: pd.id,
          choice
        }
      );
      if (r.status !== "accepted") continue;
      const v = evaluate(r.nextState, seat, weights);
      if (v > bestV) {
        bestV = v;
        best = choice;
      }
    }
    return { type: "choosePendingDecision", pendingId: pd.id, choice: best };
  }

  return resolvePending(state, seat);
}

/** A copy of `state` with one `card` removed from `seat`'s hand (models the discard on play). */
function dropCard(state: GameState, seat: SeatId, card: OperationCard): GameState {
  const hand = state.players[seat].hand;
  const idx = hand.indexOf(card);
  if (idx < 0) return state;
  const next = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], hand: next } }
  };
}

/** Probability-weighted eval (from `seat`'s view) of resolving the pending combat with `nDice`
 *  defence/strike dice: drive the real engine's `combatResolve` on a forced total per outcome so
 *  the true turn tail (capture, caps, HQ-elimination, seat toggle) is reflected — matching what an
 *  actual roll would produce, only averaged. Pure (no RNG). */
function expectedResolveValue(
  state: GameState,
  seat: SeatId,
  nDice: number,
  weights: EvalWeights
): number {
  const pc = state.pendingCombat!;
  const faces = state.rules.diceFaces;
  let acc = 0;
  for (const { total, prob } of rollTotalDistribution(faces, nDice)) {
    const rolled: GameState = {
      ...state,
      pendingCombat: { ...pc, phase: "rolled", total, rolls: [total] }
    };
    const r = resolveCommand(
      rolled,
      { seat: pc.responsibleSeat },
      {
        type: "combatResolve",
        pendingId: pc.id
      }
    );
    if (r.status === "accepted") acc += prob * evaluate(r.nextState, seat, weights);
  }
  return acc;
}
