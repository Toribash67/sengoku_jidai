import { describe, expect, it } from "vitest";
import { riversMap } from "../maps/riversMap.js";

const areas = Object.values(riversMap.areas);

describe("rivers map topology", () => {
  it("has 22 areas split into 14 land and 8 sea", () => {
    expect(areas).toHaveLength(22);
    expect(areas.filter((a) => a.kind === "land")).toHaveLength(14);
    expect(areas.filter((a) => a.kind === "sea")).toHaveLength(8);
  });

  it("has exactly one red HQ and one black HQ, both on land", () => {
    const hqs = areas.filter((a) => a.hq !== null);
    expect(hqs.map((a) => a.id).sort()).toEqual(["tile13", "tile9"]);
    expect(hqs.every((a) => a.kind === "land")).toBe(true);
    expect(hqs.filter((a) => a.hq === "red")).toHaveLength(1);
    expect(hqs.filter((a) => a.hq === "black")).toHaveLength(1);
  });

  it("references no dangling area ids", () => {
    for (const area of areas) {
      for (const id of [...area.landAdjacent, ...area.seaAdjacent, ...area.piers]) {
        expect(riversMap.areas[id], `${area.id} -> ${id}`).toBeDefined();
      }
    }
  });

  it("keeps land and sea adjacency within their own kind", () => {
    for (const area of areas) {
      for (const id of area.landAdjacent) {
        expect(riversMap.areas[id]?.kind).toBe("land");
      }
      for (const id of area.seaAdjacent) {
        expect(riversMap.areas[id]?.kind).toBe("sea");
      }
    }
  });

  it("has symmetric land and sea adjacency", () => {
    for (const area of areas) {
      for (const id of area.landAdjacent) {
        expect(riversMap.areas[id]?.landAdjacent).toContain(area.id);
      }
      for (const id of area.seaAdjacent) {
        expect(riversMap.areas[id]?.seaAdjacent).toContain(area.id);
      }
    }
  });

  it("only places piers on harbour land areas, pointing at sea areas", () => {
    for (const area of areas) {
      if (area.piers.length > 0) {
        expect(area.kind).toBe("land");
        expect(area.harbor).toBe(true);
        for (const id of area.piers) {
          expect(riversMap.areas[id]?.kind).toBe("sea");
        }
      }
      if (area.harbor) {
        expect(area.piers.length).toBeGreaterThan(0);
      }
    }
  });

  it("places value stars on the expected areas", () => {
    const oneStar = areas.filter((a) => a.valueStars === 1).map((a) => a.id).sort();
    const twoStar = areas.filter((a) => a.valueStars === 2).map((a) => a.id).sort();
    expect(oneStar).toEqual(
      ["tile11", "tile15", "tile17", "tile2", "tile3", "tile4", "tile6", "tile7", "tile8"].sort()
    );
    expect(twoStar).toEqual(["tile16", "tile20"].sort());
  });
});
