import type { GameState, SeatId } from "@sengoku-jidai/engine";

/**
 * The seat that must issue the next command in a stable state:
 * the combat/decision responsible seat when one is pending, otherwise the
 * active deploying seat. Returns null when the game is no longer active.
 * (Recall is processed automatically inside resolveCommand, so a stable state
 * is never waiting on a recall command.)
 */
export function onTheClock(state: GameState): SeatId | null {
  if (state.status !== "active") return null;
  if (state.pendingCombat) return state.pendingCombat.responsibleSeat;
  if (state.pendingDecision) return state.pendingDecision.seat;
  return state.activeSeat;
}
