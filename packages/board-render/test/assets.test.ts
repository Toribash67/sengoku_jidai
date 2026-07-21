import { describe, it, expect } from "vitest";
import { ASSETS, armyGlyph, hqGlyph, shipGlyph, bonusTypeGlyph } from "../src/assets.js";
import type { BonusType } from "@sengoku-jidai/engine";

describe("ASSETS.defs", () => {
  it("declares a symbol for every glyph id + the stripe patterns", () => {
    for (const id of [
      "unit-army-red",
      "unit-army-black",
      "unit-ship-red",
      "unit-ship-black",
      "glyph-hq-red",
      "glyph-hq-black",
      "glyph-star",
      "glyph-harbor"
    ]) {
      expect(ASSETS.defs).toContain(`id="${id}"`);
    }
    expect(ASSETS.defs).toContain(`id="stripe-red"`);
    expect(ASSETS.defs).toContain(`id="stripe-black"`);
    expect(ASSETS.defs).toContain(`id="stripe-source"`);
  });
});

describe("ASSETS.place", () => {
  it("emits a translated <use> of the requested glyph", () => {
    const out = ASSETS.place("glyph-star", { x: 10, y: 20 });
    expect(out).toContain(`href="#glyph-star"`);
    expect(out).toContain(`translate(10 20)`);
  });
});

describe("glyph selectors", () => {
  it("map seat -> glyph id", () => {
    expect(armyGlyph("red")).toBe("unit-army-red");
    expect(shipGlyph("black")).toBe("unit-ship-black");
    expect(hqGlyph("red")).toBe("glyph-hq-red");
  });
});

describe("bonusTypeGlyph", () => {
  const ALL: BonusType[] = [
    "barracks",
    "warRoom",
    "pirateHaven",
    "shipyard",
    "hiddenBase",
    "armoury"
  ];

  it("maps every bonus type to a distinct badge symbol that exists in defs", () => {
    const ids = ALL.map(bonusTypeGlyph);
    expect(new Set(ids).size).toBe(ALL.length);
    for (const id of ids) {
      expect(ASSETS.defs).toContain(`id="${id}"`);
    }
  });

  it("bakes a generic marker symbol for game-less contexts", () => {
    expect(ASSETS.defs).toContain(`id="glyph-bonus-generic"`);
  });
});
