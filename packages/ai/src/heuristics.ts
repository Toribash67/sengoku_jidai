import type { Command, GameState, SeatId } from "@sengoku-jidai/engine";

/**
 * Fixed (non-searched) policy for the combat/decision nodes. v1 keeps this simple:
 * roll without spending a card, always resolve the reviewed roll, never reroll or
 * ambush, and answer a pending decision by declining when possible (else the first
 * choice — e.g. selectCombat, which has no decline). Returns null when nothing is
 * pending for `seat`.
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
