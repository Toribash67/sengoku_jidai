# PR-A Backend Many-Terrains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-terrain-per-map backend with a one-to-many `map_terrains` model (named, styled, capped terrains, each independently generated/renamed/deleted/served), additively and backward-compatibly so the live app keeps working with zero web changes.

**Architecture:** A new `map_terrains` table (migration 004 carries the existing single terrains over as "Terrain 1"). `TerrainStore` gets a surrogate-id API (`create/list/rename/remove/markReadyById/…`) plus thin "primary terrain = oldest row" adapters that keep the legacy `MapDetail.terrain` field, `GET /terrain.webp`, and `POST /terrain` working. `TerrainService` grows `generate(mapId, styleId)→id` (new terrain) and `regeneratePrimary(mapId)` (legacy), sharing one worker that picks the profile via PR-2's `loadStyleProfile`. New REST endpoints (`POST/PATCH/DELETE /terrains`, `GET /terrains/:tid.webp`) are added alongside the retained legacy routes. PR-B/PR-C later switch the web and remove the legacy surfaces.

**Tech Stack:** TypeScript, better-sqlite3 (raw-SQL migrations), Fastify, zod, vitest.

## Global Constraints

- `corepack pnpm` only. **Rebuild `@sengoku-jidai/shared` dist before server filtered tests** (dist-consumption trap) — this PR adds shared exports `TerrainInfo`, `MAX_TERRAINS_PER_MAP`.
- Additive + backward-compatible: **no web changes, no engine/session/realtime/terrain-package changes.** Keep `MapDetail.terrain`, `GET /api/maps/:id/terrain.webp`, `POST /api/maps/:id/terrain` working.
- Generation stays **one-at-a-time per map** (in-flight guard keyed by map id).
- Cap **6** terrains/map (`MAX_TERRAINS_PER_MAP`). Style ids validated via `isTerrainStyleId` (PR-2), default `"antique"`.
- Migration is forward-only (drops `map_terrain`), like 001–003. It must carry existing terrain **blobs**.
- Full gate before push (`pnpm typecheck`, `test`, `build`, `lint`, `prettier --check .`); own branch off fresh `main` (branch `feat/terrain-pra-backend` already exists with the committed spec) → one PR → watch CI → **ask before merging** (schema + API change) → squash + delete branch. Commit trailer + PR body line per [[dev-workflow-prefs]].

---

### Task 1: Shared types — `TerrainInfo`, `MapDetail.terrains`, `MAX_TERRAINS_PER_MAP`

**Files:**
- Modify: `packages/shared/src/api.ts` (near `TerrainStatus` / `MapDetail`)
- Test: `packages/shared/test/terrainStyles.test.ts` (extend — same file, terrain-adjacent constants)

**Interfaces:**
- Consumes: `TerrainStatus`, `TerrainStyleId` (PR-2), both already in `api.ts`.
- Produces:
  - `interface TerrainInfo { id: string; name: string; styleId: TerrainStyleId; status: Exclude<TerrainStatus,"none">; updatedAt: string }`
  - `MapDetail.terrains: TerrainInfo[]` (new; `terrain: TerrainStatus` kept)
  - `const MAX_TERRAINS_PER_MAP = 6`

- [ ] **Step 1: Write the failing test** (append to `packages/shared/test/terrainStyles.test.ts`)

```ts
import { MAX_TERRAINS_PER_MAP } from "../src/api.js";

describe("terrain limits", () => {
  it("caps terrains per map at a positive number", () => {
    expect(MAX_TERRAINS_PER_MAP).toBe(6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/shared exec vitest run test/terrainStyles.test.ts`
Expected: FAIL — `MAX_TERRAINS_PER_MAP` not exported.

- [ ] **Step 3: Add the types + constant to `packages/shared/src/api.ts`**

Add `MAX_TERRAINS_PER_MAP` and `TerrainInfo` near the terrain types, and add `terrains` to `MapDetail`:

```ts
/** Max terrains a single map may hold (bounds fal cost + DB blob storage). Shared so the editor
 *  can disable "generate" at the cap using the same number the server enforces. */
export const MAX_TERRAINS_PER_MAP = 6;

/** One generated terrain belonging to a map. */
export interface TerrainInfo {
  id: string;
  name: string;
  styleId: TerrainStyleId;
  status: Exclude<TerrainStatus, "none">; // a stored terrain is always pending | ready | failed
  updatedAt: string;
}
```

