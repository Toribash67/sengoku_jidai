import type { ActionType } from "@sengoku-jidai/engine";

/** SVG order-slot prefix per on-map action type (engine "advance" = SVG "move"). */
const SLOT_PREFIX: Partial<Record<ActionType, string>> = {
  advance: "move",
  sail: "sail",
  bombard: "bombard",
  shell: "shell"
};

/**
 * Maps an engine action-space id (e.g. "advance-tile9") to its SVG order-slot
 * element id (e.g. "move-tile9"). Returns null for support spaces
 * (reinforce/embark/plan) and anything not linked to a tile.
 */
export function slotIdForSpace(spaceId: string): string | null {
  const dash = spaceId.indexOf("-");
  if (dash === -1) {
    return null;
  }
  const prefix = SLOT_PREFIX[spaceId.slice(0, dash) as ActionType];
  const rest = spaceId.slice(dash + 1);
  if (!prefix || !rest.startsWith("tile")) {
    return null;
  }
  return `${prefix}-${rest}`;
}
