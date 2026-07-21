import { describe, expect, it } from "vitest";
import type { BonusType } from "@sengoku-jidai/engine/client";
import { bonusLabel } from "./bonusLabel.js";

const CASES: Array<[BonusType, string, string]> = [
  ["barracks", "Barracks", "+2 troops when you Reinforce"],
  ["warRoom", "War Room", "+1 card when you Plan"],
  ["pirateHaven", "Pirate Haven", "+1 die when you Bombard"],
  ["shipyard", "Shipyard", "+1 ship when you Sail"],
  ["hiddenBase", "Hidden Base", "+1 troop when you Advance"],
  ["armoury", "Armoury", "Siege only"]
];

describe("bonusLabel", () => {
  it.each(CASES)("labels %s with its name and effect", (bonus, name, effect) => {
    expect(bonusLabel(bonus)).toEqual({ name, effect });
  });
});
