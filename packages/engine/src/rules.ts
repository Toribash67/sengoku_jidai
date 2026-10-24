import { DEFAULT_DICE_FACES } from "./rng.js";

export type ActionType =
  | "advance"
  | "sail"
  | "bombard"
  | "shell"
  | "siege"
  | "reinforce"
  | "embark"
  | "plan";

/**
 * Every bonus kind across all maps. A ruleset's `bonusSet` is the subset in play:
 * Hidden Base is Rivers-only and Armoury (which aids Siege) is Fortress-only.
 */
export type BonusType =
  | "barracks"
  | "warRoom"
  | "pirateHaven"
  | "shipyard"
  | "hiddenBase"
  | "armoury";

/** Variance carrier: everything that differs between maps/modes lives here. */
export interface RulesConfig {
  rulesetId: string;
  rulesetVersion: string;
  rulesetHash: string;
  commandersPerPlayer: number;
  maxRounds: number;
  diceFaces: number[];
  enabledActions: ActionType[];
  bonusSet: BonusType[];
  fortifications: boolean;
  cards: boolean;
}

export const riversRuleset: RulesConfig = {
  rulesetId: "rivers",
  rulesetVersion: "0.1.0",
  rulesetHash: "rivers-0.1.0",
  commandersPerPlayer: 5,
  maxRounds: 4,
  diceFaces: [...DEFAULT_DICE_FACES],
  enabledActions: ["advance", "sail", "bombard", "shell", "reinforce", "embark", "plan"],
  bonusSet: ["barracks", "warRoom", "pirateHaven", "shipyard", "hiddenBase"],
  fortifications: false,
  cards: true
};

/**
 * Fortress: Rivers plus catapults and the Siege action (a Siege space on every land), Armoury
 * in place of Hidden Base, and the Fortress operation-card deck (see `deckFor`).
 */
export const fortressRuleset: RulesConfig = {
  ...riversRuleset,
  rulesetId: "fortress",
  rulesetVersion: "0.1.0",
  rulesetHash: "fortress-0.1.0",
  enabledActions: ["advance", "sail", "bombard", "shell", "siege", "reinforce", "embark", "plan"],
  bonusSet: ["barracks", "warRoom", "pirateHaven", "shipyard", "armoury"]
};

/** The rulesets a map can be authored for, keyed by `rulesetId`. */
export type RulesetId = "rivers" | "fortress";

export const RULESETS: Readonly<Record<RulesetId, RulesConfig>> = {
  rivers: riversRuleset,
  fortress: fortressRuleset
};

/** The ruleset a map selects; unknown or missing ids fall back to Rivers. */
export function rulesetFor(id: string | undefined): RulesConfig {
  return (id !== undefined && RULESETS[id as RulesetId]) || riversRuleset;
}

/** Whether this ruleset uses catapults (and therefore the Siege action). */
export function hasSiege(rules: Pick<RulesConfig, "enabledActions">): boolean {
  return rules.enabledActions.includes("siege");
}
