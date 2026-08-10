import type { SeatId } from "@sengoku-jidai/engine/client";

/** Minimal shape of the player view needed to decide who is on the clock. */
export interface ClockView {
  status: string;
  activeSeat: SeatId;
  pendingCombat: { responsibleSeat: SeatId } | null;
  pendingDecision: { seat: SeatId } | null;
}

/**
 * The seat on the clock, mirroring the engine's onTheClock precedence
 * (pendingCombat → pendingDecision → activeSeat). Returns null when the game is not active.
 *
 * Note: the player view redacts the opponent's pendingDecision, so from a human viewer this
 * resolves the AI's clock via pendingCombat (visible) or activeSeat — which is exactly what the
 * "Computer is thinking…" indicator needs.
 */
export function onClockSeat(view: ClockView): SeatId | null {
  if (view.status !== "active") return null;
  if (view.pendingCombat) return view.pendingCombat.responsibleSeat;
  if (view.pendingDecision) return view.pendingDecision.seat;
  return view.activeSeat;
}
