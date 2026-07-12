import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
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
  it("reports empty/none for a map with no terrains", () => {
    const s = new TerrainStore(db());
    expect(s.list("m1")).toEqual([]);
    expect(s.countForMap("m1")).toBe(0);
    expect(s.status("m1")).toBe("none");
    expect(s.webp("m1")).toBeNull();
    expect(s.primaryId("m1")).toBeNull();
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

  it("primary is the oldest row and promotes after delete", () => {
    const s = new TerrainStore(db());
    const a = s.create("m1", "Terrain 1", "antique");
    const b = s.create("m1", "Terrain 2", "antique");
    s.markReadyById(a, Buffer.from([1]));
    s.markReadyById(b, Buffer.from([2]));
    expect(s.primaryId("m1")).toBe(a);
    expect(s.webp("m1")).toEqual(Buffer.from([1]));
    s.remove(a);
    expect(s.primaryId("m1")).toBe(b);
    expect(s.webp("m1")).toEqual(Buffer.from([2]));
  });

  it("resetInterrupted flips pending to failed", () => {
    const s = new TerrainStore(db());
    const id = s.create("m1", "Terrain 1", "antique");
    s.resetInterrupted();
    expect(s.get(id)?.status).toBe("failed");
  });
});
