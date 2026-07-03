import { describe, it, expect } from "vitest";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { buildScene } from "../src/scene.js";
import { NATIVE_HEX_SIZE, ORDER_TOKEN_RADIUS } from "../src/assets.js";

const scene = buildScene(compileHexMap(FIXTURE_HEX_MAP));
const byId = (id: string) => scene.tiles.find((t) => t.id === id)!;

describe("buildScene", () => {
  it("emits one tile per area, in definition order", () => {
    expect(scene.tiles.map((t) => t.id)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("assigns land/sea authored fills", () => {
    expect(byId("A").authoredFill).toBe("#d5d3c4");
    expect(byId("C").authoredFill).toBe("#8cb2f2");
  });

  it("carries features through to the scene tile", () => {
    expect(byId("A").features.hq).toBe("red");
    expect(byId("B").features.valueStars).toBe(1);
    expect(byId("D").features.harbor).toBe(true);
  });

  it("derives order-slot ids matching the web slotIdForSpace contract", () => {
    expect(Object.keys(byId("A").slots).sort()).toEqual(["move-A"]); // land
    expect(Object.keys(byId("C").slots).sort()).toEqual(["bombard-C", "sail-C"]); // sea
    expect(Object.keys(byId("B").slots).sort()).toEqual(["move-B", "shell-B"]); // shellable land
  });

  it("nests order tokens corner-on-corner in the topmost hex's NW/NE vertices (as on board.svg)", () => {
    // Measured from board.svg: every token centre sits at (R - tokenR) along the
    // centre→vertex axis — the token's outer corner coincides exactly with the region's
    // corner. Primary (move/sail) at the NW vertex (120°), secondary (shell/bombard) NE (60°).
    const size = scene.hexSize;
    const nest = size - ORDER_TOKEN_RADIUS * (size / NATIVE_HEX_SIZE);
    // Single move token: NW corner of A's only hex (centre 0,0).
    expect(byId("A").slots["move-A"]!.x).toBeCloseTo(-0.5 * nest, 1);
    expect(byId("A").slots["move-A"]!.y).toBeCloseTo(-(Math.sqrt(3) / 2) * nest, 1);
    // Sea pair: sail NW, bombard NE of C's hex (centre 0,197.45).
    const sail = byId("C").slots["sail-C"]!;
    const bombard = byId("C").slots["bombard-C"]!;
    expect(sail.x).toBeCloseTo(-0.5 * nest, 1);
    expect(bombard.x).toBeCloseTo(0.5 * nest, 1);
    expect(sail.y).toBeCloseTo(197.45 - (Math.sqrt(3) / 2) * nest, 1);
    expect(bombard.y).toBeCloseTo(sail.y, 5);
    // Multi-hex tile B anchors on its topmost hex (centre 171,-98.73), not the tile centroid.
    expect(byId("B").slots["move-B"]!.x).toBeCloseTo(171 - 0.5 * nest, 1);
    expect(byId("B").slots["move-B"]!.y).toBeCloseTo(-98.73 - (Math.sqrt(3) / 2) * nest, 1);
  });

  it("anchors value-star badges in the SE corner, clear of the order tokens (as on board.svg)", () => {
    // Measured from board.svg: badge centres sit at 0.745R (1-star) / 0.713R (2-star pill)
    // along the SE vertex axis (300°) of the hex — the opposite side from the order tokens.
    const size = scene.hexSize;
    const b = byId("B").glyphAnchors.stars!; // B: valueStars 1, badge hex = bottommost hex
    const anchorHex = { x: 171, y: 98.73 }; // B's bottommost hex centre
    expect(b.x).toBeCloseTo(anchorHex.x + 0.5 * 0.745 * size, 1);
    expect(b.y).toBeCloseTo(anchorHex.y + (Math.sqrt(3) / 2) * 0.745 * size, 1);
  });

  it("emits a pier from harbor D to its port sea tile C", () => {
    const ports = byId("D").ports;
    expect(ports).toHaveLength(1);
    expect(ports[0]!.to).toBe("C");
  });

  it("produces a viewBox enclosing every ring point", () => {
    const allX = scene.tiles.flatMap((t) => t.rings.flat().map((p) => p.x));
    const allY = scene.tiles.flatMap((t) => t.rings.flat().map((p) => p.y));
    expect(scene.viewBox.x).toBeLessThanOrEqual(Math.min(...allX));
    expect(scene.viewBox.y).toBeLessThanOrEqual(Math.min(...allY));
    expect(scene.viewBox.x + scene.viewBox.width).toBeGreaterThanOrEqual(Math.max(...allX));
    expect(scene.viewBox.y + scene.viewBox.height).toBeGreaterThanOrEqual(Math.max(...allY));
  });

  it("places a bonus glyph on each bonus-slot tile, by slot order", () => {
    const b = scene.tiles.find((t) => t.id === "B")!;
    expect(b.bonusGlyph).toBe("glyph-bonus-sun");
    expect(b.glyphAnchors.bonus).toBeDefined();
    const a = scene.tiles.find((t) => t.id === "A")!;
    expect(a.bonusGlyph).toBeUndefined();
  });
});
