import type { Command, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";

/** Pass: deploy a commander to standby (unavailable until next round). */
export function applyPass(state: GameState, seat: SeatId): GameEvent[] {
  state.players[seat].commanders.standby += 1;
  state.players[seat].passed = true;
  return [{ type: "passed", seat }];
}

// Action mutators added in later tasks: applyReinforce, applyEmbark, applyPlan,
// applyAdvance, applySail, applyBombard, applyShell. Each mutates `state` and
// returns the events it produced. Dispatch lives in resolve.ts.
export type ActionDispatch = (state: GameState, seat: SeatId, command: Command) => GameEvent[];
