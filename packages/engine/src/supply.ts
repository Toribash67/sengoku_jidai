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

/** HQ area id per seat, cached per (immutable) `MapDefinition` — see actionSpaces.ts. */
const hqCache = new WeakMap<MapDefinition, Partial<Record<SeatId, string>>>();

/** The seat's HQ area id on this map, or undefined if the map has none for it. */
export function hqAreaId(map: MapDefinition, seat: SeatId): string | undefined {
  let hqs = hqCache.get(map);
  if (!hqs) {
    hqs = {};
    for (const a of Object.values(map.areas)) if (a.hq && !(a.hq in hqs)) hqs[a.hq] = a.id;
    hqCache.set(map, hqs);
  }
  return hqs[seat];
}

/**
 * Areas in supply for `seat`: the connected component of areas the seat controls
 * that contains the seat's HQ land area, walked over general adjacency.
 * Empty if the seat does not control its HQ.
 */
export function suppliedAreas(map: MapDefinition, board: SupplyBoard, seat: SeatId): Set<string> {
  const hq = hqAreaId(map, seat);
  const supplied = new Set<string>();
  if (!hq || board.ownerOf(hq) !== seat) {
    return supplied;
  }
  const queue: string[] = [hq];
  supplied.add(hq);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
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
