import type { BonusType } from "@sengoku-jidai/engine/client";

export interface BonusLabel {
  name: string;
  effect: string;
}

/** Human-readable name + short effect for each bonus, for the area detail panel. Effects are
 *  the rules as implemented in engine/src/actions.ts. */
const LABELS: Record<BonusType, BonusLabel> = {
  barracks: { name: "Barracks", effect: "+2 troops when you Reinforce" },
  warRoom: { name: "War Room", effect: "+1 card when you Plan" },
  pirateHaven: { name: "Pirate Haven", effect: "+1 die when you Bombard" },
  shipyard: { name: "Shipyard", effect: "+1 ship when you Sail" },
  hiddenBase: { name: "Hidden Base", effect: "+1 troop when you Advance" },
  armoury: { name: "Armoury", effect: "Siege only" }
};

export function bonusLabel(bonus: BonusType): BonusLabel {
  return LABELS[bonus];
}
