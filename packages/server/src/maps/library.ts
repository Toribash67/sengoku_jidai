import { randomUUID } from "node:crypto";
import {
  compileHexMap,
  createInitialState,
  registerMap,
  riversSource,
  validateHexMap
} from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import type {
  HexMapSourceDto,
  MapDetail,
  MapSummary,
  TerrainInfo,
  TerrainStatus
} from "@sengoku-jidai/shared";
import type { SqliteDatabase } from "../persistence/database.js";

/** Compile-time drift guard: the shared wire schema must produce the engine's
 *  `HexMapSource`. If either side changes shape, this stops compiling. */
const _wireMatchesEngine = (v: HexMapSourceDto): HexMapSource => v;
void _wireMatchesEngine;

export interface MapLibraryError {
  code: "invalidMap" | "mapNotFound" | "mapInUse" | "builtinMap";
  message: string;
}

export type MapResult<T> = { ok: true; value: T } | { ok: false; error: MapLibraryError };

const BUILTIN_SOURCES: readonly HexMapSource[] = [riversSource];

/**
 * Fixed id used for the dry-run validation pass (see `validate()`). Every
 * validation reuses this single id, so `registerMap` simply replaces the
 * previous dry-run entry instead of accumulating a new one per attempt. Safe
 * because the server is single-threaded and validations never interleave.
 */
const DRY_RUN_MAP_ID = "map-library-dry-run";

interface MapRow {
  id: string;
  name: string;
  source_json: string;
  updated_at: string;
}

/**
 * Owns the `maps` table and the engine map-registry lifecycle: every stored map is
 * registered (`registerMap`) at boot and on write, so game creation, snapshot
 * rehydration, and view building resolve custom maps exactly like built-ins.
 * Built-ins (Rivers) are served read-only through the same interface.
 */
export class MapLibrary {
  constructor(private readonly db: SqliteDatabase) {}

