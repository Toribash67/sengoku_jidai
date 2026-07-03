import { FIXTURE_HEX_MAP, getMap } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";

function makeLibrary(): MapLibrary {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return new MapLibrary(db);
}

/** A fresh copy of the SP1 fixture map (the library rewrites ids; never mutate the import). */
function fixtureSource() {
  return structuredClone(FIXTURE_HEX_MAP);
}

describe("MapLibrary create/get/list", () => {
  it("stores a valid map, assigns a uuid id, and registers it with the engine", () => {
    const library = makeLibrary();
    const result = library.create(fixtureSource());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).not.toBe("fixture"); // server-assigned
    expect(result.value.source.id).toBe(result.value.id); // source id rewritten to match
    expect(result.value.builtin).toBe(false);
    // Registered: the engine can resolve it.
    expect(getMap(result.value.id).id).toBe(result.value.id);
    // Retrievable.
    expect(library.get(result.value.id)?.name).toBe("Fixture");
    expect(library.has(result.value.id)).toBe(true);
  });

  it("lists built-ins first, then library maps", () => {
    const library = makeLibrary();
    const created = library.create(fixtureSource());
    expect(created.ok).toBe(true);

    const maps = library.list();
    expect(maps[0]).toMatchObject({ id: "rivers", builtin: true, updatedAt: null });
    expect(maps[0]!.tileCount).toBeGreaterThan(20);
    const custom = maps.find((m) => !m.builtin)!;
    expect(custom).toMatchObject({ name: "Fixture", tileCount: 5 });
    expect(custom.updatedAt).not.toBeNull();
  });

  it("serves built-in maps through get()", () => {
    const library = makeLibrary();
    const rivers = library.get("rivers");
    expect(rivers).not.toBeNull();
    expect(rivers!.builtin).toBe(true);
    expect(rivers!.source.tiles.length).toBeGreaterThan(20);
  });

  it("returns null / false for unknown ids", () => {
    const library = makeLibrary();
    expect(library.get("nope")).toBeNull();
    expect(library.has("nope")).toBe(false);
  });

  it("rejects a structurally invalid map (disconnected tile) with the engine's message", () => {
    const library = makeLibrary();
    const bad = fixtureSource();
    // Two hexes that do not share an edge.
    bad.tiles[0]!.hexes = [
      { q: 0, r: 0 },
      { q: 5, r: 5 }
    ];
    const result = library.create(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalidMap");
    expect(result.error.message).toContain("not edge-connected");
  });

  it("rejects an unplayable map (dry-run setup failure) as invalidMap", () => {
    const library = makeLibrary();
    const bad = fixtureSource();
    // The default (Rivers) ruleset's bonusSet has exactly 5 entries (one per BonusType),
    // matching this fixture's 5 tiles, so `bonusSlots = all tile ids` alone does not
    // exceed it. Duplicating one tile id (still a valid, existing tile -> passes
    // validateHexMap, which only checks reference validity, not uniqueness) pushes the
    // slot count to 6, which DOES exceed the ruleset's bonus count, so the failure
    // surfaces only at the dry-run createInitialState stage, as intended.
    const ids = bad.tiles.map((t) => t.id);
    bad.bonusSlots = [...ids, ids[0]!];
    const result = library.create(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalidMap");
    expect(result.error.message).toContain("bonus");
  });
});
