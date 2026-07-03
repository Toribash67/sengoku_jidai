# Server Map Library (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Custom hex maps become server data — uploaded via an HTTP API, stored in sqlite, registered into the engine's map registry, and rendered/playable in the browser by map id.

**Architecture:** A `MapLibrary` class in the server owns a new `maps` sqlite table and the engine-registry lifecycle (boot-time `loadAll`, per-upload validate→register). Routes expose CRUD under `/api/maps`, and `POST /api/games` gains an optional `mapId`. The web stops hardcoding the Rivers SVG: a small loader module fetches a game's map source by id, registers it client-side, and caches the assembled board SVG. Spec: `docs/superpowers/specs/2026-07-03-server-map-library-design.md`.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), Fastify + better-sqlite3 (server), zod (shared wire schemas), vitest, React + Vite (web).

## Global Constraints

- Two PRs: **PR 1** = Tasks 1–6 on branch `sp4-server-map-library` (already exists with the spec commit). **PR 2** = Tasks 7–9 on branch `sp4-web-custom-maps`, created off fresh `main` only AFTER PR 1 is merged. Do not start Task 7 until PR 1 is merged.
- Before every push run the full gate from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm exec prettier --check .` — all must pass.
- Commit messages end with the trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (blank line before it).
- **No engine rules/gameplay changes.** PR 1 touches no engine file. PR 2 touches exactly one engine file (`packages/engine/src/client.ts`) to re-export an existing function.
- The web package imports the engine ONLY via `@sengoku-jidai/engine/client` (ESLint-enforced).
- The shared package has NO engine dependency; its schemas mirror engine types by convention, with a compile-time drift guard in the server (which depends on both).
- The determinism anchor test (`packages/engine/test/game.test.ts` or similar in the engine package) must never change — nothing here alters the Rivers path.
- Error responses use the existing envelope: `{ error: { code, message, requestId } }` via the existing `sendError` helper.
- Run a single package's tests with `pnpm --filter @sengoku-jidai/<pkg> test`; a single file with `pnpm --filter @sengoku-jidai/<pkg> exec vitest run <path relative to package>`.

---

### Task 1: Shared wire schemas for map sources

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/api.ts`
- Test: `packages/shared/test/schemas.test.ts`

**Interfaces:**
- Consumes: existing `seatIdSchema` in `schemas.ts`.
- Produces (used by Tasks 2, 4, 5, 7): `hexMapSourceSchema`, `mapParamsSchema`, `createGameRequestSchema` (now with optional `mapId`), types `HexMapSourceDto`, `MapSummary`, `ListMapsResponse`, `MapDetail`. All exported from the package root (`index.ts` already re-exports `schemas.js` and `api.js` — verify, and add the re-export if a new symbol is missed).

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/test/schemas.test.ts`:

```ts
import { hexMapSourceSchema, mapParamsSchema } from "../src/schemas.js";

const VALID_MAP_SOURCE = {
  id: "fixture",
  name: "Fixture",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "A", kind: "land", hexes: [{ q: 0, r: 0 }], features: { hq: "red" } },
    { id: "B", kind: "land", hexes: [{ q: 1, r: 0 }], features: { hq: "black" } },
    { id: "C", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} }
  ],
  startingDeployment: { A: { seat: "red", troop: 3 } },
  bonusSlots: ["C"]
};

