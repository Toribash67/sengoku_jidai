import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";

function db() {
  const d = openDatabase(":memory:");
  runMigrations(d);
  // A maps row for the FK (map_terrains.map_id references maps.id).
  d.prepare(
    "INSERT INTO maps (id, name, source_json, created_at, updated_at) VALUES (?,?,?,?,?)"
  ).run("m1", "M1", "{}", "t", "t");
  return d;
}

describe("TerrainStore", () => {
  it("reports empty for a map with no terrains", () => {
    const s = new TerrainStore(db());
    expect(s.list("m1")).toEqual([]);
    expect(s.countForMap("m1")).toBe(0);
  });

  it("creates, lists (oldest first), and round-trips pending -> ready by id", () => {
    const s = new TerrainStore(db());
    const id = s.create("m1", "Terrain 1", "antique");
    expect(s.countForMap("m1")).toBe(1);
    const [info] = s.list("m1");
    expect(info).toMatchObject({ id, name: "Terrain 1", styleId: "antique", status: "pending" });
    const bytes = Buffer.from([1, 2, 3, 4]);
    s.markReadyById(id, bytes);
    expect(s.get(id)?.status).toBe("ready");
    expect(s.webpById(id)).toEqual(bytes);
    expect(s.updatedAtById(id)).not.toBeNull();
    // markPendingById resets a ready row back to pending (regenerate path).
    s.markPendingById(id);
    expect(s.get(id)?.status).toBe("pending");
    expect(s.webpById(id)).toBeNull();
  });

  it("records failure by id", () => {
    const s = new TerrainStore(db());
    const id = s.create("m1", "Terrain 1", "ink");
    s.markFailedById(id, "boom");
    expect(s.get(id)?.status).toBe("failed");
    expect(s.webpById(id)).toBeNull();
    expect(s.styleIdOf(id)).toBe("ink");
  });

  it("renames and removes, returning false for unknown ids", () => {
    const s = new TerrainStore(db());
    const id = s.create("m1", "Terrain 1", "antique");
    expect(s.rename(id, "Coast")).toBe(true);
    expect(s.get(id)?.name).toBe("Coast");
    expect(s.rename("nope", "x")).toBe(false);
    expect(s.remove(id)).toBe(true);
    expect(s.get(id)).toBeNull();
    expect(s.remove("nope")).toBe(false);
  });

  it("lists oldest-first and promotes the next after a delete", () => {
    const s = new TerrainStore(db());
    const a = s.create("m1", "Terrain 1", "antique");
    const b = s.create("m1", "Terrain 2", "antique");
    expect(s.list("m1").map((t) => t.id)).toEqual([a, b]);
    s.remove(a);
    expect(s.list("m1").map((t) => t.id)).toEqual([b]);
  });

  it("resetInterrupted flips pending to failed", () => {
    const s = new TerrainStore(db());
    const id = s.create("m1", "Terrain 1", "antique");
    s.resetInterrupted();
    expect(s.get(id)?.status).toBe("failed");
  });
});

function setup() {
  const d = openDatabase(":memory:");
  runMigrations(d);
  const library = new MapLibrary(d);
  const created = library.create(structuredClone(FIXTURE_HEX_MAP));
  if (!created.ok) throw new Error("fixture create failed");
  return { store: new TerrainStore(d), mapId: created.value.id };
}

describe("TerrainStore candidates", () => {
  it("adds, reads, counts and clears candidates and enters choosing", () => {
    const { store, mapId } = setup();
    const id = store.create(mapId, "Terrain 1", "fantasy");
    store.addCandidate(id, 0, Buffer.from("aaa"));
    store.addCandidate(id, 1, Buffer.from("bbbb"));
    store.markChoosing(id);
    expect(store.get(id)?.status).toBe("choosing");
    expect(store.candidateCount(id)).toBe(2);
    expect(store.candidateWebp(id, 0)?.toString()).toBe("aaa");
    expect(store.candidateWebp(id, 1)?.toString()).toBe("bbbb");
    store.clearCandidates(id);
    expect(store.candidateCount(id)).toBe(0);
    expect(store.candidateWebp(id, 0)).toBeNull();
  });

  it("markReady clears candidates; markFinalizing keeps them", () => {
    const { store, mapId } = setup();
    const id = store.create(mapId, "Terrain 1", "fantasy");
    store.addCandidate(id, 0, Buffer.from("x"));
    store.addCandidate(id, 1, Buffer.from("y"));
    store.markChoosing(id);
    store.markFinalizing(id);
    expect(store.get(id)?.status).toBe("pending");
    expect(store.candidateCount(id)).toBe(2); // preserved for retry/revert
    store.markReadyById(id, Buffer.from("RIFFxxxxWEBP"));
    expect(store.get(id)?.status).toBe("ready");
    expect(store.candidateCount(id)).toBe(0); // consumed
  });
});