In `interface MapDetail`, add the `terrains` field (keep `terrain`):

```ts
  /** LEGACY: the primary (oldest) terrain's status, "none" if the map has no terrains. Kept for
   *  the current web app; removed in PR-C once the play view uses `terrains`. */
  terrain: TerrainStatus;
  /** All terrains for this map, oldest first. Empty for built-ins. */
  terrains: TerrainInfo[];
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/shared exec vitest run test/terrainStyles.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild shared dist (server tasks consume it)**

Run: `corepack pnpm --filter @sengoku-jidai/shared build`
Expected: Done.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/test/terrainStyles.test.ts
git commit -m "feat(shared): TerrainInfo + MapDetail.terrains + MAX_TERRAINS_PER_MAP"
```

---

### Task 2: Storage layer swap — migration 004 + `TerrainStore` rewrite

> Atomic unit: migration 004 drops `map_terrain`, so the store must move to `map_terrains` in the same commit or the suite goes red. Delivers a fully green store test suite on the new table (surrogate-id API + legacy primary adapters).

**Files:**
- Create: `packages/server/migrations/004_map_terrains.sql`
- Modify: `packages/server/src/persistence/database.ts` (append `"004_map_terrains.sql"` to the migrations array)
- Rewrite: `packages/server/src/maps/terrainStore.ts`
- Test: `packages/server/test/terrainStore.test.ts` (rewrite to the new API), `packages/server/test/terrainMigration.test.ts` (create — carry-over)

**Interfaces:**
- Consumes: `SqliteDatabase`, `TerrainStatus`, `TerrainInfo` (Task 1), `randomUUID`.
- Produces (new `TerrainStore`):
  - `create(mapId: string, name: string, styleId: string): string`
  - `list(mapId: string): TerrainInfo[]` (oldest first)
  - `get(terrainId: string): TerrainInfo | null`
  - `countForMap(mapId: string): number`
  - `styleIdOf(terrainId: string): string | null`
  - `rename(terrainId: string, name: string): boolean`
  - `remove(terrainId: string): boolean`
  - `markPendingById(terrainId: string): void`
  - `markReadyById(terrainId: string, webp: Buffer): void`
  - `markFailedById(terrainId: string, error: string): void`
  - `webpById(terrainId: string): Buffer | null`
  - `updatedAtById(terrainId: string): string | null`
  - `resetInterrupted(): void`
  - Legacy adapters (primary = oldest): `primaryId(mapId): string | null`, `status(mapId): TerrainStatus`, `updatedAt(mapId): string | null`, `webp(mapId): Buffer | null`

- [ ] **Step 1: Create the migration** `packages/server/migrations/004_map_terrains.sql`

```sql
CREATE TABLE map_terrains (
  id         TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  style_id   TEXT NOT NULL DEFAULT 'antique',
  status     TEXT NOT NULL,
  webp       BLOB,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX map_terrains_map_id ON map_terrains(map_id);

INSERT INTO map_terrains (id, map_id, name, style_id, status, webp, error, created_at, updated_at)
SELECT lower(hex(randomblob(16))), map_id, 'Terrain 1', 'antique', status, webp, error,
       updated_at, updated_at
FROM map_terrain;

DROP TABLE map_terrain;
```

- [ ] **Step 2: Register the migration** — in `packages/server/src/persistence/database.ts`, extend the array:

```ts
  const migrations = [
    "001_initial.sql",
    "002_maps.sql",
    "003_map_terrain.sql",
    "004_map_terrains.sql"
  ];
```

- [ ] **Step 3: Write the carry-over migration test** `packages/server/test/terrainMigration.test.ts`

```ts
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
    db.prepare("INSERT INTO map_terrain (map_id, status, webp, error, updated_at) VALUES (?,?,?,?,?)")
      .run("m1", "ready", blob, null, "2026-01-01T00:00:00.000Z");

    const sql = readFileSync(
      fileURLToPath(new URL("../migrations/004_map_terrains.sql", import.meta.url)),
      "utf8"
    );
    db.exec(sql);

    const rows = db.prepare("SELECT * FROM map_terrains").all() as Array<{
      map_id: string; name: string; style_id: string; status: string; webp: Buffer;
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
```