describe("hexMapSourceSchema", () => {
  it("accepts a well-formed map source", () => {
    const parsed = hexMapSourceSchema.parse(VALID_MAP_SOURCE);
    expect(parsed.tiles).toHaveLength(3);
    expect(parsed.tiles[0]!.features.hq).toBe("red");
  });

  it("rejects a tile with no hexes", () => {
    const bad = {
      ...VALID_MAP_SOURCE,
      tiles: [{ ...VALID_MAP_SOURCE.tiles[0]!, hexes: [] }]
    };
    expect(hexMapSourceSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid valueStars", () => {
    const bad = {
      ...VALID_MAP_SOURCE,
      tiles: [
        { ...VALID_MAP_SOURCE.tiles[0]!, features: { valueStars: 3 } },
        ...VALID_MAP_SOURCE.tiles.slice(1)
      ]
    };
    expect(hexMapSourceSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing layout", () => {
    const { layout: _layout, ...bad } = VALID_MAP_SOURCE;
    expect(hexMapSourceSchema.safeParse(bad).success).toBe(false);
  });
});

describe("createGameRequestSchema mapId", () => {
  it("accepts an optional mapId", () => {
    expect(createGameRequestSchema.parse({ mapId: "abc" }).mapId).toBe("abc");
    expect(createGameRequestSchema.parse({}).mapId).toBeUndefined();
  });

  it("rejects an empty mapId", () => {
    expect(createGameRequestSchema.safeParse({ mapId: "" }).success).toBe(false);
  });
});

describe("mapParamsSchema", () => {
  it("requires a non-empty mapId param", () => {
    expect(mapParamsSchema.parse({ mapId: "m1" }).mapId).toBe("m1");
    expect(mapParamsSchema.safeParse({ mapId: "" }).success).toBe(false);
  });
});
```

(Fold the new imports into the existing import statement at the top of the file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sengoku-jidai/shared test`
Expected: FAIL — `hexMapSourceSchema` is not exported.

- [ ] **Step 3: Implement the schemas**

Append to `packages/shared/src/schemas.ts` (before the `export type` block at the bottom):

```ts
/** Axial hex coordinate (mirrors engine `Axial`). */
export const axialSchema = z.object({ q: z.number().int(), r: z.number().int() });

/** Flat-top hex layout (mirrors engine `HexLayout`). */
export const hexLayoutSchema = z.object({
  size: z.number().positive(),
  originX: z.number(),
  originY: z.number()
});

export const hexTileFeaturesSchema = z.object({
  hq: seatIdSchema.optional(),
  valueStars: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  harbor: z.boolean().optional(),
  shellable: z.boolean().optional()
});

export const hexTileSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["land", "sea"]),
  hexes: z.array(axialSchema).min(1),
  features: hexTileFeaturesSchema,
  ports: z.array(z.string().min(1)).optional()
});

export const startingUnitsSchema = z.object({
  seat: seatIdSchema,
  troop: z.number().int().nonnegative().optional(),
  ship: z.number().int().nonnegative().optional()
});

/**
 * Wire mirror of the engine's `HexMapSource` (packages/engine/src/maps/hex/source.ts).
 * Must match that interface exactly; the server carries a compile-time drift guard
 * (see packages/server/src/maps/library.ts).
 */
export const hexMapSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  layout: hexLayoutSchema,
  tiles: z.array(hexTileSourceSchema).min(1),
  startingDeployment: z.record(startingUnitsSchema),
  bonusSlots: z.array(z.string().min(1))
});

export const mapParamsSchema = z.object({
  mapId: z.string().min(1)
});
```

In `createGameRequestSchema`, add the `mapId` field:

```ts
export const createGameRequestSchema = z.object({
  mode: gameModeSchema.default("hotseat"),
  seed: z.string().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  side: seatIdSchema.optional(),
  mapId: z.string().min(1).optional()
});
```

Add to the type exports at the bottom of `schemas.ts`:

```ts
export type HexMapSourceDto = z.infer<typeof hexMapSourceSchema>;
```

Append to `packages/shared/src/api.ts`:

```ts
import type { hexMapSourceSchema } from "./schemas.js";

export interface MapSummary {
  id: string;
  name: string;
  tileCount: number;
  builtin: boolean;
  /** ISO timestamp for library maps; null for built-ins (which live in code). */
  updatedAt: string | null;
}

export interface ListMapsResponse {
  maps: MapSummary[];
}

export interface MapDetail {
  id: string;
  name: string;
  builtin: boolean;
  updatedAt: string | null;
  source: z.infer<typeof hexMapSourceSchema>;
}
```

(`api.ts` already does `import type { z } from "zod"` — merge the schema import into the existing `import type { ... } from "./schemas.js"` line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/shared test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/api.ts packages/shared/test/schemas.test.ts
git commit -m "feat(shared): hex map source wire schema + createGame mapId

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Maps table migration + MapLibrary create/get/list

**Files:**
- Create: `packages/server/migrations/002_maps.sql`
- Create: `packages/server/src/maps/library.ts`
- Modify: `packages/server/src/persistence/database.ts` (migrations list)
- Test: `packages/server/test/mapLibrary.test.ts`

**Interfaces:**
- Consumes: `hexMapSourceSchema`/`HexMapSourceDto`, `MapDetail`, `MapSummary` from `@sengoku-jidai/shared` (Task 1); `compileHexMap`, `createInitialState`, `registerMap`, `getMap`, `riversSource`, `validateHexMap`, `FIXTURE_HEX_MAP`, type `HexMapSource` from `@sengoku-jidai/engine` (all already exported from the engine root).
- Produces (used by Tasks 3–5):

```ts
export interface MapLibraryError {
  code: "invalidMap" | "mapNotFound" | "mapInUse" | "builtinMap";
  message: string;
}
export type MapResult<T> = { ok: true; value: T } | { ok: false; error: MapLibraryError };

export class MapLibrary {
  constructor(db: SqliteDatabase);
  loadAll(log?: { error: (obj: object, msg: string) => void }): void; // Task 3
  list(): MapSummary[];
  get(id: string): MapDetail | null;
  has(id: string): boolean;
  create(source: HexMapSourceDto): MapResult<MapDetail>;
  update(id: string, source: HexMapSourceDto): MapResult<MapDetail>; // Task 3
  delete(id: string): MapResult<null>; // Task 3
}
```

- [ ] **Step 1: Write the migration**

Create `packages/server/migrations/002_maps.sql`:

```sql
CREATE TABLE IF NOT EXISTS maps (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

In `packages/server/src/persistence/database.ts`, change the migrations list:

```ts
const migrations = ["001_initial.sql", "002_maps.sql"];
```

- [ ] **Step 2: Write the failing tests**

Create `packages/server/test/mapLibrary.test.ts`:

```ts
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
    // More bonus slots than the default ruleset offers bonuses -> createInitialState throws.
    bad.bonusSlots = bad.tiles.map((t) => t.id);
    const result = library.create(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalidMap");
    expect(result.error.message).toContain("bonus");
  });
});
```

NOTE for the unplayable-map test: if `bonusSlots = all 5 tile ids` does NOT exceed the default ruleset's bonus count (check the error actually thrown by running the test), pad further by making the map bigger is NOT needed — instead check `packages/engine/src/rules.ts` for `bonusSet` length (Rivers has 3 bonus tiles, so the set likely has ≥3 entries but <5; 5 slots should exceed it). If it still passes validation, assert on whatever engine error a genuinely-broken setup gives — e.g. set `bad.startingDeployment = { NOPE: { seat: "red", troop: 1 } }` which `validateHexMap` rejects with `startingDeployment references unknown tile` (then the test name becomes "rejects a bad deployment"). Keep ONE test that fails at the dry-run stage if at all possible — the dry-run is spec-mandated; verify by temporarily logging which stage threw.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sengoku-jidai/server exec vitest run test/mapLibrary.test.ts`
Expected: FAIL — `Cannot find module '../src/maps/library.js'`.

