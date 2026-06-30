import { describe, it, expect } from "vitest";
import { ASSETS, armyGlyph, hqGlyph, shipGlyph } from "../src/assets.js";

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