- [ ] **Step 4: Rewrite `packages/server/test/terrainStore.test.ts`** to the new API

```ts
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { TerrainStore } from "../src/maps/terrainStore.js";

function db() {
  const d = openDatabase(":memory:");
  runMigrations(d);
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
```

- [ ] **Step 5: Run both — verify they fail** (old store still queries `map_terrain`)

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainMigration.test.ts test/terrainStore.test.ts`
Expected: FAIL (missing methods / `no such table: map_terrain`).

- [ ] **Step 6: Rewrite `packages/server/src/maps/terrainStore.ts`**

```ts
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

/** Owns `map_terrains`: many named, styled terrains per map. Terrains are addressed by a
 *  surrogate id; the legacy per-map adapters (status/webp/updatedAt/primaryId) resolve the
 *  map's "primary" terrain — the oldest row — for the retained single-terrain routes/field. */
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
        .prepare(
          "SELECT * FROM map_terrains WHERE map_id = ? ORDER BY created_at ASC, id ASC"
        )
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

  // --- Legacy per-map adapters (primary = oldest row) ---

  primaryId(mapId: string): string | null {
    const r = this.db
      .prepare("SELECT id FROM map_terrains WHERE map_id = ? ORDER BY created_at ASC, id ASC LIMIT 1")
      .get(mapId) as { id: string } | undefined;
    return r?.id ?? null;
  }

  status(mapId: string): TerrainStatus {
    const id = this.primaryId(mapId);
    return id ? (this.get(id)!.status as TerrainStatus) : "none";
  }

  updatedAt(mapId: string): string | null {
    const id = this.primaryId(mapId);
    return id ? this.updatedAtById(id) : null;
  }

  webp(mapId: string): Buffer | null {
    const id = this.primaryId(mapId);
    return id ? this.webpById(id) : null;
  }
}
```

- [ ] **Step 7: Run — verify both pass**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainMigration.test.ts test/terrainStore.test.ts`
Expected: PASS (migration 1 + store 6).

- [ ] **Step 8: Commit**

```bash
git add packages/server/migrations/004_map_terrains.sql \
        packages/server/src/persistence/database.ts \
        packages/server/src/maps/terrainStore.ts \
        packages/server/test/terrainStore.test.ts \
        packages/server/test/terrainMigration.test.ts
git commit -m "feat(server): map_terrains table + surrogate-id TerrainStore (migration 004)"
```

---

### Task 3: `autoName` pure helper

**Files:**
- Modify: `packages/server/src/maps/terrainService.ts` (add + export `autoName`)
- Test: `packages/server/test/terrainAutoName.test.ts` (create)

**Interfaces:**
- Consumes: `TerrainInfo` (for the `name` field).
- Produces: `export function autoName(existing: Pick<TerrainInfo, "name">[]): string`

- [ ] **Step 1: Write the failing test** `packages/server/test/terrainAutoName.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { autoName } from "../src/maps/terrainService.js";

describe("autoName", () => {
  it("starts at Terrain 1", () => {
    expect(autoName([])).toBe("Terrain 1");
  });
  it("uses max existing number + 1", () => {
    expect(autoName([{ name: "Terrain 1" }, { name: "Terrain 2" }])).toBe("Terrain 3");
  });
  it("fills past gaps by max, not count", () => {
    expect(autoName([{ name: "Terrain 1" }, { name: "Terrain 3" }])).toBe("Terrain 4");
  });
  it("ignores names that are not 'Terrain <n>'", () => {
    expect(autoName([{ name: "Coast" }, { name: "Terrain 2" }])).toBe("Terrain 3");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainAutoName.test.ts`
Expected: FAIL — `autoName` not exported.

- [ ] **Step 3: Add `autoName` to `packages/server/src/maps/terrainService.ts`** (top of file, after imports)

```ts
/** Next auto name: "Terrain N" where N is one past the highest existing "Terrain <n>" (names are
 *  renameable and not unique, so we key off the number, not the count). */
export function autoName(existing: Pick<TerrainInfo, "name">[]): string {
  const max = existing.reduce((m, t) => {
    const match = /^Terrain (\d+)$/.exec(t.name);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `Terrain ${max + 1}`;
}
```

