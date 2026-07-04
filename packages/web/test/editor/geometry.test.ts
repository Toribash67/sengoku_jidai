import { describe, expect, it } from "vitest";
import { axialToPixel, NEIGHBOR_DIRS } from "@sengoku-jidai/engine/client";
import type { HexTileSource } from "@sengoku-jidai/engine/client";
import {
  axialsInRect,
  EDGE_CORNERS,
  hexCorner,
  tileBoundarySegments
} from "../../src/editor/geometry.js";

const LAYOUT = { size: 114, originX: 0, originY: 0 };

describe("geometry", () => {
  it("EDGE_CORNERS matches NEIGHBOR_DIRS: both sides of a shared edge agree", () => {
    const a = { q: 0, r: 0 };
    NEIGHBOR_DIRS.forEach((dir, i) => {
      const b = { q: a.q + dir.q, r: a.r + dir.r };
      const [c1, c2] = EDGE_CORNERS[i]!;
      const j = NEIGHBOR_DIRS.findIndex((d) => d.q === -dir.q && d.r === -dir.r);
      const [d1, d2] = EDGE_CORNERS[j]!;
      const edgeFromA = [
        hexCorner(axialToPixel(a, LAYOUT), LAYOUT.size, c1),
        hexCorner(axialToPixel(a, LAYOUT), LAYOUT.size, c2)
      ];
      const edgeFromB = [
        hexCorner(axialToPixel(b, LAYOUT), LAYOUT.size, d1),
        hexCorner(axialToPixel(b, LAYOUT), LAYOUT.size, d2)
      ];
      const key = (p: { x: number; y: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      expect(new Set(edgeFromA.map(key))).toEqual(new Set(edgeFromB.map(key)));
    });
  });

  it("enumerates the axials covering a rect (origin hex included)", () => {
    const axials = axialsInRect({ x: -120, y: -120, width: 240, height: 240 }, LAYOUT);
    expect(axials).toContainEqual({ q: 0, r: 0 });
    expect(axials.length).toBeGreaterThan(4);
  });

  it("boundary segments: 6 for a lone hex, 11 for two adjacent tiles (shared edge once), 10 for one two-hex tile", () => {
    const lone: HexTileSource[] = [
      { id: "a", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} }
    ];
    expect(tileBoundarySegments(lone, LAYOUT)).toHaveLength(6);

    const twoTiles: HexTileSource[] = [
      { id: "a", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
      { id: "b", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} }
    ];
    expect(tileBoundarySegments(twoTiles, LAYOUT)).toHaveLength(11);

    const oneTile: HexTileSource[] = [
      {
        id: "a",
        kind: "land",
        hexes: [
          { q: 0, r: 0 },
          { q: 1, r: 0 }
        ],
        features: {}
      }
    ];
    expect(tileBoundarySegments(oneTile, LAYOUT)).toHaveLength(10);
  });
});
