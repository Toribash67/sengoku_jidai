import { randomUUID } from "node:crypto";
import {
  compileHexMap,
  createInitialState,
  registerMap,
  riversSource,
  validateHexMap
} from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import type { HexMapSourceDto, MapDetail, MapSummary } from "@sengoku-jidai/shared";
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

  get(id: string): MapDetail | null {
    const builtin = BUILTIN_SOURCES.find((source) => source.id === id);
    if (builtin) {
      // `HexMapSource` (engine) and the wire DTO are structurally identical — see the
      // drift guard above.
      return {
        id,
        name: builtin.name,
        builtin: true,
        updatedAt: null,
        source: builtin as unknown as HexMapSourceDto
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
        source: candidate as unknown as HexMapSourceDto
      }
    };
  }

  /**
   * Full upload validation: engine structural rules, compilation, then a dry-run
   * game setup under a throwaway id. The throwaway registration is deliberate —
   * registering the REAL id before validation passes would, on update, corrupt
   * live games if a later stage then failed. The stale `dryrun-*` entry is
   * unreachable (uuid) and vanishes on restart.
   * Returns the failure message, or null when valid.
   */
  private validate(candidate: HexMapSource): string | null {
    try {
      validateHexMap(candidate);
      const dryRunId = `dryrun-${randomUUID()}`;
      registerMap(compileHexMap({ ...candidate, id: dryRunId }).definition);
      createInitialState({
        gameId: dryRunId,
        mode: "hotseat",
        seed: "map-library-dry-run",
        mapId: dryRunId
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
}
