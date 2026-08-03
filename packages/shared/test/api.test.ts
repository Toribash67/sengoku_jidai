import { describe, expect, it } from "vitest";
import { TERRAIN_STYLES, isTerrainStyleId, DEFAULT_TERRAIN_STYLE } from "../src/api.js";

describe("terrain styles", () => {
  it("exposes the fantasy style and keeps antique as default", () => {
    expect(TERRAIN_STYLES.map((s) => s.id)).toEqual(["antique", "ink", "fantasy"]);
    expect(TERRAIN_STYLES.find((s) => s.id === "fantasy")?.label).toBe("Fantasy (colour)");
    expect(isTerrainStyleId("fantasy")).toBe(true);
    expect(DEFAULT_TERRAIN_STYLE).toBe("antique");
  });
});
