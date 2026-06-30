import { describe, it, expect } from "vitest";
import type { Axial, HexLayout } from "@sengoku-jidai/engine";
import { fuseTile, hexCorners, hexEdges } from "../src/outline.js";

const LAYOUT: HexLayout = { size: 114, originX: 0, originY: 0 };

describe("hexCorners", () => {
  it("returns 6 corners at radius=size from the centre", () => {
    const corners = hexCorners({ x: 0, y: 0 }, 10);
    expect(corners).toHaveLength(6);
    for (const c of corners) {
      expect(Math.hypot(c.x, c.y)).toBeCloseTo(10, 6);
    }
  });
});

describe("fuseTile", () => {
  it("a single hex fuses to one 6-point ring", () => {
    const rings = fuseTile([{ q: 0, r: 0 }], LAYOUT);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(6);
  });

  it("two edge-adjacent hexes fuse to one ring with no internal edge", () => {
    // B from the fixture: (1,0) and (1,-1) share an edge.
    const hexes: Axial[] = [
      { q: 1, r: 0 },
      { q: 1, r: -1 }
    ];
    const rings = fuseTile(hexes, LAYOUT);
    expect(rings).toHaveLength(1);
    // 6 + 6 corners, minus the 2 shared corners = 10 perimeter vertices.
    expect(rings[0]).toHaveLength(10);
  });

  it("a donut tile (six hexes around an empty centre) fuses to two rings", () => {
    // The six neighbors of (0,0), leaving the centre hex empty: the hole
    // produces an inner ring plus the outer perimeter ring.
    const donut: Axial[] = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 }
    ];
    const rings = fuseTile(donut, LAYOUT);
    expect(rings).toHaveLength(2);
  });
});

describe("hexEdges", () => {
  it("dedupes the shared edge between two adjacent hexes (11 unique, not 12)", () => {
    const hexes: Axial[] = [
      { q: 1, r: 0 },
      { q: 1, r: -1 }
    ];
    expect(hexEdges(hexes, LAYOUT)).toHaveLength(11);
  });
});
