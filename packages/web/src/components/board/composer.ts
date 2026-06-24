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
    }
  | {
      kind: "strike";
      spaceId: string;
      type: "bombard" | "shell";
      linkedAreaId: string;
      targets: string[];
      dice: number;
      targetAreaId: string | null;
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
