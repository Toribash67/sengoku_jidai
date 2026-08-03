import { describe, expect, it } from "vitest";
import {
  TERRAIN_STYLES,
  DEFAULT_TERRAIN_STYLE,
  isTerrainStyleId,
  MAX_TERRAINS_PER_MAP
} from "../src/api.js";

describe("terrain style catalog", () => {
  it("lists antique (default, first) and ink with labels", () => {
    expect(TERRAIN_STYLES.map((s) => s.id)).toEqual(["antique", "ink", "fantasy"]);
    for (const s of TERRAIN_STYLES) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("defaults to antique", () => {
    expect(DEFAULT_TERRAIN_STYLE).toBe("antique");
    expect(TERRAIN_STYLES[0].id).toBe(DEFAULT_TERRAIN_STYLE);
  });

  it("recognises valid ids and rejects unknown ones", () => {
    expect(isTerrainStyleId("antique")).toBe(true);
    expect(isTerrainStyleId("ink")).toBe(true);
    expect(isTerrainStyleId("fantasy")).toBe(true);
    expect(isTerrainStyleId("watercolour")).toBe(false);
  });
});

describe("terrain limits", () => {
  it("caps terrains per map at a positive number", () => {
    expect(MAX_TERRAINS_PER_MAP).toBe(6);
  });
});
