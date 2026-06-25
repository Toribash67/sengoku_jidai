import type { MapArea, MapDefinition } from "./maps/riversMap.js";
import type { SupplyBoard } from "./supply.js";
import { suppliedAreas } from "./supply.js";
import type { GameState, UnitType } from "./state.js";
import type { SeatId } from "./types.js";
import { buildActionSpaces } from "./actionSpaces.js";

/** Land areas hold troops; sea areas hold ships. */
export function unitKindFor(area: MapArea): UnitType {
  return area.kind === "land" ? "troop" : "ship";
}

/**
 * Legal Advance source land areas for moving troops into `targetId`:
 * land areas the seat supplies that are either adjacent to the target, or
 * adjacent to a water area the seat supplies that is itself adjacent to the target.
 */
export function advanceSources(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId,
  targetId: string
): Set<string> {
  const supplied = suppliedAreas(map, board, seat);
  const target = map.areas[targetId]!;
  const bridges = new Set(
    target.adjacent.filter((id) => map.areas[id]!.kind === "sea" && supplied.has(id))
  );
  const sources = new Set<string>();
  for (const id of supplied) {
    const a = map.areas[id]!;
    if (a.kind !== "land") continue;
    const adjToTarget = a.adjacent.includes(targetId);
    const adjToBridge = a.adjacent.some((n) => bridges.has(n));
    if (adjToTarget || adjToBridge) sources.add(id);
  }
  return sources;
}

/**
 * Water areas the seat supplies connected to `targetId` through an unbroken chain
 * of water areas the seat supplies (the target itself is excluded — you sail INTO it).
 */
export function sailReachable(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId,
  targetId: string
): Set<string> {
  const supplied = suppliedAreas(map, board, seat);
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const n of map.areas[targetId]!.adjacent) {
    if (map.areas[n]!.kind === "sea" && supplied.has(n)) {
      reachable.add(n);
      queue.push(n);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of map.areas[cur]!.adjacent) {
      if (!reachable.has(n) && map.areas[n]!.kind === "sea" && supplied.has(n)) {
        reachable.add(n);
        queue.push(n);
      }
    }
  }
  return reachable;
}

/** Land areas the seat supplies (Reinforce placement targets). */
export function reinforceTargets(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId
): Set<string> {
  const out = new Set<string>();
  for (const id of suppliedAreas(map, board, seat)) {
    if (map.areas[id]!.kind === "land") out.add(id);
  }
  return out;
}

/**
 * Embark placement targets: water areas the seat supplies, plus water reachable via a
 * supplied port (harbor land the seat supplies) that contains no enemy ships. With
 * `includeEnemyWaters` (the Commandeer card), ANY sea the opponent controls is also a target,
 * regardless of supply or port adjacency — placing there stages a sail-style battle (see
 * applyEmbark), so a ship can be landed straight into the enemy's waters.
 */
export function embarkTargets(
  map: MapDefinition,
  state: GameState,
  seat: SeatId,
  includeEnemyWaters = false
): Set<string> {
  const board: SupplyBoard = { ownerOf: (id) => state.areas[id]?.owner ?? null };
  const supplied = suppliedAreas(map, board, seat);
  const out = new Set<string>();
  for (const id of supplied) if (map.areas[id]!.kind === "sea") out.add(id);
  const enemy: SeatId = seat === "red" ? "black" : "red";
  for (const id of supplied) {
    const a = map.areas[id]!;
    if (!a.harbor) continue;
    for (const w of a.ports) {
      const rt = state.areas[w];
      const hasEnemyShips = rt?.owner === enemy && rt.units.ship > 0;
      if (!hasEnemyShips) out.add(w); // normal launch: own / neutral port water
    }
  }
  if (includeEnemyWaters) {
    for (const id of Object.keys(state.areas)) {
      if (map.areas[id]?.kind === "sea" && state.areas[id]!.owner === enemy) out.add(id);
    }
  }
  return out;
}

/** Land areas adjacent to a water area (Bombard targets). */
export function bombardTargets(map: MapDefinition, waterId: string): string[] {
  return map.areas[waterId]!.adjacent.filter((id) => map.areas[id]!.kind === "land");
}

/** Water areas adjacent to a land area (Shell targets). */
export function shellTargets(map: MapDefinition, landId: string): string[] {
  return map.areas[landId]!.adjacent.filter((id) => map.areas[id]!.kind === "sea");
}

/** Number of action spaces currently occupied by a seat. */
export function occupiedCount(state: GameState, seat: SeatId): number {
  return Object.values(state.actionSpaces).filter((o) => o === seat).length;
}

/** Commanders the seat can still deploy this round. Counterattack deploys onto an
 *  opponent-occupied space (so it never raises `occupiedCount`); it is tracked separately. */
export function available(state: GameState, seat: SeatId): number {
  const p = state.players[seat];
  return (
    p.commanders.total -
    occupiedCount(state, seat) -
    p.commanders.standby -
    p.commanders.counterattacks
  );
}

/** Whether the seat already occupies a support space of the given type this round. */
export function supportTypeOccupied(
  map: MapDefinition,
  state: GameState,
  seat: SeatId,
  type: "reinforce" | "embark" | "plan"
): boolean {
  const catalog = buildActionSpaces(map);
  return catalog.some((sp) => sp.type === type && state.actionSpaces[sp.id] === seat);
}
