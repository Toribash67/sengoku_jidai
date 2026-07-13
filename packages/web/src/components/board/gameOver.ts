import type { EndReason, SeatId } from "@sengoku-jidai/engine/client";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

/** Title-case a seat id for display ("red" -> "Red"). */
export function capitalizeSeat(seat: SeatId): string {
  return seat === "red" ? "Red" : "Black";
}

/** Human sentence for why a game ended, shown on the game-over overlay. */
export function endReasonText(endReason: EndReason): string {
  return endReason === "hqEliminated"
    ? "Captured the enemy headquarters"
    : "Most supply points at the final round";
}

/** Display name for a seat: the player's chosen name, or the capitalized seat if unnamed. */
export function seatDisplayName(seat: SeatId, seatInfo: GameSeatInfo[]): string {
  return seatInfo.find((s) => s.seat === seat)?.name ?? capitalizeSeat(seat);
}
