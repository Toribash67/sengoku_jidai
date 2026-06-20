import type { MapDefinition } from "./maps/riversMap.js";
import type { ActionType } from "./rules.js";

/**
 * A deployable action space. Linked spaces (advance/sail/bombard/shell) are
 * derived from static map area data; support spaces (reinforce/embark/plan) are
 * a fixed per-board set. Occupancy lives in `GameState.actionSpaces`, keyed by id.
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
}

/** Rivers support board: two spaces per support type; one Plan space seizes initiative. */
const SUPPORT_SPACES: readonly ActionSpace[] = [
  { id: "reinforce-a", type: "reinforce", areaId: null, amount: 6 },
  { id: "reinforce-b", type: "reinforce", areaId: null, amount: 5 },
  { id: "embark-a", type: "embark", areaId: null, amount: 3 },
  { id: "embark-b", type: "embark", areaId: null, amount: 2 },
  { id: "plan-a", type: "plan", areaId: null, amount: 1, initiative: true },
  { id: "plan-b", type: "plan", areaId: null, amount: 1 }
];

/** The full action-space catalog for a map (deterministic order: areas then support). */
export function buildActionSpaces(map: MapDefinition): ActionSpace[] {
  const spaces: ActionSpace[] = [];
  for (const a of Object.values(map.areas)) {
    if (a.kind === "land") {
      spaces.push({ id: `advance-${a.id}`, type: "advance", areaId: a.id });
      if (a.shellable) spaces.push({ id: `shell-${a.id}`, type: "shell", areaId: a.id });
    } else {
      spaces.push({ id: `sail-${a.id}`, type: "sail", areaId: a.id });
      spaces.push({ id: `bombard-${a.id}`, type: "bombard", areaId: a.id });
    }
  }
  for (const s of SUPPORT_SPACES) spaces.push({ ...s });
  return spaces;
}

/** Catalog keyed by space id for O(1) descriptor lookup. */
export function actionSpaceMap(map: MapDefinition): Record<string, ActionSpace> {
  return Object.fromEntries(buildActionSpaces(map).map((s) => [s.id, s]));
}

/** Fresh occupancy record: every space id -> null. Seeds `GameState.actionSpaces`. */
export function emptyActionSpaceOccupancy(map: MapDefinition): Record<string, null> {
  return Object.fromEntries(buildActionSpaces(map).map((s) => [s.id, null]));
}
