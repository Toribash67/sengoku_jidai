import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { TerrainStore } from "../src/maps/terrainStore.js";

function db() {
  const d = openDatabase(":memory:");
  runMigrations(d);
  // A maps row for the FK (map_terrain.map_id references maps.id).
  d.prepare(
    "INSERT INTO maps (id, name, source_json, created_at, updated_at) VALUES (?,?,?,?,?)"
  ).run("m1", "M1", "{}", "t", "t");
  return d;
}

describe("TerrainStore", () => {
  it("reports none for an unknown map", () => {
    const store = new TerrainStore(db());
    expect(store.status("m1")).toBe("none");
    expect(store.webp("m1")).toBeNull();
  });

  it("round-trips pending → ready with the blob", () => {
    const store = new TerrainStore(db());
    store.markPending("m1");
    expect(store.status("m1")).toBe("pending");
    const bytes = Buffer.from([1, 2, 3, 4]);
    store.saveReady("m1", bytes);
    expect(store.status("m1")).toBe("ready");
    expect(store.webp("m1")).toEqual(bytes);
    expect(store.updatedAt("m1")).not.toBeNull();
  });

  it("records failures with a message", () => {
    const store = new TerrainStore(db());
    store.markPending("m1");
    store.markFailed("m1", "fal exploded");
    expect(store.status("m1")).toBe("failed");
    expect(store.webp("m1")).toBeNull();
  });

  it("resetInterrupted flips pending rows to failed", () => {
    const store = new TerrainStore(db());
    store.markPending("m1");
    store.resetInterrupted();
    expect(store.status("m1")).toBe("failed");
  });

  it("cascade-deletes terrain with its map", () => {
    const d = db();
    const store = new TerrainStore(d);
    store.saveReady("m1", Buffer.from([9]));
    d.prepare("DELETE FROM maps WHERE id = ?").run("m1");
    expect(store.status("m1")).toBe("none");
  });
});
