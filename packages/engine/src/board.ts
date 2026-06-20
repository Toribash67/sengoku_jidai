import type { GameState } from "./state.js";
import type { SupplyBoard } from "./supply.js";

/**
 * Bridge live `GameState.areas` into the `SupplyBoard` the supply/scoring layer
 * consumes. Control is derived (owner === seat), never stored separately.
 */
export function gameBoard(state: GameState): SupplyBoard {
  return { ownerOf: (areaId) => state.areas[areaId]?.owner ?? null };
}