(Add `import type { TerrainInfo } from "@sengoku-jidai/shared";` if not already imported.)

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainAutoName.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/maps/terrainService.ts packages/server/test/terrainAutoName.test.ts
git commit -m "feat(server): autoName helper for terrains"
```

---

### Task 4: `TerrainService` rework — `generate(mapId, styleId)` + `regeneratePrimary`

**Files:**
- Modify: `packages/server/src/maps/terrainService.ts`
- Test: `packages/server/test/terrainService.test.ts` (update to new API)

**Interfaces:**
- Consumes: `TerrainStore` (Task 2), `autoName` (Task 3), `loadStyleProfile` + `generateTerrainWebp` (`@sengoku-jidai/terrain`, PR-2), `DEFAULT_TERRAIN_STYLE`.
- Produces:
  - `generate(mapId: string, styleId: string): string` — create a new terrain row (named via `autoName`), generate it, return its id.
  - `regeneratePrimary(mapId: string): void` — regenerate the primary terrain in place, or create "Terrain 1" (antique) if none. (Legacy adapter for `POST /terrain`.)
  - `isGenerating(mapId)` and `available()` unchanged.

- [ ] **Step 1: Update `packages/server/test/terrainService.test.ts`** to the new API

Replace the body of the existing generate/failure tests. The `setup()` helper stays. New cases:

```ts
  it("generate() creates a ready terrain and returns its id", async () => {
    const { library, store, mapId } = setup();
    const svc = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = svc.generate(mapId, "antique");
    await vi.waitFor(() => expect(store.get(id)?.status).toBe("ready"));
    expect(store.webpById(id)).not.toBeNull();
    expect(store.list(mapId).map((t) => t.name)).toEqual(["Terrain 1"]);
  });

  it("generate() uses the requested style profile", async () => {
    const { library, store, mapId } = setup();
    const svc = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = svc.generate(mapId, "ink");
    await vi.waitFor(() => expect(store.get(id)?.status).toBe("ready"));
    expect(store.styleIdOf(id)).toBe("ink");
  });

  it("is one-at-a-time per map (guard)", async () => {
    const { library, store, mapId } = setup();
    const svc = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    svc.generate(mapId, "antique");
    expect(svc.isGenerating(mapId)).toBe(true);
    await vi.waitFor(() => expect(svc.isGenerating(mapId)).toBe(false));
  });

  it("regeneratePrimary() creates Terrain 1 when none, then regenerates it in place", async () => {
    const { library, store, mapId } = setup();
    const svc = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    svc.regeneratePrimary(mapId);
    await vi.waitFor(() => expect(store.status(mapId)).toBe("ready"));
    const firstId = store.primaryId(mapId);
    svc.regeneratePrimary(mapId);
    await vi.waitFor(() => expect(store.status(mapId)).toBe("ready"));
    expect(store.primaryId(mapId)).toBe(firstId); // same row, regenerated
    expect(store.list(mapId)).toHaveLength(1);
  });

  it("records failure on the right terrain when the model errors", async () => {
    const { library, store, mapId } = setup();
    const deps = fakeDeps();
    deps.fal.subscribe = vi.fn(async () => {
      throw new Error("model down");
    });
    const svc = new TerrainService({ library, store, falKey: "k", deps });
    const id = svc.generate(mapId, "antique");
    await vi.waitFor(() => expect(store.get(id)?.status).toBe("failed"));
  });
```

(Keep the existing `available()` test. Remove the old "sends no seed/resolution" test only if it asserted the old single-terrain `store.status(mapId)` path — re-point it at `store.get(id)` if it checks generation output.)

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainService.test.ts`
Expected: FAIL — `generate` signature changed / `regeneratePrimary` missing.

- [ ] **Step 3: Rewrite the generation methods in `packages/server/src/maps/terrainService.ts`**

Update imports and replace the `generate` method with the new pair + shared worker:

```ts
import { compileHexMap } from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { DEFAULT_TERRAIN_STYLE } from "@sengoku-jidai/shared";
import type { TerrainInfo } from "@sengoku-jidai/shared";
import {
  createFalClient,
  generateTerrainWebp,
  loadStyleProfile,
  type EditDeps
} from "@sengoku-jidai/terrain";
```

(The `profile`/`MapProfile` field and `defaultProfile()` are removed — the service now resolves a profile per generation via `loadStyleProfile(styleId)`. Drop `profile` from `TerrainServiceArgs` and the constructor.)

