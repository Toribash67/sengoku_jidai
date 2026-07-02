import { describe, it, expect } from "vitest";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { buildScene } from "../src/scene.js";

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
