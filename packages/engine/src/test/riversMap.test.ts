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
    for (const a of areas) {
      for (const id of [...a.adjacent, ...a.ports]) {
        expect(riversMap.areas[id], `${a.id} -> ${id}`).toBeDefined();
      }
    }
  });

  it("has symmetric general adjacency", () => {
    for (const a of areas) {
      for (const id of a.adjacent) {
        expect(riversMap.areas[id]?.adjacent, `${a.id} <-> ${id}`).toContain(a.id);
      }
    }
  });

  it("only places ports on harbour land areas, pointing at sea areas", () => {
    for (const a of areas) {
      if (a.ports.length > 0) {
        expect(a.kind).toBe("land");
        expect(a.harbor).toBe(true);
        for (const id of a.ports) expect(riversMap.areas[id]?.kind).toBe("sea");
      }
      if (a.harbor) expect(a.ports.length).toBeGreaterThan(0);
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
