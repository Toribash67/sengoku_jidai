import { FIXTURE_HEX_MAP, getMap } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import type { SqliteDatabase } from "../src/persistence/database.js";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";

function makeLibrary(): MapLibrary {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return new MapLibrary(db);
}

function makeDb(): SqliteDatabase {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
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

  it("get() reports terrain status from the provided resolver", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const library = new MapLibrary(db);
    const created = library.create(structuredClone(FIXTURE_HEX_MAP));
    if (!created.ok) throw new Error("create failed");
    const id = created.value.id;
    // default: none
    expect(library.get(id)?.terrain).toBe("none");
    // with a resolver
    expect(library.get(id, () => "ready")?.terrain).toBe("ready");
    // built-in always none
    expect(library.get("rivers", () => "ready")?.terrain).toBe("none");
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

describe("MapLibrary update/delete", () => {
  it("updates an unreferenced map in place and re-registers it", () => {
    const db = makeDb();
    const library = new MapLibrary(db);
    const created = library.create(fixtureSource());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const renamed = { ...fixtureSource(), name: "Fixture v2" };
    const updated = library.update(created.value.id, renamed);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.id).toBe(created.value.id);
    expect(updated.value.name).toBe("Fixture v2");
    expect(library.get(created.value.id)?.name).toBe("Fixture v2");
    expect(getMap(created.value.id).name).toBe("Fixture v2");
  });

  it("rejects update and delete once a game references the map", () => {
    const db = makeDb();
    const library = new MapLibrary(db);
    const created = library.create(fixtureSource());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO games (id, map_id, mode, ruleset_id, ruleset_version, ruleset_hash, status, current_revision, created_at, updated_at)
       VALUES ('g1', ?, 'hotseat', 'r', '1', 'h', 'active', 0, ?, ?)`
    ).run(created.value.id, now, now);

    const updated = library.update(created.value.id, fixtureSource());
    expect(updated).toMatchObject({ ok: false, error: { code: "mapInUse" } });
    const deleted = library.delete(created.value.id);
    expect(deleted).toMatchObject({ ok: false, error: { code: "mapInUse" } });
  });

  it("deletes an unreferenced map", () => {
    const library = new MapLibrary(makeDb());
    const created = library.create(fixtureSource());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(library.delete(created.value.id)).toMatchObject({ ok: true });
    expect(library.get(created.value.id)).toBeNull();
    expect(library.has(created.value.id)).toBe(false);
  });

  it("protects built-ins from update and delete", () => {
    const library = new MapLibrary(makeDb());
    expect(library.update("rivers", fixtureSource())).toMatchObject({
      ok: false,
      error: { code: "builtinMap" }
    });
    expect(library.delete("rivers")).toMatchObject({ ok: false, error: { code: "builtinMap" } });
  });

  it("returns mapNotFound for unknown ids", () => {
    const library = new MapLibrary(makeDb());
    expect(library.update("nope", fixtureSource())).toMatchObject({
      ok: false,
      error: { code: "mapNotFound" }
    });
    expect(library.delete("nope")).toMatchObject({ ok: false, error: { code: "mapNotFound" } });
  });
});

describe("MapLibrary loadAll", () => {
  it("registers every stored map at boot", () => {
    const db = makeDb();
    const writer = new MapLibrary(db);
    const created = writer.create(fixtureSource());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // A fresh library over the same db (simulating a restart) re-registers.
    // registerMap is idempotent (replace), so re-loading is safe.
    const booted = new MapLibrary(db);
    booted.loadAll();
    expect(getMap(created.value.id).id).toBe(created.value.id);
  });

  it("skips a corrupt row and keeps loading the rest", () => {
    const db = makeDb();
    const library = new MapLibrary(db);
    const good = library.create(fixtureSource());
    expect(good.ok).toBe(true);
    if (!good.ok) return;

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO maps (id, name, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("corrupt-map", "Corrupt", "{not json", now, now);

    const errors: string[] = [];
    new MapLibrary(db).loadAll({ error: (_obj, msg) => errors.push(msg) });
    expect(errors).toHaveLength(1);
    expect(getMap(good.value.id).id).toBe(good.value.id);
  });
});
