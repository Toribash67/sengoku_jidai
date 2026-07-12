import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/persistence/database.js";

// Builds a pre-004 shape by hand (maps + the 003 map_terrain table), then applies ONLY the 004
// SQL, so we test the carry-over/DROP in isolation.
describe("migration 004 (map_terrain -> map_terrains)", () => {
  it("carries an existing terrain over as 'Terrain 1' with its blob, then drops the old table", () => {
    const db = openDatabase(":memory:");
    db.exec(`
      CREATE TABLE maps (id TEXT PRIMARY KEY, name TEXT, source_json TEXT,
        created_at TEXT, updated_at TEXT);
      CREATE TABLE map_terrain (map_id TEXT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
        status TEXT NOT NULL, webp BLOB, error TEXT, updated_at TEXT NOT NULL);
      INSERT INTO maps VALUES ('m1','M','{}','t','t');
    `);
    const blob = Buffer.from([9, 8, 7]);
    db.prepare(
      "INSERT INTO map_terrain (map_id, status, webp, error, updated_at) VALUES (?,?,?,?,?)"
    ).run("m1", "ready", blob, null, "2026-01-01T00:00:00.000Z");

    const sql = readFileSync(
      fileURLToPath(new URL("../migrations/004_map_terrains.sql", import.meta.url)),
      "utf8"
    );
    db.exec(sql);

    const rows = db.prepare("SELECT * FROM map_terrains").all() as Array<{
      map_id: string;
      name: string;
      style_id: string;
      status: string;
      webp: Buffer;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].map_id).toBe("m1");
    expect(rows[0].name).toBe("Terrain 1");
    expect(rows[0].style_id).toBe("antique");
    expect(rows[0].status).toBe("ready");
    expect(Buffer.from(rows[0].webp)).toEqual(blob);
    expect(() => db.prepare("SELECT 1 FROM map_terrain").get()).toThrow(/no such table/);
  });
});
