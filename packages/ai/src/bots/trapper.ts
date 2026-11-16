import { legalCommandsForState } from "@sengoku-jidai/engine";
import type { Bot, Command, GameState, SeatId } from "../types.js";
import { DEFAULT_WEIGHTS } from "../eval.js";
import { combatResponse } from "../heuristics.js";
import { alphaBetaCommand, type AlphaBetaOptions } from "./alphabeta.js";

/** Cards the trapper wants in hand before it stops drawing. */
const HAND_GOAL = 3;
/** It draws only this early in the game. */
const LAST_PLAN_ROUND = 2;

/**
 * A sparring partner that plays the card trap a human sets for the AI: the old alpha-beta bot,
 * except that it draws cards early, never discards an Ambush to reroll, and always answers an
 * Advance with an Ambush when it holds one.
 */
export class TrapperBot implements Bot {
  constructor(private readonly opts: AlphaBetaOptions = {}) {}

  chooseCommand(state: GameState, seat: SeatId): Command {
    const hand = state.players[seat].hand;
    const pc = state.pendingCombat;
    if (pc && pc.responsibleSeat === seat) {
      if (pc.phase === "awaiting-roll" && pc.kind === "advance" && hand.includes("ambush")) {
        return { type: "combatRoll", pendingId: pc.id, card: "ambush" };
      }
      const response = combatResponse(state, seat, this.opts.weights ?? DEFAULT_WEIGHTS);
      if (response?.type === "combatReroll" && response.card === "ambush") {
        const spare = hand.find((card) => card !== "ambush");
        return spare
          ? { type: "combatReroll", pendingId: pc.id, card: spare }
          : { type: "combatResolve", pendingId: pc.id };
      }
      if (response) return response;
    }
    if (!pc && !state.pendingDecision && state.activeSeat === seat) {
      if (state.round <= LAST_PLAN_ROUND && hand.length < HAND_GOAL) {
        const plan = legalCommandsForState(state, seat).plans[0];
        if (plan) return { type: "plan", spaceId: plan.spaceId };
      }
    }
    return alphaBetaCommand(state, seat, this.opts);
  }
}
