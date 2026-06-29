import { describe, expect, it } from "vitest";
import { resolveTerrain } from "../../src/components/board/terrainImages.js";

const modules = {
  "/src/assets/rivers/background.webp": "/assets/rivers.hash.webp"
};

describe("resolveTerrain", () => {
  it("returns the asset url for a map that has terrain", () => {
    expect(resolveTerrain(modules, "rivers")).toBe("/assets/rivers.hash.webp");
  });

  it("returns null for a map with no committed terrain", () => {
    expect(resolveTerrain(modules, "mountains")).toBeNull();
  });
});
