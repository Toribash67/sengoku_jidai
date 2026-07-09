import { describe, expect, it } from "vitest";
import { resolveTerrainUrl, terrainApiUrl } from "../../src/components/board/terrainImages.js";

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
