import type { TerrainStatus } from "@sengoku-jidai/shared";
import type { SqliteDatabase } from "../persistence/database.js";

interface TerrainRow {
  status: Exclude<TerrainStatus, "none">;
  webp: Buffer | null;
  updated_at: string;
}

/** Owns the `map_terrain` table: per-map generation status + the webp blob. A map with no
 *  row reports status "none". */
export class TerrainStore {
  constructor(private readonly db: SqliteDatabase) {}

  private row(mapId: string): TerrainRow | undefined {
    return this.db
      .prepare("SELECT status, webp, updated_at FROM map_terrain WHERE map_id = ?")
      .get(mapId) as TerrainRow | undefined;
  }

  status(mapId: string): TerrainStatus {
    return this.row(mapId)?.status ?? "none";
  }

  updatedAt(mapId: string): string | null {
    return this.row(mapId)?.updated_at ?? null;
  }

  webp(mapId: string): Buffer | null {
    const row = this.row(mapId);
    return row?.status === "ready" && row.webp ? row.webp : null;
  }

  private upsert(mapId: string, status: string, webp: Buffer | null, error: string | null): void {
    this.db
      .prepare(
        `INSERT INTO map_terrain (map_id, status, webp, error, updated_at)
         VALUES (@id, @status, @webp, @error, @now)
         ON CONFLICT(map_id) DO UPDATE SET
           status = @status, webp = @webp, error = @error, updated_at = @now`
      )
      .run({ id: mapId, status, webp, error, now: new Date().toISOString() });
  }

  markPending(mapId: string): void {
    this.upsert(mapId, "pending", null, null);
  }

  saveReady(mapId: string, webp: Buffer): void {
    this.upsert(mapId, "ready", webp, null);
  }

  markFailed(mapId: string, error: string): void {
    this.upsert(mapId, "failed", null, error);
  }

  /** Boot recovery: in-process generation cannot survive a restart, so any row still
   *  "pending" has no worker behind it — flip it to failed so the author can retry. */
  resetInterrupted(): void {
    this.db
      .prepare(
        "UPDATE map_terrain SET status = 'failed', error = 'interrupted', updated_at = ? WHERE status = 'pending'"
      )
      .run(new Date().toISOString());
  }
}
