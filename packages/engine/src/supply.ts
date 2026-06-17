import type { MapDefinition } from "./maps/riversMap.js";
import type { SeatId } from "./types.js";

/** Minimal read access the derivation layer needs: who has units in an area. */
export interface SupplyBoard {
  ownerOf(areaId: string): SeatId | null;
}

/** You control an area if you have at least one unit in it. */
export function controls(board: SupplyBoard, seat: SeatId, areaId: string): boolean {
  return board.ownerOf(areaId) === seat;
}

/**
 * Areas in supply for `seat`: the connected component of areas the seat controls
 * that contains the seat's HQ land area, walked over general adjacency.
 * Empty if the seat does not control its HQ.
 */
export function suppliedAreas(map: MapDefinition, board: SupplyBoard, seat: SeatId): Set<string> {
  const hq = Object.values(map.areas).find((a) => a.hq === seat);
  const supplied = new Set<string>();
  if (!hq || board.ownerOf(hq.id) !== seat) {
    return supplied;
  }
  const queue: string[] = [hq.id];
  supplied.add(hq.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbour of map.areas[current]!.adjacent) {
      if (!supplied.has(neighbour) && board.ownerOf(neighbour) === seat) {
        supplied.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return supplied;
}

export function inSupply(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId,
  areaId: string
): boolean {
  return suppliedAreas(map, board, seat).has(areaId);
}