- [ ] **Step 4: Implement MapLibrary (create/get/list/has + validation)**

Create `packages/server/src/maps/library.ts`:

```ts
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
      return { id, name: builtin.name, builtin: true, updatedAt: null, source: builtin };
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
      source: JSON.parse(row.source_json) as HexMapSource
    };
  }

  has(id: string): boolean {
    if (BUILTIN_SOURCES.some((source) => source.id === id)) {
      return true;
    }
    return (
      this.db.prepare("SELECT 1 FROM maps WHERE id = ?").get(id) !== undefined
    );
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
      value: { id, name: candidate.name, builtin: false, updatedAt: now, source: candidate }
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
```

NOTE: check `GameSetupOptions` in `packages/engine/src/game.ts:40-50` for the exact option names (`gameId`, `mode`, `seed`, `mapId`) before writing the dry-run call; adjust if they differ.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/server exec vitest run test/mapLibrary.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/server/migrations/002_maps.sql packages/server/src/persistence/database.ts packages/server/src/maps/library.ts packages/server/test/mapLibrary.test.ts
git commit -m "feat(server): maps table + MapLibrary create/get/list with upload validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: MapLibrary update/delete/loadAll

**Files:**
- Modify: `packages/server/src/maps/library.ts`
- Test: `packages/server/test/mapLibrary.test.ts`

**Interfaces:**
- Consumes: Task 2's `MapLibrary`, `MapResult`, `MapLibraryError`.
- Produces: `update(id, source): MapResult<MapDetail>`, `delete(id): MapResult<null>`, `loadAll(log?): void` on `MapLibrary` (used by Tasks 4–5).

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/test/mapLibrary.test.ts`. The in-use check needs a games row; insert it directly (the real create-game path is covered by Task 5's integration test, which doesn't exist yet):

```ts
import type { SqliteDatabase } from "../src/persistence/database.js";

