import type { SeatId } from "../../types.js";
import { areNeighbors, axialKey } from "./coords.js";
import type { Axial } from "./coords.js";
import type { HexMapSource } from "./source.js";
import { hasSiege, rulesetFor, RULESETS } from "../../rules.js";
import { CATAPULTS_PER_PLAYER } from "../../state.js";

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
    if (hq !== undefined) {
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

    if (t.features.fort && t.kind !== "land") {
      throw new Error(`fort tile ${t.id} must be land`);
    }
  }

  if (source.ruleset !== undefined && !Object.hasOwn(RULESETS, source.ruleset)) {
    throw new Error(`unknown ruleset ${String(source.ruleset)}`);
  }

  for (const id of source.bonusSlots) {
    if (!ids.has(id)) {
      throw new Error(`bonus slot references unknown tile ${id}`);
    }
  }
  const siegeRules = hasSiege(rulesetFor(source.ruleset));
  const catapults: Record<SeatId, number> = { red: 0, black: 0 };
  for (const [id, units] of Object.entries(source.startingDeployment)) {
    if (!ids.has(id)) {
      throw new Error(`startingDeployment references unknown tile ${id}`);
    }
    if (!SEATS.includes(units.seat)) {
      throw new Error(`startingDeployment ${id} has unknown seat ${String(units.seat)}`);
    }
    // Catapults are a subset of a land tile's troops, and only exist under a Siege ruleset.
    const siege = units.siege ?? 0;
    if (siege > 0) {
      if (!siegeRules) {
        throw new Error(`startingDeployment ${id} has catapults, but the ruleset has no Siege`);
      }
      if (siege > (units.troop ?? 0)) {
        throw new Error(`startingDeployment ${id} has more catapults than troops`);
      }
      catapults[units.seat] += siege;
    }
  }
  for (const seat of SEATS) {
    if (catapults[seat] > CATAPULTS_PER_PLAYER) {
      throw new Error(`${seat} deploys ${catapults[seat]} catapults (max ${CATAPULTS_PER_PLAYER})`);
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
