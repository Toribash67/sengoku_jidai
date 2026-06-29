import { describe, expect, it } from "vitest";
import { compileHexMap } from "../../../src/maps/hex/compile.js";
import { FIXTURE_HEX_MAP } from "../../../src/maps/hex/fixtures.js";
import type { HexMapSource } from "../../../src/maps/hex/source.js";

describe("compileHexMap", () => {
  const { definition, layout } = compileHexMap(FIXTURE_HEX_MAP);
  const areas = Object.values(definition.areas);

  it("emits one area per tile, carrying features", () => {
    expect(areas).toHaveLength(5);
    expect(definition.areas.A!.hq).toBe("red");
    expect(definition.areas.E!.hq).toBe("black");
    expect(definition.areas.B!.valueStars).toBe(1);
    expect(definition.areas.B!.shellable).toBe(true);
    expect(definition.areas.D!.harbor).toBe(true);
    expect(definition.areas.D!.ports).toEqual(["C"]);
    expect(definition.areas.A!.hq).not.toBeUndefined();
    expect(definition.areas.C!.hq).toBeNull();
  });

  it("derives adjacency from shared hex edges (sorted)", () => {
    expect(definition.areas.A!.adjacent).toEqual(["B", "C", "D"]);
    expect(definition.areas.B!.adjacent).toEqual(["A", "C", "E"]);
    expect(definition.areas.C!.adjacent).toEqual(["A", "B", "D"]);
    expect(definition.areas.D!.adjacent).toEqual(["A", "C"]);
    expect(definition.areas.E!.adjacent).toEqual(["B"]);
  });

  it("produces a mixed land<->sea edge (A land touches C sea)", () => {
    expect(definition.areas.A!.kind).toBe("land");
    expect(definition.areas.C!.kind).toBe("sea");
    expect(definition.areas.A!.adjacent).toContain("C");
    expect(definition.areas.C!.adjacent).toContain("A");
  });

  it("does NOT make corner-only touching tiles adjacent", () => {
    // Two single-hex tiles that share only a corner: (0,0) and (1,1).
    const cornerMap: HexMapSource = {
      id: "corner",
      name: "Corner",
      layout: { size: 1, originX: 0, originY: 0 },
      tiles: [
        { id: "X", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
        { id: "Y", kind: "land", hexes: [{ q: 1, r: 1 }], features: {} }
      ],
      startingDeployment: {},
      bonusSlots: []
    };
    const compiled = compileHexMap(cornerMap);
    expect(compiled.definition.areas.X!.adjacent).toEqual([]);
    expect(compiled.definition.areas.Y!.adjacent).toEqual([]);
  });

  it("has symmetric adjacency with no dangling refs", () => {
    for (const a of areas) {
      for (const id of [...a.adjacent, ...a.ports]) {
        expect(definition.areas[id], `${a.id} -> ${id}`).toBeDefined();
      }
      for (const id of a.adjacent) {
        expect(definition.areas[id]!.adjacent, `${a.id} <-> ${id}`).toContain(a.id);
      }
    }
  });

  it("keeps every shellable land bordering a sea and every sea bordering a land", () => {
    for (const a of areas) {
      if (a.shellable) {
        expect(a.adjacent.some((id) => definition.areas[id]!.kind === "sea")).toBe(true);
      }
      if (a.kind === "sea") {
        expect(a.adjacent.some((id) => definition.areas[id]!.kind === "land")).toBe(true);
      }
    }
  });

  it("carries id, name, and bonus slots", () => {
    expect(definition.id).toBe("fixture");
    expect(definition.name).toBe("Fixture");
    expect(definition.bonusSlots).toEqual(["B"]);
  });

  it("builds a layout with per-tile hexes and pixel bounds", () => {
    expect(layout.size).toBe(114);
    expect(layout.tiles.B!.hexes).toHaveLength(2);
    expect(layout.bounds.maxX).toBeGreaterThan(layout.bounds.minX);
    expect(layout.bounds.maxY).toBeGreaterThan(layout.bounds.minY);
  });

  it("is deterministic", () => {
    const a = compileHexMap(FIXTURE_HEX_MAP);
    const b = compileHexMap(FIXTURE_HEX_MAP);
    expect(JSON.stringify(a.definition)).toEqual(JSON.stringify(b.definition));
  });

  it("validates before compiling (throws on a bad map)", () => {
    expect(() => compileHexMap({ ...structuredClone(FIXTURE_HEX_MAP), tiles: [] })).toThrow(
      /no tiles/
    );
  });
});