```ts
  /** Create a new terrain for the map and generate it. Returns the new terrain id. The route
   *  enforces availability, existence, built-in, in-flight, and cap guards first. */
  generate(mapId: string, styleId: string): string {
    const id = this.store.create(mapId, autoName(this.store.list(mapId)), styleId);
    void this.run(mapId, id, styleId);
    return id;
  }

  /** Legacy adapter for POST /terrain: regenerate the map's primary terrain in place, or create
   *  "Terrain 1" (antique) if the map has none. Preserves the current single-terrain UX. */
  regeneratePrimary(mapId: string): void {
    const primary = this.store.primaryId(mapId);
    if (primary) {
      const styleId = this.store.styleIdOf(primary) ?? DEFAULT_TERRAIN_STYLE;
      void this.run(mapId, primary, styleId);
      return;
    }
    void this.run(mapId, this.store.create(mapId, "Terrain 1", DEFAULT_TERRAIN_STYLE), DEFAULT_TERRAIN_STYLE);
  }

  /** Shared worker: compile → board SVG → terrain webp (style profile) → store by id. In-flight
   *  guard is keyed by map id so a map generates one terrain at a time. Re-flags the row pending
   *  first so a regenerated primary shows progress (a fresh row is already pending — harmless). */
  private async run(mapId: string, terrainId: string, styleId: string): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return;
    }
    this.inflight.add(mapId);
    this.store.markPendingById(terrainId);
    try {
      const compiled = compileHexMap(detail.source as HexMapSource);
      const svgMarkup = assembleBoardSvg(buildScene(compiled));
      const deps = await this.resolveDeps();
      const webp = await generateTerrainWebp(deps, {
        svgMarkup,
        map: compiled.definition,
        profile: loadStyleProfile(styleId)
      });
      this.store.markReadyById(terrainId, webp);
    } catch (err) {
      this.store.markFailedById(terrainId, err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight.delete(mapId);
    }
  }
```

