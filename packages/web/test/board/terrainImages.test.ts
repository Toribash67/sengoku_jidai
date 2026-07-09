import { describe, expect, it } from "vitest";
import {
  resolveTerrain,
  resolveTerrainUrl,
  terrainApiUrl
} from "../../src/components/board/terrainImages.js";

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

describe("resolveTerrainUrl", () => {
  it("prefers a committed asset (built-ins) regardless of status", () => {
    expect(
      resolveTerrainUrl({ committed: "/assets/rivers/bg.webp", terrain: "none", mapId: "rivers" })
    ).toBe("/assets/rivers/bg.webp");
  });

  it("uses the API url for a custom map only when terrain is ready", () => {
    expect(resolveTerrainUrl({ committed: null, terrain: "ready", mapId: "abc" })).toBe(
      terrainApiUrl("abc")
    );
    expect(resolveTerrainUrl({ committed: null, terrain: "pending", mapId: "abc" })).toBeNull();
    expect(resolveTerrainUrl({ committed: null, terrain: "failed", mapId: "abc" })).toBeNull();
    expect(resolveTerrainUrl({ committed: null, terrain: "none", mapId: "abc" })).toBeNull();
  });
});
