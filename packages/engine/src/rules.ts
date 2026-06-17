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
  cards: false
};
