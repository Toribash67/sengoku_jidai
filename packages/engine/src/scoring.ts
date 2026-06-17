import type { MapDefinition } from "./maps/riversMap.js";
import type { SeatId } from "./types.js";
import { suppliedAreas, type SupplyBoard } from "./supply.js";

/** Total value stars on areas the seat supplies. */
export function victoryPoints(map: MapDefinition, board: SupplyBoard, seat: SeatId): number {
  let total = 0;
  for (const id of suppliedAreas(map, board, seat)) {
    total += map.areas[id]!.valueStars;
  }
  return total;
}

/** True if the seat has no units in its own HQ area (or has no HQ). */
export function hqEliminated(map: MapDefinition, board: SupplyBoard, seat: SeatId): boolean {
  const hq = Object.values(map.areas).find((a) => a.hq === seat);
  return !hq || board.ownerOf(hq.id) !== seat;
}

export interface GameEndContext {
  round: number;
  maxRounds: number;
  initiative: SeatId;
}

export interface GameEndResult {
  complete: boolean;
  winner: SeatId | null;
  endReason: "hqEliminated" | "victoryPoints" | null;
}

/**
 * Evaluate end conditions. Immediate loss on an eliminated HQ (checked first);
 * otherwise, once the final round is reached, score supplied VP with ties going
 * to the initiative holder.
 */
export function evaluateGameEnd(
  map: MapDefinition,
  board: SupplyBoard,
  ctx: GameEndContext
): GameEndResult {
  const redOut = hqEliminated(map, board, "red");
  const blackOut = hqEliminated(map, board, "black");
  if (redOut || blackOut) {
    // If both somehow fall at once, the initiative holder survives the tiebreak.
    const winner: SeatId = redOut && blackOut ? ctx.initiative : redOut ? "black" : "red";
    return { complete: true, winner, endReason: "hqEliminated" };
  }

  if (ctx.round < ctx.maxRounds) {
    return { complete: false, winner: null, endReason: null };
  }

  const redVp = victoryPoints(map, board, "red");
  const blackVp = victoryPoints(map, board, "black");
  const winner: SeatId = redVp === blackVp ? ctx.initiative : redVp > blackVp ? "red" : "black";
  return { complete: true, winner, endReason: "victoryPoints" };
}
