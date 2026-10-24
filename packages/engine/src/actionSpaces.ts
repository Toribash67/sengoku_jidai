import type { MapDefinition } from "./maps/riversMap.js";
import type { ActionType, RulesConfig } from "./rules.js";
import { hasSiege } from "./rules.js";

/**
 * A deployable action space. Linked spaces (advance/sail/bombard/shell/siege) are
 * derived from static map area data (plus the ruleset, for siege); support spaces
 * (reinforce/embark/plan) are a fixed per-board set. Occupancy lives in `GameState.actionSpaces`, keyed by id.
 */
export interface ActionSpace {
  id: string;
  type: ActionType;
  /** Linked board area for linked actions; null for support spaces. */
  areaId: string | null;
  /** N for reinforce (troops) / embark (ships) / plan (cards). */
  amount?: number;
  /** True for the single Plan space that seizes next-round initiative. */
  initiative?: boolean;
  /** Reinforce: how many of the placed troops may be catapults (Siege rulesets only). */
  siegeAmount?: number;
}

/** Rivers support board: two spaces per support type; one Plan space seizes initiative. */
const SUPPORT_SPACES: readonly ActionSpace[] = [
  { id: "reinforce-a", type: "reinforce", areaId: null, amount: 6, siegeAmount: 2 },
  { id: "reinforce-b", type: "reinforce", areaId: null, amount: 5, siegeAmount: 1 },
  { id: "embark-a", type: "embark", areaId: null, amount: 3 },
  { id: "embark-b", type: "embark", areaId: null, amount: 2 },
  { id: "plan-a", type: "plan", areaId: null, amount: 1, initiative: true },
  { id: "plan-b", type: "plan", areaId: null, amount: 1 }
];

/** The ruleset facts the catalog depends on: whether every land also gets a Siege space. */
export type CatalogRules = Pick<RulesConfig, "enabledActions">;

/** Catalogs are static per map (and Siege flag), so they are built once per `MapDefinition`
 *  object and shared. Safe because a registered map is never mutated: `registerMap` always
 *  receives a freshly compiled definition, which simply gets its own cache entry. Entries are
 *  frozen so a caller cannot corrupt the shared copy. */
const catalogCache = [
  new WeakMap<MapDefinition, readonly ActionSpace[]>(),
  new WeakMap<MapDefinition, readonly ActionSpace[]>()
] as const;
const catalogByIdCache = [
  new WeakMap<MapDefinition, Readonly<Record<string, ActionSpace>>>(),
  new WeakMap<MapDefinition, Readonly<Record<string, ActionSpace>>>()
] as const;

/** The full action-space catalog for a map under a ruleset (deterministic order: areas then
 *  support). A Siege ruleset adds a `siege-<land>` space to every land area. */
export function buildActionSpaces(map: MapDefinition, rules: CatalogRules): readonly ActionSpace[] {
  const siege = hasSiege(rules);
  const cache = catalogCache[siege ? 1 : 0];
  const cached = cache.get(map);
  if (cached) return cached;
  const spaces: ActionSpace[] = [];
  for (const a of Object.values(map.areas)) {
    if (a.kind === "land") {
      spaces.push({ id: `advance-${a.id}`, type: "advance", areaId: a.id });
      if (a.shellable) spaces.push({ id: `shell-${a.id}`, type: "shell", areaId: a.id });
      if (siege) spaces.push({ id: `siege-${a.id}`, type: "siege", areaId: a.id });
    } else {
      spaces.push({ id: `sail-${a.id}`, type: "sail", areaId: a.id });
      spaces.push({ id: `bombard-${a.id}`, type: "bombard", areaId: a.id });
    }
  }
  for (const s of SUPPORT_SPACES) {
    const space = { ...s };
    if (!siege) delete space.siegeAmount;
    spaces.push(space);
  }
  for (const s of spaces) Object.freeze(s);
  const frozen = Object.freeze(spaces);
  cache.set(map, frozen);
  return frozen;
}

/** Catalog keyed by space id for O(1) descriptor lookup. */
export function actionSpaceMap(
  map: MapDefinition,
  rules: CatalogRules
): Readonly<Record<string, ActionSpace>> {
  const cache = catalogByIdCache[hasSiege(rules) ? 1 : 0];
  const cached = cache.get(map);
  if (cached) return cached;
  const byId = Object.freeze(
    Object.fromEntries(buildActionSpaces(map, rules).map((s) => [s.id, s]))
  );
  cache.set(map, byId);
  return byId;
}

/** Fresh occupancy record: every space id -> null. Seeds `GameState.actionSpaces`. */
export function emptyActionSpaceOccupancy(
  map: MapDefinition,
  rules: CatalogRules
): Record<string, null> {
  return Object.fromEntries(buildActionSpaces(map, rules).map((s) => [s.id, null]));
}