  list(): MapSummary[] {
    const builtins: MapSummary[] = BUILTIN_SOURCES.map((source) => ({
      id: source.id,
      name: source.name,
      tileCount: source.tiles.length,
      builtin: true,
      updatedAt: null
    }));
    const rows = this.db
      .prepare("SELECT id, name, source_json, updated_at FROM maps ORDER BY updated_at DESC")
      .all() as MapRow[];
    const stored: MapSummary[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      tileCount: (JSON.parse(row.source_json) as HexMapSource).tiles.length,
      builtin: false,
      updatedAt: row.updated_at
    }));
    return [...builtins, ...stored];
  }

  get(
    id: string,
    terrainStatus?: (id: string) => TerrainStatus,
    terrainsFn?: (id: string) => TerrainInfo[]
  ): MapDetail | null {
    const builtin = BUILTIN_SOURCES.find((source) => source.id === id);
    if (builtin) {
      // `HexMapSource` (engine) and the wire DTO are structurally identical — see the
      // drift guard above.
      return {
        id,
        name: builtin.name,
        builtin: true,
        updatedAt: null,
        terrain: "none",
        terrains: [],
        source: builtin
      };
    }
    const row = this.db
      .prepare("SELECT id, name, source_json, updated_at FROM maps WHERE id = ?")
      .get(id) as MapRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      builtin: false,
      updatedAt: row.updated_at,
      terrain: terrainStatus ? terrainStatus(row.id) : "none",
      terrains: terrainsFn ? terrainsFn(row.id) : [],
      source: JSON.parse(row.source_json) as HexMapSourceDto
    };
  }

  has(id: string): boolean {
    if (BUILTIN_SOURCES.some((source) => source.id === id)) {
      return true;
    }
    return this.db.prepare("SELECT 1 FROM maps WHERE id = ?").get(id) !== undefined;
  }

  create(source: HexMapSourceDto): MapResult<MapDetail> {
    const id = randomUUID();
    const candidate: HexMapSource = { ...source, id };
    const invalid = this.validate(candidate);
    if (invalid) {
      return { ok: false, error: { code: "invalidMap", message: invalid } };
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO maps (id, name, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, candidate.name, JSON.stringify(candidate), now, now);
    registerMap(compileHexMap(candidate).definition);
    return {
      ok: true,
      value: {
        id,
        name: candidate.name,
        builtin: false,
        updatedAt: now,
        terrain: "none",
        terrains: [],
        source: candidate
      }
    };
  }

  /** Boot-time registration of every stored map. A row that fails to parse or
   *  compile (e.g. engine schema drift) is logged and skipped — one bad map must
   *  not take the server down. Games referencing a skipped map 500 until fixed. */
  loadAll(log?: { error: (obj: object, msg: string) => void }): void {
    const rows = this.db.prepare("SELECT id, source_json FROM maps").all() as Pick<
      MapRow,
      "id" | "source_json"
    >[];
    for (const row of rows) {
      try {
        const source = JSON.parse(row.source_json) as HexMapSource;
        registerMap(compileHexMap(source).definition);
      } catch (err) {
        log?.error({ err, mapId: row.id }, "Skipping stored map that failed to load");
      }
    }
  }

  update(id: string, source: HexMapSourceDto): MapResult<MapDetail> {
    const guard = this.writeGuard(id);
    if (guard) {
      return { ok: false, error: guard };
    }
    const candidate: HexMapSource = { ...source, id };
    const invalid = this.validate(candidate);
    if (invalid) {
      return { ok: false, error: { code: "invalidMap", message: invalid } };
    }
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE maps SET name = ?, source_json = ?, updated_at = ? WHERE id = ?")
      .run(candidate.name, JSON.stringify(candidate), now, id);
    registerMap(compileHexMap(candidate).definition);
    return {
      ok: true,
      value: {
        id,
        name: candidate.name,
        builtin: false,
        updatedAt: now,
        terrain: "none",
        terrains: [],
        source: candidate
      }
    };
  }

  delete(id: string): MapResult<null> {
    const guard = this.writeGuard(id);
    if (guard) {
      return { ok: false, error: guard };
    }
    this.db.prepare("DELETE FROM maps WHERE id = ?").run(id);
    // The in-memory registry entry is left behind until restart — harmless:
    // create-game existence checks go through the library, and uuid ids
    // cannot collide with a future upload.
    return { ok: true, value: null };
  }

  /** Shared update/delete preconditions: built-ins are read-only, the row must
   *  exist, and maps referenced by any game are immutable (upload a copy). */
  private writeGuard(id: string): MapLibraryError | null {
    if (BUILTIN_SOURCES.some((source) => source.id === id)) {
      return { code: "builtinMap", message: "Built-in maps cannot be modified." };
    }
    if (this.db.prepare("SELECT 1 FROM maps WHERE id = ?").get(id) === undefined) {
      return { code: "mapNotFound", message: "Map was not found." };
    }
    if (this.db.prepare("SELECT 1 FROM games WHERE map_id = ? LIMIT 1").get(id) !== undefined) {
      return {
        code: "mapInUse",
        message: "Games already reference this map; upload a copy instead."
      };
    }
    return null;
  }

  /**
   * Full upload validation: engine structural rules, compilation, then a dry-run
   * game setup under a fixed throwaway id (`DRY_RUN_MAP_ID`). The throwaway
   * registration is deliberate — registering the REAL id before validation
   * passes would, on update, corrupt live games if a later stage then failed.
   * The dry-run entry is unreachable from the outside (create-game existence
   * checks go through the library, never the raw registry) and, because every
   * validation reuses the same id, the registry holds at most one dry-run
   * entry at a time — no unbounded growth.
   * Returns the failure message, or null when valid.
   */
  private validate(candidate: HexMapSource): string | null {
    try {
      validateHexMap(candidate);
      registerMap(compileHexMap({ ...candidate, id: DRY_RUN_MAP_ID }).definition);
      createInitialState({
        gameId: DRY_RUN_MAP_ID,
        mode: "hotseat",
        seed: DRY_RUN_MAP_ID,
        mapId: DRY_RUN_MAP_ID
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
}
