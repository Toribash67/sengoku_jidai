import { describe, expect, it } from "vitest";
import { harborMarkers, type HarborScene } from "../src/harborMarkers.js";

const SCENE: HarborScene = {
  viewBox: { x: 0, y: 0, width: 100 },
  hexSize: 10,
  tiles: [
    // meanEdge = (25, 30); with coastBias 0.5 the disc centre is halfway from the centroid
    // toward the coast: (22.5, 25).
    {
      centroid: { x: 20, y: 20 },
      features: { harbor: true },
      ports: [{ edge: { x: 20, y: 30 } }, { edge: { x: 30, y: 30 } }]
    },
    { centroid: { x: 80, y: 80 }, features: { harbor: false }, ports: [] }
  ]
};

describe("harborMarkers", () => {
  it("places one disc per harbor tile, biased from the centroid toward the mean coastal edge", () => {
    const markers = harborMarkers(SCENE, 200, 0.5, 0.5); // scale = 2
    expect(markers).toHaveLength(1);
    const m = markers[0]!;
    expect(m.x).toBeCloseTo(22.5 * 2, 5);
    expect(m.y).toBeCloseTo(25 * 2, 5);
    expect(m.radius).toBeCloseTo(10 * 0.5 * 2, 5);
  });

  it("falls back to the tile centroid when a harbour tile has no sea-facing ports", () => {
    const noPorts: HarborScene = {
      viewBox: { x: 0, y: 0, width: 100 },
      hexSize: 10,
      tiles: [{ centroid: { x: 40, y: 60 }, features: { harbor: true }, ports: [] }]
    };
    const [m] = harborMarkers(noPorts, 100, 0.5, 0.6); // scale = 1
    expect(m!.x).toBeCloseTo(40, 5);
    expect(m!.y).toBeCloseTo(60, 5);
  });

  it("returns an empty array when no tile is a harbour", () => {
    const none: HarborScene = {
      viewBox: { x: 0, y: 0, width: 100 },
      hexSize: 10,
      tiles: [{ centroid: { x: 10, y: 10 }, features: { harbor: false }, ports: [] }]
    };
    expect(harborMarkers(none, 100, 0.5, 0.6)).toEqual([]);
  });
});
