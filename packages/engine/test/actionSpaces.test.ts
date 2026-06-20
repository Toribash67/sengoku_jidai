import { describe, expect, it } from "vitest";
import { riversMap } from "../src/maps/riversMap.js";
import {
  buildActionSpaces,
  actionSpaceMap,
  emptyActionSpaceOccupancy
} from "../src/actionSpaces.js";

describe("buildActionSpaces (rivers)", () => {
  const spaces = buildActionSpaces(riversMap);
  const byId = actionSpaceMap(riversMap);

  it("has one advance space per land area", () => {
    const lands = Object.values(riversMap.areas).filter((a) => a.kind === "land");
    for (const a of lands) {
      expect(byId[`advance-${a.id}`]).toMatchObject({ type: "advance", areaId: a.id });
    }
  });

  it("has sail + bombard per sea area", () => {
    const seas = Object.values(riversMap.areas).filter((a) => a.kind === "sea");
    for (const a of seas) {
      expect(byId[`sail-${a.id}`]).toMatchObject({ type: "sail", areaId: a.id });
      expect(byId[`bombard-${a.id}`]).toMatchObject({ type: "bombard", areaId: a.id });
    }
  });

  it("has a shell space exactly for shellable lands {10,12,19,21}", () => {
    const shellIds = spaces
      .filter((s) => s.type === "shell")
      .map((s) => s.areaId)
      .sort();
    expect(shellIds).toEqual(["tile10", "tile12", "tile19", "tile21"]);
  });

  it("has the fixed Rivers support spaces with N values", () => {
    expect(byId["reinforce-a"]).toMatchObject({ type: "reinforce", areaId: null, amount: 6 });
    expect(byId["reinforce-b"]).toMatchObject({ type: "reinforce", areaId: null, amount: 5 });
    expect(byId["embark-a"]).toMatchObject({ type: "embark", areaId: null, amount: 3 });
    expect(byId["embark-b"]).toMatchObject({ type: "embark", areaId: null, amount: 2 });
    expect(byId["plan-a"]).toMatchObject({ type: "plan", areaId: null, initiative: true });
    expect(byId["plan-b"]!.initiative).toBeUndefined();
  });

  it("emptyActionSpaceOccupancy maps every space id to null", () => {
    const occ = emptyActionSpaceOccupancy(riversMap);
    expect(Object.keys(occ).sort()).toEqual(spaces.map((s) => s.id).sort());
    expect(Object.values(occ).every((v) => v === null)).toBe(true);
  });
});
