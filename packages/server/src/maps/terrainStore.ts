import { randomUUID } from "node:crypto";
import type { TerrainInfo, TerrainStatus } from "@sengoku-jidai/shared";
import type { SqliteDatabase } from "../persistence/database.js";

interface Row {
  id: string;
  map_id: string;
  name: string;
  style_id: string;
  status: Exclude<TerrainStatus, "none">;
  webp: Buffer | null;
  updated_at: string;
}

/** Owns `map_terrains`: many named, styled terrains per map. Each terrain is addressed by its
 *  surrogate id. */
export class TerrainStore {
  constructor(private readonly db: SqliteDatabase) {}

  private toInfo(r: Row): TerrainInfo {
    return {
      id: r.id,
      name: r.name,
      styleId: r.style_id as TerrainInfo["styleId"],
      status: r.status,
      updatedAt: r.updated_at
    };
  }

  create(mapId: string, name: string, styleId: string): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO map_terrains (id, map_id, name, style_id, status, webp, error, created_at, updated_at)
         VALUES (@id, @mapId, @name, @styleId, 'pending', NULL, NULL, @now, @now)`
      )
      .run({ id, mapId, name, styleId, now });
    return id;
  }

  list(mapId: string): TerrainInfo[] {
    return (
      this.db
        .prepare("SELECT * FROM map_terrains WHERE map_id = ? ORDER BY created_at ASC, rowid ASC")
        .all(mapId) as Row[]
    ).map((r) => this.toInfo(r));
  }

  get(terrainId: string): TerrainInfo | null {
    const r = this.db.prepare("SELECT * FROM map_terrains WHERE id = ?").get(terrainId) as
      | Row
      | undefined;
    return r ? this.toInfo(r) : null;
  }

  countForMap(mapId: string): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM map_terrains WHERE map_id = ?").get(mapId) as {
        n: number;
      }
    ).n;
  }

  styleIdOf(terrainId: string): string | null {
    const r = this.db.prepare("SELECT style_id FROM map_terrains WHERE id = ?").get(terrainId) as
      | { style_id: string }
      | undefined;
    return r?.style_id ?? null;
  }

  rename(terrainId: string, name: string): boolean {
    return (
      this.db
        .prepare("UPDATE map_terrains SET name = ?, updated_at = ? WHERE id = ?")
        .run(name, new Date().toISOString(), terrainId).changes > 0
    );
  }

  remove(terrainId: string): boolean {
    return this.db.prepare("DELETE FROM map_terrains WHERE id = ?").run(terrainId).changes > 0;
  }

  markPendingById(terrainId: string): void {
    this.db
      .prepare(
        "UPDATE map_terrains SET status = 'pending', webp = NULL, error = NULL, updated_at = ? WHERE id = ?"
      )
      .run(new Date().toISOString(), terrainId);
  }

  markReadyById(terrainId: string, webp: Buffer): void {
    this.db
      .prepare(
        "UPDATE map_terrains SET status = 'ready', webp = ?, error = NULL, updated_at = ? WHERE id = ?"
      )
      .run(webp, new Date().toISOString(), terrainId);
  }

  markFailedById(terrainId: string, error: string): void {
    this.db
      .prepare(
        "UPDATE map_terrains SET status = 'failed', webp = NULL, error = ?, updated_at = ? WHERE id = ?"
      )
      .run(error, new Date().toISOString(), terrainId);
  }

  webpById(terrainId: string): Buffer | null {
    const r = this.db
      .prepare("SELECT status, webp FROM map_terrains WHERE id = ?")
      .get(terrainId) as Pick<Row, "status" | "webp"> | undefined;
    return r?.status === "ready" && r.webp ? r.webp : null;
  }

  updatedAtById(terrainId: string): string | null {
    const r = this.db.prepare("SELECT updated_at FROM map_terrains WHERE id = ?").get(terrainId) as
      | { updated_at: string }
      | undefined;
    return r?.updated_at ?? null;
  }

  /** Boot recovery: an in-process generation cannot survive a restart, so any "pending" row is
   *  orphaned — flip it to failed so the author can retry. */
  resetInterrupted(): void {
    this.db
      .prepare(
        "UPDATE map_terrains SET status = 'failed', error = 'interrupted', updated_at = ? WHERE status = 'pending'"
      )
      .run(new Date().toISOString());
  }
}