(`markPendingById` is defined in Task 2's `TerrainStore` code above.)

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/maps/terrainService.ts packages/server/src/maps/terrainStore.ts \
        packages/server/test/terrainService.test.ts packages/server/test/terrainStore.test.ts
git commit -m "feat(server): TerrainService generate(styleId) + regeneratePrimary on many-terrains"
```

---

### Task 5: Routes + `library.get` `terrains` — new endpoints, legacy rewired

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Modify: `packages/server/src/maps/library.ts` (add `terrainsFn` param to `get`)
- Test: `packages/server/test/terrainApi.test.ts` (extend), `packages/server/test/mapLibrary.test.ts` (if it asserts `MapDetail` shape, add `terrains: []`)

**Interfaces:**
- Consumes: `TerrainStore`, `TerrainService` (Tasks 2/4), `MAX_TERRAINS_PER_MAP` + `isTerrainStyleId` (shared), `TerrainInfo`.
- Produces the REST surface in the spec (new `POST/PATCH/DELETE /terrains`, `GET /terrains/:tid.webp`; legacy `POST /terrain` + `GET /terrain.webp` retained). `library.get(id, terrainStatus?, terrainsFn?)` populates `MapDetail.terrain` (primary) + `MapDetail.terrains`.

- [ ] **Step 1: Extend `library.get`** in `packages/server/src/maps/library.ts`

Signature → `get(id: string, terrainStatus?: (id: string) => TerrainStatus, terrainsFn?: (id: string) => TerrainInfo[]): MapDetail | null`. Add `import type { TerrainInfo } from "@sengoku-jidai/shared";`. In each of the three `MapDetail` return objects add `terrains`:
- built-in return: `terrains: []`
- stored-row return (in `get`): `terrains: terrainsFn ? terrainsFn(row.id) : []`
- `create`/`update` returns (fresh map, no terrains yet): `terrains: []`

- [ ] **Step 2: Write failing route tests** (append to `packages/server/test/terrainApi.test.ts`)

```ts
  it("POST /terrains creates a terrain and returns its id", async () => {
    const { app, mapId } = buildTestApp();
    const res = await app.inject({ method: "POST", url: `/api/maps/${mapId}/terrains`,
      payload: { styleId: "ink" } });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).id).toEqual(expect.any(String));
  });

  it("POST /terrains rejects an invalid style with 400", async () => {
    const { app, mapId } = buildTestApp();
    const res = await app.inject({ method: "POST", url: `/api/maps/${mapId}/terrains`,
      payload: { styleId: "watercolour" } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /terrains 422s at the cap", async () => {
    const { app, store, mapId } = buildTestApp();
    for (let i = 0; i < 6; i++) store.create(mapId, `Terrain ${i + 1}`, "antique");
    const res = await app.inject({ method: "POST", url: `/api/maps/${mapId}/terrains`, payload: {} });
    expect(res.statusCode).toBe(422);
  });

  it("PATCH renames and DELETE removes a terrain", async () => {
    const { app, store, mapId } = buildTestApp();
    const id = store.create(mapId, "Terrain 1", "antique");
    const patch = await app.inject({ method: "PATCH", url: `/api/maps/${mapId}/terrains/${id}`,
      payload: { name: "Coast" } });
    expect(patch.statusCode).toBe(200);
    expect(store.get(id)?.name).toBe("Coast");
    const del = await app.inject({ method: "DELETE", url: `/api/maps/${mapId}/terrains/${id}` });
    expect(del.statusCode).toBe(204);
    expect(store.get(id)).toBeNull();
  });

  it("GET /terrains/:tid.webp serves a ready terrain and 404s otherwise", async () => {
    const { app, store, mapId } = buildTestApp();
    const id = store.create(mapId, "Terrain 1", "antique");
    expect((await app.inject({ url: `/api/maps/${mapId}/terrains/${id}.webp` })).statusCode).toBe(404);
    store.markReadyById(id, Buffer.from([1, 2, 3]));
    const ok = await app.inject({ url: `/api/maps/${mapId}/terrains/${id}.webp` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/webp");
  });

  it("MapDetail exposes terrains[] and the legacy terrain field", async () => {
    const { app, store, mapId } = buildTestApp();
    const id = store.create(mapId, "Terrain 1", "antique");
    store.markReadyById(id, Buffer.from([1]));
    const res = await app.inject({ url: `/api/maps/${mapId}` });
    const body = JSON.parse(res.body);
    expect(body.terrain).toBe("ready"); // legacy primary status
    expect(body.terrains).toHaveLength(1);
    expect(body.terrains[0]).toMatchObject({ id, name: "Terrain 1", styleId: "antique", status: "ready" });
  });
```

Keep the existing legacy tests (`POST /terrain`, `GET /terrain.webp`, 503/409/403) unchanged — they must still pass. Ensure `buildTestApp` returns `store` (it already constructs one; add it to the returned object if not present).

- [ ] **Step 3: Run to verify new tests fail**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainApi.test.ts`
Expected: FAIL — new routes 404, `terrains` undefined.

- [ ] **Step 4: Add the new routes + rewire in `packages/server/src/api/routes.ts`**

Add imports: `import { MAX_TERRAINS_PER_MAP, isTerrainStyleId } from "@sengoku-jidai/shared";` and a zod schema for the terrain-id param + bodies. Where `mapLibrary.get(..., (id) => terrainStore.status(id))` is called (the `GET /api/maps/:mapId` detail route), add the third arg `(id) => terrainStore.list(id)`.

Change the legacy `POST /api/maps/:mapId/terrain` handler's fire line from `terrainService.generate(...)` to `terrainService.regeneratePrimary(params.data.mapId)` (keep every guard + the `202 { status: "pending" }` response as-is).

Add the new handlers (after the legacy terrain routes):

```ts
  const terrainParamsSchema = z.object({
    mapId: z.string().min(1),
    terrainId: z.string().min(1)
  });

  app.post("/api/maps/:mapId/terrains", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    const body = z.object({ styleId: z.string().optional() }).safeParse(request.body ?? {});
    if (!body.success) return sendError(reply, 400, "invalidRequest", "Body is invalid.");
    const styleId = body.data.styleId ?? "antique";
    if (!isTerrainStyleId(styleId))
      return sendError(reply, 400, "invalidStyle", "Unknown terrain style.");
    if (!terrainService.available())
      return sendError(reply, 503, "terrainUnavailable", "Terrain generation is not configured.");
    const detail = mapLibrary.get(params.data.mapId);
    if (!detail) return sendError(reply, 404, "mapNotFound", "Map was not found.");
    if (detail.builtin) return sendError(reply, 403, "builtinMap", "Built-in maps cannot generate terrain.");
    if (terrainService.isGenerating(params.data.mapId))
      return sendError(reply, 409, "terrainInProgress", "Terrain is already generating.");
    if (terrainStore.countForMap(params.data.mapId) >= MAX_TERRAINS_PER_MAP)
      return sendError(reply, 422, "terrainCap", `A map may have at most ${MAX_TERRAINS_PER_MAP} terrains.`);
    const id = terrainService.generate(params.data.mapId, styleId);
    return reply.status(202).send({ id });
  });

  app.patch("/api/maps/:mapId/terrains/:terrainId", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    const body = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(request.body ?? {});
    if (!body.success) return sendError(reply, 400, "invalidRequest", "Name must be 1–40 characters.");
    if (!terrainStore.rename(params.data.terrainId, body.data.name))
      return sendError(reply, 404, "terrainNotFound", "Terrain was not found.");
    return reply.status(200).send({ ok: true });
  });

  app.delete("/api/maps/:mapId/terrains/:terrainId", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    if (!terrainStore.remove(params.data.terrainId))
      return sendError(reply, 404, "terrainNotFound", "Terrain was not found.");
    return reply.status(204).send();
  });

  app.get("/api/maps/:mapId/terrains/:terrainId.webp", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    const webp = terrainStore.webpById(params.data.terrainId);
    if (!webp) return sendError(reply, 404, "terrainNotFound", "No terrain for this id.");
    const updatedAt = terrainStore.updatedAtById(params.data.terrainId) ?? "";
    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=60")
      .header("ETag", `"${params.data.terrainId}-${updatedAt}"`)
      .send(webp);
  });
```

Note the `.webp` suffix on the route path: Fastify treats `:terrainId.webp` as param `terrainId` up to the literal `.webp`. If the router does not match the literal suffix, register the route as `/api/maps/:mapId/terrains/:terrainId` under a content check — but the existing `GET /api/maps/:mapId/terrain.webp` uses the same suffix style and works, so mirror it.

- [ ] **Step 5: Run the terrain API + library tests**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainApi.test.ts test/mapLibrary.test.ts`
Expected: PASS (new + legacy).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/src/maps/library.ts \
        packages/server/test/terrainApi.test.ts packages/server/test/mapLibrary.test.ts
git commit -m "feat(server): many-terrains REST endpoints + MapDetail.terrains (legacy retained)"
```

---

### Task 6: Full gate, PR, watch CI, hold for merge

- [ ] **Step 1: Rebuild libs + full gate**

```bash
corepack pnpm build && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm exec prettier --check .
```
Expected: all green. Fix prettier on touched files (`prettier --write <path>`), re-run. Watch for: the app-wiring in `packages/server/src/app.ts` — if it passed a `profile` to `new TerrainService(...)`, remove it (the service no longer takes one); confirm `terrainStore.resetInterrupted()` is still called at boot (name unchanged).

- [ ] **Step 2: Push + open PR** (title `PR-A: backend many-terrains per map`; body: data model, new + legacy API, backward-compat rationale, links the spec; ends with the Claude Code line). `git push -u origin feat/terrain-pra-backend`.

- [ ] **Step 3: Watch CI** — `gh pr checks <n> --watch`; fix failures (prettier, determinism anchor in `game.test.ts`, Docker context — the migration file is copied via `COPY packages`, confirm the migrations dir ships).

- [ ] **Step 4: Report green + hold for Martin's merge** (squash + delete branch). Then update [[multiple-terrains-initiative]]: PR-A done; next is PR-B (editor Terrains panel), which removes the legacy `POST /terrain` use.

---

## Notes for the executor

- **Backward-compat is the whole point of PR-A's shape.** Do not remove `MapDetail.terrain`, `GET /terrain.webp`, or `POST /terrain`; do not touch the web package. Those retire in PR-B/PR-C.
- The primary-terrain adapters exist only to keep the untouched web working. Don't build features on them.
- `app.ts` constructs `TerrainStore` + `TerrainService`; the service no longer accepts a `profile` arg — remove it there if present. Boot calls `terrainStore.resetInterrupted()` — keep it.
- Keep generation one-at-a-time per map (guard keyed by map id) — a map-level lock, not a terrain-level one.
