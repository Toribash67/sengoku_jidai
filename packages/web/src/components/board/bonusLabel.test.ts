import { describe, expect, it } from "vitest";
import type { BonusType } from "@sengoku-jidai/engine/client";
import { bonusLabel } from "./bonusLabel.js";

const ALL: BonusType[] = [
  "barracks",
  "warRoom",
  "pirateHaven",
  "shipyard",
  "hiddenBase",
  "armoury"
];

describe("bonusLabel", () => {
  it("returns a non-empty name and effect for every bonus type", () => {
    for (const b of ALL) {
      const label = bonusLabel(b);
      expect(label.name.length).toBeGreaterThan(0);
      expect(label.effect.length).toBeGreaterThan(0);
    }
  });

  it("names shipyard with its sail effect", () => {
    expect(bonusLabel("shipyard")).toEqual({
      name: "Shipyard",
      effect: "+1 ship when you Sail"
    });
  });
});