function makeDb(): SqliteDatabase {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sengoku-jidai/server exec vitest run test/mapLibrary.test.ts`
Expected: FAIL — `library.update is not a function`.

- [ ] **Step 3: Implement update/delete/loadAll**

Add to the `MapLibrary` class in `packages/server/src/maps/library.ts`:

```ts
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
      value: { id, name: candidate.name, builtin: false, updatedAt: now, source: candidate }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/server exec vitest run test/mapLibrary.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/maps/library.ts packages/server/test/mapLibrary.test.ts
git commit -m "feat(server): MapLibrary update/delete guards + boot-time loadAll

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Maps API routes + app wiring

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/mapsApi.test.ts` (create)

**Interfaces:**
- Consumes: `MapLibrary` (Tasks 2–3); `hexMapSourceSchema`, `mapParamsSchema` from shared (Task 1); existing `sendError`, `buildApp`.
- Produces: `registerApiRoutes(app, repository, mapLibrary)` — the new third parameter (Task 5 relies on `mapLibrary` being in scope inside `POST /api/games`). Routes: `GET /api/maps`, `GET /api/maps/:mapId`, `POST /api/maps`, `PUT /api/maps/:mapId`, `DELETE /api/maps/:mapId`.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/mapsApi.test.ts`:

```ts
import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

function testConfig(): ServerConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:18081",
    sqlitePath: ":memory:",
    sessionSecret: "test-session-secret",
    logLevel: "silent"
  };
}

function fixturePayload() {
  return structuredClone(FIXTURE_HEX_MAP);
}

describe("maps API", () => {
  it("uploads, lists, fetches, updates, and deletes a map", async () => {
    const app = buildApp(testConfig());

    const created = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: fixturePayload()
    });
    expect(created.statusCode).toBe(201);
    const map = created.json();
    expect(map.builtin).toBe(false);
    expect(map.source.tiles).toHaveLength(5);

    const listed = await app.inject({ method: "GET", url: "/api/maps" });
    expect(listed.statusCode).toBe(200);
    const { maps } = listed.json();
    expect(maps[0]).toMatchObject({ id: "rivers", builtin: true });
    expect(maps.some((m: { id: string }) => m.id === map.id)).toBe(true);

    const fetched = await app.inject({ method: "GET", url: `/api/maps/${map.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().source.startingDeployment.A.troop).toBe(3);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/maps/${map.id}`,
      payload: { ...fixturePayload(), name: "Renamed" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Renamed");

    const deleted = await app.inject({ method: "DELETE", url: `/api/maps/${map.id}` });
    expect(deleted.statusCode).toBe(204);
    const gone = await app.inject({ method: "GET", url: `/api/maps/${map.id}` });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe("mapNotFound");

    await app.close();
  });

  it("serves the built-in rivers map and protects it from writes", async () => {
    const app = buildApp(testConfig());

    const rivers = await app.inject({ method: "GET", url: "/api/maps/rivers" });
    expect(rivers.statusCode).toBe(200);
    expect(rivers.json().builtin).toBe(true);

    const put = await app.inject({
      method: "PUT",
      url: "/api/maps/rivers",
      payload: fixturePayload()
    });
    expect(put.statusCode).toBe(403);
    expect(put.json().error.code).toBe("builtinMap");

    const del = await app.inject({ method: "DELETE", url: "/api/maps/rivers" });
    expect(del.statusCode).toBe(403);

    await app.close();
  });

  it("rejects malformed and invalid map uploads with 400", async () => {
    const app = buildApp(testConfig());

    const malformed = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: { name: "nope" }
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("invalidMap");

    const disconnected = fixturePayload();
    disconnected.tiles[0]!.hexes = [
      { q: 0, r: 0 },
      { q: 5, r: 5 }
    ];
    const invalid = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: disconnected
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toContain("not edge-connected");

    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sengoku-jidai/server exec vitest run test/mapsApi.test.ts`
Expected: FAIL — 404s (routes don't exist yet).

- [ ] **Step 3: Implement the routes and wiring**

In `packages/server/src/app.ts`, construct and load the library, and pass it to the routes:

```ts
import { MapLibrary } from "./maps/library.js";
```

```ts
  const repository = new GameRepository(db);
  const mapLibrary = new MapLibrary(db);
  mapLibrary.loadAll(app.log);
```

```ts
  registerApiRoutes(app, repository, mapLibrary);
```

In `packages/server/src/api/routes.ts`:

```ts
import {
  claimGameRequestSchema,
  createGameRequestSchema,
  eventQuerySchema,
  gameParamsSchema,
  hexMapSourceSchema,
  mapParamsSchema,
  submitCommandRequestSchema
} from "@sengoku-jidai/shared";
import type { MapLibrary, MapLibraryError } from "../maps/library.js";
```

```ts
const MAP_ERROR_STATUS: Record<MapLibraryError["code"], number> = {
  invalidMap: 400,
  builtinMap: 403,
  mapNotFound: 404,
  mapInUse: 409
};

export function registerApiRoutes(
  app: FastifyInstance,
  repository: GameRepository,
  mapLibrary: MapLibrary
): void {
```

Add the map routes (before the game routes, after `/healthz`):

```ts
  app.get("/api/maps", async () => ({ maps: mapLibrary.list() }));

  app.get("/api/maps/:mapId", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    const map = mapLibrary.get(params.data.mapId);
    if (!map) {
      return sendError(reply, 404, "mapNotFound", "Map was not found.");
    }
    return reply.send(map);
  });

  app.post("/api/maps", async (request, reply) => {
    const body = hexMapSourceSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalidMap", "Map source is malformed.");
    }
    const result = mapLibrary.create(body.data);
    if (!result.ok) {
      return sendError(
        reply,
        MAP_ERROR_STATUS[result.error.code],
        result.error.code,
        result.error.message
      );
    }
    return reply.status(201).send(result.value);
  });

  app.put("/api/maps/:mapId", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    const body = hexMapSourceSchema.safeParse(request.body ?? {});
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    if (!body.success) {
      return sendError(reply, 400, "invalidMap", "Map source is malformed.");
    }
    const result = mapLibrary.update(params.data.mapId, body.data);
    if (!result.ok) {
      return sendError(
        reply,
        MAP_ERROR_STATUS[result.error.code],
        result.error.code,
        result.error.message
      );
    }
    return reply.send(result.value);
  });

  app.delete("/api/maps/:mapId", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    const result = mapLibrary.delete(params.data.mapId);
    if (!result.ok) {
      return sendError(
        reply,
        MAP_ERROR_STATUS[result.error.code],
        result.error.code,
        result.error.message
      );
    }
    return reply.status(204).send();
  });
```

- [ ] **Step 4: Run the package tests (new + existing must pass)**

Run: `pnpm --filter @sengoku-jidai/server test`
Expected: PASS — including the pre-existing `server.test.ts` (`registerApiRoutes` gained a required param; only `buildApp` calls it, so nothing else changes).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/src/app.ts packages/server/test/mapsApi.test.ts
git commit -m "feat(server): /api/maps CRUD routes wired to the map library

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Create games on custom maps (end-to-end)

**Files:**
- Modify: `packages/server/src/persistence/repository.ts` (createGame opts)
- Modify: `packages/server/src/api/routes.ts` (`POST /api/games` mapId check)
- Test: `packages/server/test/mapsApi.test.ts` (append)

**Interfaces:**
- Consumes: Task 4's wired `mapLibrary`; engine `createInitialState({ ..., mapId })`.
- Produces: `repository.createGame(mode, seed, opts)` where `opts` gains `mapId?: string`. `POST /api/games` accepts `mapId` and 404s (`mapNotFound`) for unknown ids.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/test/mapsApi.test.ts`:

```ts
describe("games on custom maps", () => {
  it("uploads a map, creates a game on it, and plays a command", async () => {
    const app = buildApp(testConfig());

    const uploaded = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: fixturePayload()
    });
    expect(uploaded.statusCode).toBe(201);
    const mapId = uploaded.json().id as string;

    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", seed: "custom-map-seed", mapId }
    });
    expect(created.statusCode).toBe(200);
    const game = created.json();
    expect(game.view.mapId).toBe(mapId);

    const activeSeat = game.view.activeSeat as "red" | "black";
    const token = game.seats.find((s: { seat: string }) => s.seat === activeSeat).token;
    const command = await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/commands`,
      headers: { authorization: `Bearer ${token}` },
      payload: { baseRevision: 0, clientCommandId: "cmd-1", command: { type: "pass" } }
    });
    expect(command.statusCode).toBe(200);
    expect(command.json().revision).toBe(1);

    // The played map is now immutable.
    const put = await app.inject({
      method: "PUT",
      url: `/api/maps/${mapId}`,
      payload: fixturePayload()
    });
    expect(put.statusCode).toBe(409);
    expect(put.json().error.code).toBe("mapInUse");

    await app.close();
  });

  it("404s game creation on an unknown mapId without creating anything", async () => {
    const app = buildApp(testConfig());
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", mapId: "no-such-map" }
    });
    expect(created.statusCode).toBe(404);
    expect(created.json().error.code).toBe("mapNotFound");
    await app.close();
  });

  it("still creates rivers games when mapId is omitted (default path unchanged)", async () => {
    const app = buildApp(testConfig());
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", seed: "rivers-default" }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().view.mapId).toBe("rivers");
    await app.close();
  });
});
```

NOTE: `game.view.activeSeat` — confirm the field name against `packages/server/test/server.test.ts` (it uses `body.view.activeSeat`; keep identical). If the fixture map's first turn forbids `pass`, mirror whatever command `server.test.ts` uses (it uses `pass`, which is turn-legal on Rivers; the engine's pass legality is map-independent, so it should hold).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sengoku-jidai/server exec vitest run test/mapsApi.test.ts`
Expected: FAIL — `view.mapId` is `"rivers"` for the custom-map game (mapId ignored), and unknown mapId returns 500, not 404.

- [ ] **Step 3: Implement**

In `packages/server/src/persistence/repository.ts`, thread `mapId` through `createGame` (around line 88):

```ts
  createGame(
    mode: GameMode,
    seed?: string,
    opts: { creatorName?: string; creatorSide?: SeatId; mapId?: string } = {}
  ): CreatedGame {
    const gameId = randomUUID();
    const now = new Date().toISOString();
    const state = createInitialState({
      gameId,
      mode,
      seed: seed ?? randomUUID(),
      mapId: opts.mapId
    });
```

(The `games.map_id` column is already written from `state.mapId`; nothing else changes.)

In `packages/server/src/api/routes.ts`, inside the existing `POST /api/games` handler, after the body parse and before `repository.createGame`:

```ts
    if (parsed.data.mapId !== undefined && !mapLibrary.has(parsed.data.mapId)) {
      return sendError(reply, 404, "mapNotFound", "Map was not found.");
    }

    const game = repository.createGame(parsed.data.mode, parsed.data.seed, {
      creatorName: parsed.data.name,
      creatorSide: parsed.data.side,
      mapId: parsed.data.mapId
    });
```

- [ ] **Step 4: Run the full server test suite**

Run: `pnpm --filter @sengoku-jidai/server test`
Expected: PASS (all files: config, repository, server, mapLibrary, mapsApi)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/persistence/repository.ts packages/server/src/api/routes.ts packages/server/test/mapsApi.test.ts
git commit -m "feat(server): create games on library maps via POST /api/games mapId

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Gate + PR 1

**Files:** none (verification and delivery only)

- [ ] **Step 1: Full gate from the repo root**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm exec prettier --check .`
Expected: all green. If prettier flags touched files, run `pnpm exec prettier --write <files>` and re-run the gate.

- [ ] **Step 2: Push and open PR 1**

```bash
git push -u origin sp4-server-map-library
gh pr create --title "feat(server): map library — sqlite storage, /api/maps CRUD, dynamic registry (SP4 part 1)" --body "$(cat <<'EOF'
## Summary
- New `maps` sqlite table + `MapLibrary`: uploaded `HexMapSource` maps are validated (structural + compile + dry-run game setup), stored, and registered into the engine map registry at boot and on write
- New `/api/maps` CRUD routes; maps referenced by any game are immutable (409 `mapInUse`); built-ins protected (403)
- `POST /api/games` accepts an optional `mapId` — a custom map uploaded via curl is now fully playable through the existing game/command flow
- Spec: docs/superpowers/specs/2026-07-03-server-map-library-design.md (SP4 of the custom map editor initiative; part 2 = web rendering by mapId)

## Test plan
- [x] MapLibrary unit tests (validation pipeline, in-use/builtin guards, boot loadAll incl. corrupt-row skip)
- [x] Route tests for /api/maps + integration: upload → create game → play command → 409 on edit
- [x] Full gate + existing suites (Rivers default path unchanged)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch CI to green**

Run: `gh pr checks <pr-number> --watch`
Expected: all checks pass. Fix failures (common: prettier on touched files, Docker build context) and re-push.

- [ ] **Step 4: STOP — ask Martin to review/merge**

This is a server/API change: per workflow prefs, do not merge it yourself. When Martin merges (squash + delete branch), continue to Task 7.

---

### Task 7: Web map loader (fetch, register, cache) — PR 2 starts here

**PRECONDITION:** PR 1 is merged to main.

**Files:**
- Modify: `packages/engine/src/client.ts` (re-export `registerMap`)
- Modify: `packages/web/src/client/api.ts` (add `fetchMap`)
- Create: `packages/web/src/client/maps.ts`
- Test: `packages/web/test/client/maps.test.ts` (create)

**Interfaces:**
- Consumes: `GET /api/maps/:mapId` → `MapDetail` (Task 4); engine client exports `compileHexMap`, `getMap`, `riversMapId`, `riversSource`, type `HexMapSource`; board-render `assembleBoardSvg`, `buildScene`.
- Produces (used by Task 8):
  - `ensureMapLoaded(mapId: string): Promise<void>` — resolves immediately for cached/bundled maps; otherwise fetches the source, registers it in the client-side engine registry (so `getMap(view.mapId)` works everywhere in the app), and caches the assembled board SVG. Rejects on fetch/compile failure.
  - `boardSvgFor(mapId: string): string | null` — synchronous cache lookup.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only
git checkout -b sp4-web-custom-maps
```

- [ ] **Step 2: Export registerMap from the engine client surface**

In `packages/engine/src/client.ts` line 11, extend the registry export:

```ts
export { getMap, listMaps, registerMap } from "./maps/registry.js";
```

(Client-safe: map topology is public to both seats; `registerMap` exposes no authoritative state. This is the one engine-file change in SP4.)

- [ ] **Step 3: Write the failing tests**

Create `packages/web/test/client/maps.test.ts`:

```ts
import { getMap } from "@sengoku-jidai/engine/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardSvgFor, ensureMapLoaded } from "../../src/client/maps.js";

/** Minimal valid HexMapSource (client compile only; no server-side validation here). */
const CUSTOM_SOURCE = {
  id: "custom-1",
  name: "Custom One",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "A", kind: "land", hexes: [{ q: 0, r: 0 }], features: { hq: "red" } },
    { id: "B", kind: "land", hexes: [{ q: 1, r: 0 }], features: { hq: "black" } },
    { id: "C", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} }
  ],
  startingDeployment: { A: { seat: "red", troop: 3 }, B: { seat: "black", troop: 3 } },
  bonusSlots: []
};

function mockFetchOnce(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureMapLoaded", () => {
  it("resolves rivers without fetching (bundled)", async () => {
    const mock = mockFetchOnce(200, {});
    await ensureMapLoaded("rivers");
    expect(mock).not.toHaveBeenCalled();
    expect(boardSvgFor("rivers")).toContain("<svg");
  });

  it("fetches, registers, and caches a custom map once", async () => {
    const detail = {
      id: "custom-1",
      name: "Custom One",
      builtin: false,
      updatedAt: "2026-07-03T00:00:00.000Z",
      source: CUSTOM_SOURCE
    };
    const mock = mockFetchOnce(200, detail);

    await ensureMapLoaded("custom-1");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]![0]).toBe("/api/maps/custom-1");
    // Registered client-side: App's getMap(view.mapId) lookups now work.
    expect(getMap("custom-1").name).toBe("Custom One");
    expect(boardSvgFor("custom-1")).toContain("<svg");

    // Second call is a cache hit.
    await ensureMapLoaded("custom-1");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("rejects when the map fetch fails and caches nothing", async () => {
    mockFetchOnce(404, { error: { code: "mapNotFound", message: "nope", requestId: "r" } });
    await expect(ensureMapLoaded("missing-map")).rejects.toThrow();
    expect(boardSvgFor("missing-map")).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @sengoku-jidai/web exec vitest run test/client/maps.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/maps.js'`.

- [ ] **Step 5: Implement**

Add to `packages/web/src/client/api.ts`:

```ts
import type { MapDetail } from "@sengoku-jidai/shared";

export async function fetchMap(mapId: string): Promise<MapDetail> {
  return request(`/api/maps/${mapId}`);
}
```

(Merge the type import into the existing `@sengoku-jidai/shared` import.)

Create `packages/web/src/client/maps.ts`:

```ts
import type { HexMapSource } from "@sengoku-jidai/engine/client";
import {
  compileHexMap,
  registerMap,
  riversMapId,
  riversSource
} from "@sengoku-jidai/engine/client";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { fetchMap } from "./api.js";

function buildSvg(source: HexMapSource): string {
  return assembleBoardSvg(buildScene(compileHexMap(source)));
}

/** Assembled board SVG per map id. Rivers is bundled (same work MapBoard's old
 *  module-level constant did); custom maps are added by `ensureMapLoaded`. */
const svgCache = new Map<string, string>([[riversMapId, buildSvg(riversSource)]]);

const pending = new Map<string, Promise<void>>();

/**
 * Make a map usable by the app: registered in the client-side engine registry
 * (so `getMap(view.mapId)` works in App/labels) and its board SVG cached for
 * `boardSvgFor`. Instant for bundled/already-loaded maps; fetches each custom
 * map at most once, coalescing concurrent callers.
 */
export async function ensureMapLoaded(mapId: string): Promise<void> {
  if (svgCache.has(mapId)) {
    return;
  }
  let load = pending.get(mapId);
  if (!load) {
    load = fetchMap(mapId)
      .then((detail) => {
        const source = detail.source as HexMapSource;
        const compiled = compileHexMap(source);
        registerMap(compiled.definition);
        svgCache.set(mapId, assembleBoardSvg(buildScene(compiled)));
      })
      .finally(() => {
        pending.delete(mapId);
      });
    pending.set(mapId, load);
  }
  return load;
}

/** Synchronous cache lookup; null until `ensureMapLoaded(mapId)` has resolved. */
export function boardSvgFor(mapId: string): string | null {
  return svgCache.get(mapId) ?? null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/web exec vitest run test/client/maps.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/client.ts packages/web/src/client/api.ts packages/web/src/client/maps.ts packages/web/test/client/maps.test.ts
git commit -m "feat(web): map loader — fetch custom maps, register client-side, cache board SVG

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Render games on their own map

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx`
- Modify: `packages/web/src/components/board/slotMapping.ts`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/test/board/slotMapping.test.ts` (modify)

**Interfaces:**
- Consumes: `ensureMapLoaded`, `boardSvgFor` (Task 7); `game.view.mapId` (already on `PlayerGameView`).
- Produces: `MapBoardProps` gains required `mapId: string`; `slotIdForSpace` now maps any `<action>-<tileId>` space regardless of tile-id naming.

- [ ] **Step 1: Update the slotMapping test (failing first)**

In `packages/web/test/board/slotMapping.test.ts`, add cases (keep the existing ones):

```ts
it("maps action spaces on arbitrary (non-'tile') custom-map tile ids", () => {
  expect(slotIdForSpace("advance-island-a")).toBe("move-island-a");
  expect(slotIdForSpace("sail-deep-sea-3")).toBe("sail-deep-sea-3");
});

it("still returns null for support spaces and unprefixed ids", () => {
  expect(slotIdForSpace("reinforce-3")).toBeNull();
  expect(slotIdForSpace("plan")).toBeNull();
});
```

Run: `pnpm --filter @sengoku-jidai/web exec vitest run test/board/slotMapping.test.ts`
Expected: FAIL — `advance-island-a` returns null (the `startsWith("tile")` guard).

- [ ] **Step 2: Relax the guard**

In `packages/web/src/components/board/slotMapping.ts`, replace the function body:

```ts
export function slotIdForSpace(spaceId: string): string | null {
  const dash = spaceId.indexOf("-");
  if (dash === -1) {
    return null;
  }
  const prefix = SLOT_PREFIX[spaceId.slice(0, dash) as ActionType];
  const rest = spaceId.slice(dash + 1);
  if (!prefix || rest.length === 0) {
    return null;
  }
  return `${prefix}-${rest}`;
}
```

Update the function's doc comment: on-map action spaces are always `<action>-<tileId>`; the `SLOT_PREFIX` lookup is what excludes support spaces, so no tile-id naming is assumed (custom maps have arbitrary tile ids).

Run: `pnpm --filter @sengoku-jidai/web exec vitest run test/board/slotMapping.test.ts`
Expected: PASS

- [ ] **Step 3: MapBoard renders by mapId**

In `packages/web/src/components/board/MapBoard.tsx`:

1. Remove line 8 (`const RIVERS_SVG = ...`) and drop `riversSource` (and `compileHexMap` if now unused) from the imports; remove the `assembleBoardSvg, buildScene` import if now unused.
2. Add the import: `import { boardSvgFor } from "../../client/maps.js";`
3. Add to `MapBoardProps` (first prop):

```ts
  /** The game's map id (`view.mapId`); the SVG comes from the map loader cache,
   *  which App warms via `ensureMapLoaded` before rendering the game. */
  mapId: string;
```

4. In the component, destructure `mapId` and change the mount effect (currently `host.innerHTML = RIVERS_SVG;` around line 583):

```ts
    const svg = boardSvgFor(mapId);
    host.innerHTML =
      svg ?? `<p role="alert">The map for this game failed to load. Refresh to retry.</p>`;
```

and add `mapId` to that effect's dependency array (currently `[]` — verify and keep the other decorate-effects' dependencies unchanged; they re-query the DOM under the host ref, so a map swap re-runs them via their existing deps on `areas` etc. If any decorate effect has an empty dep array tied to the mount, give it the same `[mapId]` dependency).

- [ ] **Step 4: App warms the loader before showing a game**

In `packages/web/src/App.tsx`:

1. Add the import: `import { ensureMapLoaded } from "./client/maps.js";`
2. Initial route load (the `fetchGameView` chain around line 147) — make the `.then` async and warm the cache before `setGame`:

```ts
      .then(async (envelope) => {
        if (cancelled) {
          return;
        }
        await ensureMapLoaded(envelope.view.mapId);
        if (cancelled) {
          return;
        }
        rememberSeatTokens(gameId, [{ seat: envelope.seat, token }]);
```

(the existing `.catch` already routes failures into `setError`).
3. Apply the same one-line `await ensureMapLoaded(<envelope|created>.view.mapId);` immediately before each remaining `setGame` that introduces a NEW game/view source: the `createGame` handler (~line 304), the `claimSeat` handler (~line 335), and the seat-switch/refresh `fetchGameView` (~line 360). All three sit in async handlers with try/catch — verify each and place the await inside the try. Poll and command-response `setGame` calls (lines 216, 580+) keep the same game/mapId — do NOT touch them.
4. Pass the prop at the `<MapBoard` usage (~line 787): `mapId={game.view.mapId}`.

- [ ] **Step 5: Full web test suite + typecheck**

Run: `pnpm --filter @sengoku-jidai/web test && pnpm typecheck`
Expected: PASS. If any existing test renders `<MapBoard>` without the new required prop, add `mapId="rivers"` to its props.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/web/src/components/board/slotMapping.ts packages/web/src/App.tsx packages/web/test/board/slotMapping.test.ts
git commit -m "feat(web): render each game's own map by id (custom maps playable in browser)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Gate + PR 2

**Files:** none (verification and delivery only)

- [ ] **Step 1: Full gate from the repo root**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm exec prettier --check .`
Expected: all green. The ESLint client-import rule must not flag `maps.ts` (it imports via `@sengoku-jidai/engine/client` only).

- [ ] **Step 2: Push and open PR 2**

```bash
git push -u origin sp4-web-custom-maps
gh pr create --title "feat(web): render games on their own map by id (SP4 part 2)" --body "$(cat <<'EOF'
## Summary
- New web map loader: fetches a game's `HexMapSource` from `/api/maps/:id`, registers it in the client-side engine registry, and caches the assembled board SVG (Rivers stays bundled — default path unchanged)
- `MapBoard` takes `mapId` and renders from the loader cache instead of a hardcoded Rivers constant; App warms the loader before showing a game
- `slotIdForSpace` no longer assumes tile ids start with "tile", so order-slot occupancy dots work on custom maps
- `@sengoku-jidai/engine/client` re-exports `registerMap` (client-safe: map topology is public)
- Completes SP4 end-to-end: a map uploaded via curl (PR #<part1>) is now fully playable in the browser. Custom maps render with flat authored fills until SP6 adds terrain.

## Test plan
- [x] Loader unit tests (bundled fast path, fetch+register+cache once, failure state)
- [x] slotMapping tests for arbitrary tile ids
- [x] Full gate; existing e2e/browser smoke unchanged (Rivers path identical)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Replace `#<part1>` with PR 1's number.)

- [ ] **Step 3: Watch CI to green**

Run: `gh pr checks <pr-number> --watch`
Expected: all checks pass, including Browser Smoke (Rivers rendering behavior is unchanged). Common failure: an e2e spec touching MapBoard props — fix forward.

- [ ] **Step 4: STOP — ask Martin to review/merge**

When merged: SP4 is complete. Update the memory file's resume pointer (SP4 done → SP5 editor UI next) and note that manual browser verification of a custom map (curl upload → create game → play) is still pending on the deployed instance.
