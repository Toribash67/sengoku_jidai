import { describe, it, expect } from "vitest";
import { offsetRingsOutward } from "../src/outline.js";

describe("offsetRingsOutward", () => {
  it("expands a CCW square outward by the given distance", () => {
    // Axis-aligned 10×10 square centred at (5,5).
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ];
    const [out] = offsetRingsOutward([square], 1);
    // Each corner moves diagonally outward by 1 along both axes.
    expect(out!.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 }
    ]);
  });

  it("leaves every offset vertex farther from the centroid than its original", () => {
    const hexish = [
      { x: 10, y: 0 },
      { x: 5, y: 8 },
      { x: -5, y: 8 },
      { x: -10, y: 0 },
      { x: -5, y: -8 },
      { x: 5, y: -8 }
    ];
    const [out] = offsetRingsOutward([hexish], 2);
    const d2 = (p: { x: number; y: number }) => p.x * p.x + p.y * p.y; // centroid ≈ (0,0)
    out!.forEach((p, i) => expect(d2(p)).toBeGreaterThan(d2(hexish[i]!)));
  });

  it("returns degenerate rings (<3 points) unchanged in value", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ];
    expect(offsetRingsOutward([line], 5)).toEqual([line]);
  });
});
