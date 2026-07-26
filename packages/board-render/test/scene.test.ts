import { describe, it, expect } from "vitest";
import { axialToPixel, compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import type { CompiledMap } from "@sengoku-jidai/engine";
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
    // Multi-hex tile B nests on the hex nearest its top-centre — here the topmost hex (171,-98.73)
    // already sits at the tile's horizontal centre, so placement is unchanged.
    expect(byId("B").slots["move-B"]!.x).toBeCloseTo(171 - 0.5 * nest, 1);
    expect(byId("B").slots["move-B"]!.y).toBeCloseTo(-98.73 - (Math.sqrt(3) / 2) * nest, 1);
  });

  it("pulls a multi-hex tile's order tokens toward its top-centre, not the extreme topmost hex", () => {
    // An asymmetric tile: a lone hex up at the far left, with the body (a column) off to the right.
    // Old behaviour anchored on the leftmost topmost hex, hanging tokens off the tile's edge; the
    // fix nests them on the top-row hex nearest the centroid's column instead.
    const size = 100;
    const hexes = [
      { q: 0, r: -1 }, // top-left lone hex
      { q: 2, r: -2 }, // top of the right-hand column (same top row)
      { q: 2, r: -1 },
      { q: 2, r: 0 }
    ];
    const compiled = {
      layout: { size, origin: { x: 0, y: 0 }, tiles: { T: { hexes } } },
      definition: {
        areas: { T: { id: "T", kind: "land", hq: null, valueStars: 0, harbor: false, ports: [] } },
        bonusSlots: []
      }
    } as unknown as CompiledMap;
    const tile = buildScene(compiled).tiles[0]!;
    const px = hexes.map((h) => axialToPixel(h, { size, originX: 0, originY: 0 }));
    const minY = Math.min(...px.map((p) => p.y));
    // Old anchor: leftmost hex in the topmost row.
    const oldAnchor = px
      .filter((p) => Math.abs(p.y - minY) < 0.01)
      .reduce((a, b) => (a.x < b.x ? a : b));
    const nest = size - ORDER_TOKEN_RADIUS * (size / NATIVE_HEX_SIZE);
    const newAnchorX = tile.slots["move-T"]!.x + 0.5 * nest; // undo the NW-vertex offset
    // Precondition: the extreme topmost hex is well off the tile's horizontal centre.
    expect(Math.abs(oldAnchor.x - tile.centroid.x)).toBeGreaterThan(size);
    // The fix nests on a hex nearer the centroid than that extreme (fails under the old logic).
    expect(Math.abs(newAnchorX - tile.centroid.x)).toBeLessThan(
      Math.abs(oldAnchor.x - tile.centroid.x)
    );
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

  it("emits one pier per sea-facing hex edge — several to the same sea area", () => {
    // Harbour H is a single hex whose neighbours (1,0) and (1,-1) both belong to one sea
    // tile S, so H gets two piers, both pointing at S from two different edges.
    const size = 114;
    const compiled = {
      layout: {
        size,
        origin: { x: 0, y: 0 },
        tiles: {
          H: { hexes: [{ q: 0, r: 0 }] },
          S: {
            hexes: [
              { q: 1, r: 0 },
              { q: 1, r: -1 }
            ]
          }
        }
      },
      definition: {
        // Piers are derived from hex adjacency (harbor flag + sea neighbours), not from any
        // authored port list — so the areas carry no `ports`; only `harbor: true` drives it.
        areas: {
          H: { id: "H", kind: "land", hq: null, valueStars: 0, harbor: true },
          S: { id: "S", kind: "sea", hq: null, valueStars: 0, harbor: false }
        },
        bonusSlots: []
      }
    } as unknown as CompiledMap;
    const tile = buildScene(compiled).tiles.find((t) => t.id === "H")!;
    expect(tile.ports).toHaveLength(2);
    expect(tile.ports.every((p) => p.to === "S")).toBe(true);
    // Each pier carries a unit outward direction driving placePier's rotation.
    for (const p of tile.ports) {
      expect(Math.hypot(p.dir.x, p.dir.y)).toBeCloseTo(1, 5);
    }
    // The two piers point along distinct edges — different outward directions and their
    // midpoints sit on opposite sides of the harbour hex in y.
    expect(tile.ports[0]!.dir.y).not.toBeCloseTo(tile.ports[1]!.dir.y, 5);
    const ys = tile.ports.map((p) => p.edge.y).sort((a, b) => a - b);
    expect(ys[0]!).toBeLessThan(0);
    expect(ys[1]!).toBeGreaterThan(0);
  });

  it("produces a viewBox enclosing every ring point", () => {
    const allX = scene.tiles.flatMap((t) => t.rings.flat().map((p) => p.x));
    const allY = scene.tiles.flatMap((t) => t.rings.flat().map((p) => p.y));
    expect(scene.viewBox.x).toBeLessThanOrEqual(Math.min(...allX));
    expect(scene.viewBox.y).toBeLessThanOrEqual(Math.min(...allY));
    expect(scene.viewBox.x + scene.viewBox.width).toBeGreaterThanOrEqual(Math.max(...allX));
    expect(scene.viewBox.y + scene.viewBox.height).toBeGreaterThanOrEqual(Math.max(...allY));
  });

  it("marks each bonus-slot tile with the generic badge at its right corner", () => {
    const b = byId("B");
    expect(b.bonusGlyph).toBe("glyph-bonus-generic");
    expect(b.glyphAnchors.bonus).toBeDefined();
    // Anchored to the right of the tile centroid — the E-vertex corner.
    expect(b.glyphAnchors.bonus!.x).toBeGreaterThan(b.centroid.x);
    expect(byId("A").bonusGlyph).toBeUndefined();
  });
});
