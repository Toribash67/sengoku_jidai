import { describe, expect, it } from "vitest";
import { buildTerrainOptions } from "./terrainImages.js";

describe("buildTerrainOptions", () => {
  it("excludes a choosing terrain from play-view options", () => {
    const options = buildTerrainOptions({
      mapId: "m",
      committed: null,
      terrains: [
        { id: "t1", name: "A", styleId: "fantasy", status: "choosing", updatedAt: "1" },
        { id: "t2", name: "B", styleId: "fantasy", status: "ready", updatedAt: "1" }
      ] as never
    });
    expect(options.map((o) => o.key)).toEqual(["flat", "t2"]);
  });
});
