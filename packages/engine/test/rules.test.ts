import { describe, expect, it } from "vitest";
import { riversRuleset } from "../src/rules.js";
import { DEFAULT_DICE_FACES } from "../src/rng.js";

describe("rivers ruleset", () => {
  it("describes the Rivers variant knobs", () => {
    expect(riversRuleset.commandersPerPlayer).toBe(5);
    expect(riversRuleset.maxRounds).toBe(4);
    expect(riversRuleset.diceFaces).toEqual([...DEFAULT_DICE_FACES]);
    expect(riversRuleset.fortifications).toBe(false);
    expect(riversRuleset.cards).toBe(true);
  });

  it("enables the seven Rivers actions and omits Siege", () => {
    expect(riversRuleset.enabledActions).toEqual(
      expect.arrayContaining(["advance", "sail", "bombard", "shell", "reinforce", "embark", "plan"])
    );
    expect(riversRuleset.enabledActions).not.toContain("siege");
    expect(riversRuleset.enabledActions).toHaveLength(7);
  });

  it("uses the five Rivers bonuses and omits Armoury", () => {
    expect(riversRuleset.bonusSet).toEqual(
      expect.arrayContaining(["barracks", "warRoom", "pirateHaven", "shipyard", "hiddenBase"])
    );
    expect(riversRuleset.bonusSet).not.toContain("armoury");
    expect(riversRuleset.bonusSet).toHaveLength(5);
  });
});
