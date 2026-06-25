import type { LegalPlacement, OperationCard } from "@sengoku-jidai/engine";

/** When several placement spaces of the same type are open (e.g. Reinforce 6 and 5), a
 *  player always wants the largest, so the panel offers only the biggest per type. The
 *  smaller space still surfaces once the larger is occupied — it then drops out of the
 *  larger's slot and becomes the only legal space of its type. */
export function largestPlacementPerType(placements: LegalPlacement[]): LegalPlacement[] {
  const best = new Map<LegalPlacement["type"], LegalPlacement>();
  for (const placement of placements) {
    const current = best.get(placement.type);
    if (!current || placement.pool > current.pool) {
      best.set(placement.type, placement);
    }
  }
  return placements.filter((placement) => best.get(placement.type) === placement);
}

/** The in-progress order being composed. One variant per action shape: movement
 *  (advance/sail) and placement (reinforce/embark) stage per-area counts; a strike
 *  (bombard/shell) picks a single enemy target; plan just deploys. The UI for these lives
 *  in ActionBar; this module holds the shared type and labels so App and ActionBar agree. */
export type ComposerState =
  | {
      kind: "move";
      spaceId: string;
      type: "advance" | "sail";
      targetAreaId: string;
      sources: { areaId: string; max: number }[];
      counts: Record<string, number>;
      /** Operation card played with this move (ground_assault/river_assault/counterattack). */
      card?: OperationCard;
      /** Extra reserve units the assault card adds to the move-in, and its 0–2 cap. */
      bonus?: number;
      bonusMax?: number;
    }
  | {
      kind: "strike";
      spaceId: string;
      type: "bombard" | "shell";
      linkedAreaId: string;
      targets: string[];
      dice: number;
      targetAreaId: string | null;
      /** Operation card played with this strike (shore_strike). */
      card?: OperationCard;
    }
  | {
      kind: "placement";
      spaceId: string;
      type: "reinforce" | "embark";
      unit: "troop" | "ship";
      targets: string[];
      pool: number;
      reserve: number;
      counts: Record<string, number>;
      /** Operation card played with this placement (mobilise/commandeer). */
      card?: OperationCard;
    }
  | { kind: "plan"; spaceId: string; initiative: boolean };

export type ActionVerb = "advance" | "sail" | "bombard" | "shell" | "reinforce" | "embark";

export const VERB: Record<ActionVerb, string> = {
  advance: "Advance",
  sail: "Sail",
  bombard: "Bombard",
  shell: "Shell",
  reinforce: "Reinforce",
  embark: "Embark"
};

export const UNIT_NOUN: Record<"troop" | "ship", string> = { troop: "troops", ship: "ships" };

export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** Units staged per area for the active move/placement composer (empty otherwise). Drives
 *  the on-map count badges. Strike/plan stage nothing. */
export function stagedCountsFor(composer: ComposerState | null): Map<string, number> {
  const staged = new Map<string, number>();
  if (composer && (composer.kind === "move" || composer.kind === "placement")) {
    for (const [areaId, count] of Object.entries(composer.counts)) {
      if (count > 0) {
        staged.set(areaId, count);
      }
    }
  }
  return staged;
}
