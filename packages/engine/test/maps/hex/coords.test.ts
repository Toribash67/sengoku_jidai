import { describe, expect, it } from "vitest";
import {
  areNeighbors,
  axialKey,
  axialRound,
  axialToCube,
  axialToPixel,
  cubeToAxial,
  hexDistance,
  neighbors,
  NEIGHBOR_DIRS,
  pixelToAxial
} from "../../../src/maps/hex/coords.js";

describe("hex coords", () => {
  it("has six distinct edge neighbor directions", () => {
    expect(NEIGHBOR_DIRS).toHaveLength(6);
    const keys = new Set(NEIGHBOR_DIRS.map(axialKey));
    expect(keys.size).toBe(6);
    expect(keys.has("0,0")).toBe(false);
  });

  it("computes the six neighbors of the origin", () => {
    const got = new Set(neighbors({ q: 0, r: 0 }).map(axialKey));
    expect(got).toEqual(new Set(["1,0", "1,-1", "0,-1", "-1,0", "-1,1", "0,1"]));
  });

  it("areNeighbors is true for edge neighbors and false for self and corner-touch", () => {
    expect(areNeighbors({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    expect(areNeighbors({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(false);
    // (0,0) and (1,1) share only a corner, not an edge.
    expect(areNeighbors({ q: 0, r: 0 }, { q: 1, r: 1 })).toBe(false);
  });

  it("round-trips axial <-> cube", () => {
    const a = { q: 2, r: -3 };
    expect(cubeToAxial(axialToCube(a))).toEqual(a);
  });

  it("measures hex distance", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
  });

  it("round-trips pixel <-> axial for flat-top layout", () => {
    const layout = { size: 114, originX: 0, originY: 0 };
    for (const a of [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -1, r: 4 }
    ]) {
      expect(pixelToAxial(axialToPixel(a, layout), layout)).toEqual(a);
    }
  });

  it("places origin hex at the layout origin", () => {
    expect(axialToPixel({ q: 0, r: 0 }, { size: 10, originX: 5, originY: 7 })).toEqual({
      x: 5,
      y: 7
    });
  });

  it("axialRound snaps fractional coordinates to the nearest hex", () => {
    expect(axialRound({ q: 0.2, r: -0.1 })).toEqual({ q: 0, r: 0 });
  });
});
