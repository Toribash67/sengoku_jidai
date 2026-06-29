import type { SeatId } from "../../types.js";
import { areNeighbors, axialKey } from "./coords.js";
import type { Axial } from "./coords.js";
import type { HexMapSource } from "./source.js";

const SEATS: readonly SeatId[] = ["red", "black"];

/** Fail-fast structural validation. Throws on the first error found. */
export function validateHexMap(source: HexMapSource): void {
  const { tiles } = source;
  if (tiles.length === 0) {
    throw new Error("map has no tiles");
  }

  const ids = new Set<string>();
  const owner = new Map<string, string>(); // axialKey -> tileId
  for (const t of tiles) {
    if (ids.has(t.id)) {
      throw new Error(`duplicate tile id: ${t.id}`);
    }
    ids.add(t.id);
    if (t.hexes.length === 0) {
      throw new Error(`tile ${t.id} has no hexes`);
    }
    for (const h of t.hexes) {
      const k = axialKey(h);
      const existing = owner.get(k);
      if (existing) {
        throw new Error(`hex ${k} is in both ${existing} and ${t.id}`);
      }
      owner.set(k, t.id);
    }
    if (!isConnected(t.hexes)) {
      throw new Error(`tile ${t.id} is not edge-connected`);
    }
  }

  const hqBySeat = new Map<SeatId, string>();
  for (const t of tiles) {
    const hq = t.features.hq;
    if (hq === undefined) {
      continue;
    }
    if (!SEATS.includes(hq)) {
      throw new Error(`tile ${t.id} has unknown hq seat: ${String(hq)}`);
    }
    if (t.kind !== "land") {
      throw new Error(`hq tile ${t.id} must be land`);
    }
    if (hqBySeat.has(hq)) {
      throw new Error(`seat ${hq} has more than one hq`);
    }
    hqBySeat.set(hq, t.id);
  }

  for (const t of tiles) {
    if (!t.ports || t.ports.length === 0) {
      continue;
    }
    if (!t.features.harbor) {
      throw new Error(`tile ${t.id} has ports but is not a harbor`);
    }
    for (const id of t.ports) {
      const target = tiles.find((x) => x.id === id);
      if (!target) {
        throw new Error(`tile ${t.id} port references unknown tile ${id}`);
      }
      if (target.kind !== "sea") {
        throw new Error(`tile ${t.id} port ${id} is not sea`);
      }
    }
  }

  for (const id of source.bonusSlots) {
    if (!ids.has(id)) {
      throw new Error(`bonus slot references unknown tile ${id}`);
    }
  }
  for (const [id, units] of Object.entries(source.startingDeployment)) {
    if (!ids.has(id)) {
      throw new Error(`startingDeployment references unknown tile ${id}`);
    }
    if (!SEATS.includes(units.seat)) {
      throw new Error(`startingDeployment ${id} has unknown seat ${String(units.seat)}`);
    }
  }
}

/** True if the hexes form a single edge-connected component. */
function isConnected(hexes: Axial[]): boolean {
  if (hexes.length <= 1) {
    return true;
  }
  const seen = new Set<string>([axialKey(hexes[0]!)]);
  const stack: Axial[] = [hexes[0]!];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const h of hexes) {
      const k = axialKey(h);
      if (!seen.has(k) && areNeighbors(cur, h)) {
        seen.add(k);
        stack.push(h);
      }
    }
  }
  return seen.size === hexes.length;
}
