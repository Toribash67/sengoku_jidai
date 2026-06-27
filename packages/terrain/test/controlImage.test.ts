import { describe, expect, it } from "vitest";
import { riversMap } from "@sengoku-jidai/engine";
import { LAND_COLOR, SEA_COLOR, tileColorMap } from "../src/controlImage.js";

describe("tileColorMap", () => {
  it("maps every tile to land-white or sea-black by kind", () => {
    const colors = tileColorMap(riversMap);
    // Every area is present.
    expect(Object.keys(colors).sort()).toEqual(Object.keys(riversMap.areas).sort());
    // Land vs sea map to the two colours.
    expect(colors.tile1).toBe(LAND_COLOR); // tile1 is land
    expect(colors.tile3).toBe(SEA_COLOR); // tile3 is sea
    // Only the two colours ever appear.
    for (const value of Object.values(colors)) {
      expect([LAND_COLOR, SEA_COLOR]).toContain(value);
    }
  });
});
