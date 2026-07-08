# SP6 Terrain — Backend Implementation Plan (PR 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server generate per-map terrain on demand from a stored `HexMapSource`, store it as a sqlite blob, and serve it — with no UI yet (the web PR lights it up).

**Architecture:** Refactor the terrain pipeline to a filesystem-free core `generateTerrainWebp(deps, {svgMarkup, map, profile})`. The server assembles `svgMarkup` via board-render and `map` via engine, runs the core with a fal client built from `FAL_KEY`, and persists the webp + status in a new `map_terrain` table. New endpoints trigger generation, report status via `MapDetail.terrain`, and stream the blob.

**Tech Stack:** TypeScript, fastify, better-sqlite3, sharp, `@fal-ai/client` (injected), vitest. No new third-party dependencies — only new **workspace** deps (`@sengoku-jidai/terrain`, `@sengoku-jidai/board-render`) on the server package.

**Spec:** `docs/superpowers/specs/2026-07-08-sp6-terrain-custom-maps-design.md`.

## Global Constraints

- No new third-party npm dependencies. New workspace deps allowed: server gains `@sengoku-jidai/terrain` and `@sengoku-jidai/board-render` (both `workspace:*`).
- The running app calls fal.ai **only** on an explicit author trigger, and **only** when `FAL_KEY` is set. CI and tests never hit the network — the fal client is always injected (`EditDeps`).
- Terrain status values are exactly `"none" | "pending" | "ready" | "failed"`.
- `map_terrain.status` DB values are exactly `"pending" | "ready" | "failed"` (a map with no row reports `"none"`).
- Generation is allowed for maps referenced by live games (terrain is cosmetic; it never touches `HexMapSource` or game state) — do NOT reuse the `mapInUse` 409 guard for it.
- Built-in maps (Rivers) never use this path — they keep their committed asset; `POST` on a built-in is rejected.
- Use `corepack pnpm` for all commands. Rebuild workspace libs before filtered tests that consume them: `corepack pnpm build:libs` (engine + shared) and, because the server now imports terrain + board-render, `corepack pnpm --filter @sengoku-jidai/terrain --filter @sengoku-jidai/board-render run build` before server tests if those packages changed.
- Stage files INDIVIDUALLY (never `git add -A`/`git add .` — untracked `.claude/`, `.superpowers/`, `.pnpm-store/` must not be committed).
- vitest does not typecheck — run `typecheck` separately.
- Branch: `sp6-terrain-custom-maps` (already created; the spec commit is on it). Base = main `ce615ca`… (current main HEAD).
- Run all commands from repo root `/mnt/ssd_pool/martin/repos/sengoku_jidai`.

## File structure

| File | Responsibility |
|---|---|
| `packages/terrain/src/mapPipeline.ts` (modify) | Extract fs-free `generateTerrainWebp`; `runMapPipeline` wraps it |
| `packages/terrain/src/index.ts` (modify) | Export `generateTerrainWebp`, `EditDeps`, `loadMapProfile`, `MapProfile` |
| `packages/terrain/test/generateTerrainWebp.test.ts` (create) | Core runs mask→control→edit→webp from a source, no fs |
| `packages/terrain/test/maskFromProceduralSvg.test.ts` (create) | Assembled board-render SVG yields a valid land mask |
| `packages/server/migrations/003_map_terrain.sql` (create) | `map_terrain` table |
| `packages/server/src/persistence/database.ts` (modify) | Register migration `003` |
| `packages/server/src/maps/terrainStore.ts` (create) | Owns `map_terrain`: status/save/webp + boot reset |
| `packages/server/src/maps/terrainService.ts` (create) | `available()` + `generate(mapId)`: source→svg/map→core→store |
| `packages/server/src/config.ts` (modify) | Read `FAL_KEY` (optional) into config |
| `packages/server/src/app.ts` (modify) | Build store+service, reset pending on boot, pass to routes |
| `packages/server/src/api/routes.ts` (modify) | `POST/GET` terrain endpoints; `MapDetail.terrain` |
| `packages/server/src/maps/library.ts` (modify) | `MapDetail` includes `terrain` from the store |
| `packages/shared/src/api.ts` (modify) | `MapDetail.terrain: TerrainStatus` |
| `packages/server/test/*` (create/modify) | Store, service, endpoint tests |

---

### Task 1: Extract `generateTerrainWebp` (filesystem-free pipeline core)

**Files:**
- Modify: `packages/terrain/src/mapPipeline.ts`
- Modify: `packages/terrain/src/index.ts`
- Test: `packages/terrain/test/generateTerrainWebp.test.ts`

**Interfaces:**
- Consumes: existing `renderLandMask`, `renderControl`, `editMapPass`, `toWebp`, `outputHeightForViewBox`, `EditDeps`, `MapProfile`; engine `compileHexMap`; board-render `assembleBoardSvg`/`buildScene` (test only).
- Produces (used by the server service in Task 4): `generateTerrainWebp(deps: EditDeps, args: { svgMarkup: string; map: MapDefinition; profile: MapProfile }): Promise<Buffer>` — runs the full pipeline with **no filesystem reads/writes** and returns the webp bytes. Re-exported from `@sengoku-jidai/terrain` along with `EditDeps`, `loadMapProfile`, `MapProfile`.

- [ ] **Step 0: Add board-render as a terrain devDependency (for tests)**

The terrain tests (this task and Task 2) build a real `(svgMarkup, map)` pair from a
`HexMapSource` so the two correspond exactly (the mask recolor keys tile ids). In
`packages/terrain/package.json` add to `devDependencies`:

```json
    "@sengoku-jidai/board-render": "workspace:*",
```

(`@sengoku-jidai/engine` is already a prod dep.) Run `corepack pnpm install`, then
`corepack pnpm exec prettier --write pnpm-lock.yaml`.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/generateTerrainWebp.test.ts`:

```ts
import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { describe, expect, it, vi } from "vitest";
import type { EditDeps } from "../src/editPass.js";
import { generateTerrainWebp } from "../src/mapPipeline.js";
import type { MapProfile } from "../src/mapProfile.js";

// Real source → real (svgMarkup, map) pair that correspond (same tile ids).
const SOURCE = {
  id: "m",
  name: "Gen Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 3
};

const PROFILE: MapProfile = {
  base: {
    landColor: "#2e7d32",
    seaColor: "#1565c0",
    outputSize: { width: 64 },
    organicSigma: 2,
    coastWarp: { amplitude: 0, scale: 0.003, seed: 7 }
  },
  edit: {
    model: "fake/model",
    styleRef: "assets/style-ref.jpeg",
    resolution: "1K",
    seed: 1,
    prompt: "draw a map"
  },
  webpQuality: 80
};

function fakeDeps(): EditDeps {
  // A tiny valid PNG the edit model "returns"; the pipeline converts it to webp.
  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  return {
    fal: {
      storage: { upload: vi.fn(async () => "https://fal/uploaded") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://fal/result.png" }] } }))
    },
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => onePxPng.buffer.slice(0, onePxPng.length)
    }))
  };
}

describe("generateTerrainWebp", () => {
  it("runs the pipeline from a source and returns webp bytes", async () => {
    const compiled = compileHexMap(SOURCE as never);
    const svgMarkup = assembleBoardSvg(buildScene(compiled));
    const deps = fakeDeps();
    const out = await generateTerrainWebp(deps, {
      svgMarkup,
      map: compiled.definition,
      profile: PROFILE
    });
    // WebP magic: "RIFF"...."WEBP"
    expect(out.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // Uploaded exactly two images (control + style) and called the model once.
    expect(deps.fal.storage.upload).toHaveBeenCalledTimes(2);
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/board-render run build && corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/generateTerrainWebp.test.ts`
Expected: FAIL — `generateTerrainWebp` is not exported from `mapPipeline.js`.

- [ ] **Step 3: Refactor `mapPipeline.ts`**

In `packages/terrain/src/mapPipeline.ts`, add the new core and make `runMapPipeline` call it. Replace the body between the imports and `outputHeightForViewBox` so the file reads:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { MapDefinition } from "@sengoku-jidai/engine";
import { getMap } from "@sengoku-jidai/engine";
import { renderControl } from "./composite.js";
import { editMapPass, type EditDeps } from "./editPass.js";
import { mapSvgPath } from "./mapSources.js";
import { renderLandMask } from "./masks.js";
import type { MapProfile } from "./mapProfile.js";
import { toWebp } from "./postprocess.js";

/**
 * Filesystem-free pipeline core. Structure comes from `svgMarkup` (any board SVG with
 * `.tile` paths + a viewBox); a domain-warped land mask becomes a flat control, which a
 * multi-image edit model redraws in the style reference's hand-drawn look. Returns the
 * final webp bytes. The only file it reads is the packaged style reference.
 */
export async function generateTerrainWebp(
  deps: EditDeps,
  args: { svgMarkup: string; map: MapDefinition; profile: MapProfile }
): Promise<Buffer> {
  const { svgMarkup, map, profile } = args;
  const { base } = profile;
  const width = base.outputSize.width;
  const height = outputHeightForViewBox(svgMarkup, width);

  const landMask = await renderLandMask({
    svgMarkup,
    map,
    width,
    height,
    organicSigma: base.organicSigma,
    coastWarp: base.coastWarp
  });
  const control = await renderControl({
    landMask,
    landColor: base.landColor,
    seaColor: base.seaColor,
    width,
    height
  });
  const styleImage = await sharp(
    readFileSync(fileURLToPath(new URL(`../${profile.edit.styleRef}`, import.meta.url)))
  )
    .resize(width, height, { fit: "cover" })
    .jpeg()
    .toBuffer();
  const edited = await editMapPass(deps, {
    controlImage: control,
    styleImage,
    model: profile.edit.model,
    prompt: profile.edit.prompt,
    resolution: profile.edit.resolution,
    seed: profile.edit.seed
  });
  return toWebp(edited, { width, height, quality: profile.webpQuality });
}

/**
 * Dev CLI path: resolve a committed board SVG + registered map by id, run the core, and
 * write every intermediate next to the final webp for inspection.
 */
export async function runMapPipeline(
  deps: EditDeps,
  args: { mapId: string; profile: MapProfile; outDir: string }
): Promise<{ outDir: string; webpPath: string }> {
  const { mapId, profile, outDir } = args;
  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  mkdirSync(outDir, { recursive: true });
  const webp = await generateTerrainWebp(deps, { svgMarkup, map, profile });
  const webpPath = join(outDir, "background.webp");
  writeFileSync(webpPath, webp);
  return { outDir, webpPath };
}
```

Keep the existing `outputHeightForViewBox` function below unchanged.

Note: the dev CLI no longer writes the `landMask.png`/`control.png`/`edited.png` intermediates (they were inspection-only and the core no longer returns them). This is an intentional, acceptable simplification — the CLI still produces `background.webp`.

- [ ] **Step 4: Export from the package index**

Replace `packages/terrain/src/index.ts` with:

```ts
export const TERRAIN_PACKAGE = "@sengoku-jidai/terrain";
export { generateTerrainWebp, runMapPipeline } from "./mapPipeline.js";
export { loadMapProfile, type MapProfile } from "./mapProfile.js";
export type { EditDeps } from "./editPass.js";
export type { FalClient, FetchFn } from "./backend.js";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/terrain test && corepack pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: PASS — the new test and the existing `mapPipeline.test.ts` both green.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/mapPipeline.ts packages/terrain/src/index.ts packages/terrain/test/generateTerrainWebp.test.ts packages/terrain/package.json pnpm-lock.yaml
git commit -m "refactor(terrain): filesystem-free generateTerrainWebp core"
```

---

### Task 2: Prove the mask works from a procedurally-assembled SVG

The server will feed `assembleBoardSvg(buildScene(compileHexMap(source)))` into the core. The mask recolor path (`prepBoardSvgMarkup` + `tileColorMap`) was written against Rivers' committed `board.svg`; this task proves it also works on board-render's output, and fixes the recolor path if the selector/attribute contract differs.

**Files:**
- Test: `packages/terrain/test/maskFromProceduralSvg.test.ts`
- Possibly modify: `packages/terrain/src/controlImage.ts` (only if the test proves a real gap)

**Interfaces:**
- Consumes: `renderLandMask` (Task 0 baseline), board-render `assembleBoardSvg`/`buildScene`, engine `compileHexMap`.
- Produces: confidence (a regression test) that the core accepts procedural SVGs. No new exports.

Note: the board-render devDependency was already added in Task 1 Step 0.

- [ ] **Step 1: Write the test**

Create `packages/terrain/test/maskFromProceduralSvg.test.ts`:

```ts
import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderLandMask } from "../src/masks.js";

// Two adjacent single-hex tiles: t1 land, t2 sea.
const SOURCE = {
  id: "m",
  name: "Mask Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 3
};

describe("renderLandMask from a procedural board SVG", () => {
  it("produces a binary mask with both land (white) and sea (black) present", async () => {
    const compiled = compileHexMap(SOURCE as never);
    const svgMarkup = assembleBoardSvg(buildScene(compiled));

    const maskPng = await renderLandMask({
      svgMarkup,
      map: compiled.definition,
      width: 128,
      height: 64,
      organicSigma: 0
    });

    const { data, info } = await sharp(maskPng).greyscale().raw().toBuffer({
      resolveWithObject: true
    });
    let white = 0;
    let black = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i]! > 200) white++;
      else if (data[i]! < 55) black++;
    }
    // Both classes present ⇒ the recolor correctly split land vs sea from procedural output.
    expect(white).toBeGreaterThan(0);
    expect(black).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/board-render run build && corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/maskFromProceduralSvg.test.ts`
Expected: PASS. If it FAILS with all-white or all-black, the recolor path keys on something board.svg-specific.

- [ ] **Step 3: Fix the recolor path only if the test failed**

Read `packages/terrain/src/controlImage.ts` `prepBoardSvgMarkup`/`tileColorMap`. The likely gap: it selects tiles by an attribute board-render doesn't emit, or expects `fill=` where board-render uses `style="fill:…"`. Adjust the selector/recolor to target `path.tile[id]` and set both `fill` attribute and `style` fill, keyed by `map.spaces[].id` → land/sea color. Re-run Step 2 until green. If Step 2 passed, skip this step and note "no fix needed" in your report.

- [ ] **Step 4: Commit**

```bash
git add packages/terrain/test/maskFromProceduralSvg.test.ts
# include controlImage.ts only if you changed it:
git add packages/terrain/src/controlImage.ts 2>/dev/null || true
git commit -m "test(terrain): land mask renders from procedural board SVG"
```

---

### Task 3: `map_terrain` table + `TerrainStore`

**Files:**
- Create: `packages/server/migrations/003_map_terrain.sql`
- Modify: `packages/server/src/persistence/database.ts` (register `003`)
- Create: `packages/server/src/maps/terrainStore.ts`
- Test: `packages/server/test/terrainStore.test.ts`

**Interfaces:**
- Consumes: `SqliteDatabase`.
- Produces (used by service + routes + app):
  - `TerrainStatus` is imported from `@sengoku-jidai/shared` (added in Step 1a), not redefined here.
  - class `TerrainStore` with:
    - `status(mapId: string): TerrainStatus`
    - `markPending(mapId: string): void`
    - `saveReady(mapId: string, webp: Buffer): void`
    - `markFailed(mapId: string, error: string): void`
    - `webp(mapId: string): Buffer | null`
    - `updatedAt(mapId: string): string | null`
    - `resetInterrupted(): void` (boot: every `pending` → `failed`)

- [ ] **Step 1a: Add the shared `TerrainStatus` type (single source of truth)**

`TerrainStatus` is used by the store here, by `MapLibrary`, and by the shared `MapDetail` DTO —
define it ONCE in shared. In `packages/shared/src/api.ts`, add above `MapSummary`:

```ts
export type TerrainStatus = "none" | "pending" | "ready" | "failed";
```

Run `corepack pnpm --filter @sengoku-jidai/shared run build` so the server can import it.

- [ ] **Step 1: Write the migration**

Create `packages/server/migrations/003_map_terrain.sql`:

```sql
CREATE TABLE IF NOT EXISTS map_terrain (
  map_id     TEXT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  webp       BLOB,
  error      TEXT,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Register the migration**

In `packages/server/src/persistence/database.ts`, change the migrations array:

```ts
  const migrations = ["001_initial.sql", "002_maps.sql", "003_map_terrain.sql"];
```

- [ ] **Step 3: Write the failing test**

Create `packages/server/test/terrainStore.test.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainStore.test.ts`
Expected: FAIL — cannot resolve `../src/maps/terrainStore.js`.

- [ ] **Step 5: Implement `TerrainStore`**

Create `packages/server/src/maps/terrainStore.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/migrations/003_map_terrain.sql packages/server/src/persistence/database.ts packages/server/src/maps/terrainStore.ts packages/server/test/terrainStore.test.ts
git commit -m "feat(server): map_terrain table and TerrainStore"
```

---

### Task 4: `TerrainService` (source → svg/map → core → store)

**Files:**
- Modify: `packages/server/package.json` (add workspace deps)
- Create: `packages/server/src/maps/terrainService.ts`
- Test: `packages/server/test/terrainService.test.ts`

**Interfaces:**
- Consumes: `MapLibrary.get`, `TerrainStore`, terrain `generateTerrainWebp`/`EditDeps`/`loadMapProfile`, board-render `assembleBoardSvg`/`buildScene`, engine `compileHexMap`.
- Produces (used by app + routes):
  - `class TerrainService` constructed as `new TerrainService({ library, store, falKey, deps? })`.
  - `available(): boolean` — true iff a fal key is configured.
  - `generate(mapId: string): Promise<void>` — resolves the source, marks pending, runs the core, calls `saveReady`/`markFailed`. Never throws for a generation failure (records it).
  - `isGenerating(mapId: string): boolean` — in-flight guard.

- [ ] **Step 1: Add workspace deps**

In `packages/server/package.json`, add to `dependencies`:

```json
    "@sengoku-jidai/board-render": "workspace:*",
    "@sengoku-jidai/terrain": "workspace:*",
```

Run `corepack pnpm install`, then `corepack pnpm exec prettier --write pnpm-lock.yaml`.

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/terrainService.test.ts`:

```ts
import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it, vi } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";
import { TerrainService } from "../src/maps/terrainService.js";
import type { EditDeps } from "@sengoku-jidai/terrain";

function fakeDeps(): EditDeps {
  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  return {
    fal: {
      storage: { upload: vi.fn(async () => "https://fal/u") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://fal/r.png" }] } }))
    },
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => onePxPng.buffer.slice(0, onePxPng.length)
    }))
  };
}

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const library = new MapLibrary(db);
  const created = library.create(structuredClone(FIXTURE_HEX_MAP));
  if (!created.ok) throw new Error("fixture create failed");
  const store = new TerrainStore(db);
  return { library, store, mapId: created.value.id };
}

describe("TerrainService", () => {
  it("available() reflects whether a fal key is set", () => {
    const { library, store } = setup();
    expect(new TerrainService({ library, store, falKey: undefined }).available()).toBe(false);
    expect(new TerrainService({ library, store, falKey: "k" }).available()).toBe(true);
  });

  it("generate() stores a ready webp for a valid map", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    await service.generate(mapId);
    expect(store.status(mapId)).toBe("ready");
    expect(store.webp(mapId)?.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("generate() records failure when the source is unknown", async () => {
    const { library, store } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    await service.generate("does-not-exist");
    expect(store.status("does-not-exist")).toBe("none"); // no maps row ⇒ never marked
  });

  it("generate() records failure when the edit model errors", async () => {
    const { library, store, mapId } = setup();
    const deps = fakeDeps();
    deps.fal.subscribe = vi.fn(async () => {
      throw new Error("fal down");
    });
    const service = new TerrainService({ library, store, falKey: "k", deps });
    await service.generate(mapId);
    expect(store.status(mapId)).toBe("failed");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/terrain --filter @sengoku-jidai/board-render run build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainService.test.ts`
Expected: FAIL — cannot resolve `terrainService.js`.

- [ ] **Step 4: Implement `TerrainService`**

Create `packages/server/src/maps/terrainService.ts`:

```ts
import { fileURLToPath } from "node:url";
import { compileHexMap } from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import {
  generateTerrainWebp,
  loadMapProfile,
  type EditDeps,
  type MapProfile
} from "@sengoku-jidai/terrain";
import type { MapLibrary } from "./library.js";
import type { TerrainStore } from "./terrainStore.js";

/** Locate the terrain package's shipped profile via its package entry, so this resolves the
 *  same file whether running from source (tests) or the built server. */
function defaultProfile(): MapProfile {
  const profilePath = fileURLToPath(
    new URL("../../../terrain/profiles/map.json", import.meta.url)
  );
  return loadMapProfile(profilePath);
}

interface TerrainServiceArgs {
  library: MapLibrary;
  store: TerrainStore;
  falKey: string | undefined;
  deps?: EditDeps;
  profile?: MapProfile;
}

export class TerrainService {
  private readonly library: MapLibrary;
  private readonly store: TerrainStore;
  private readonly falKey: string | undefined;
  private readonly deps: EditDeps | undefined;
  private readonly profile: MapProfile;
  private readonly inflight = new Set<string>();

  constructor(args: TerrainServiceArgs) {
    this.library = args.library;
    this.store = args.store;
    this.falKey = args.falKey;
    this.deps = args.deps;
    this.profile = args.profile ?? defaultProfile();
  }

  available(): boolean {
    return Boolean(this.falKey);
  }

  isGenerating(mapId: string): boolean {
    return this.inflight.has(mapId);
  }

  /** Resolve the deps: injected in tests; built from FAL_KEY + global fetch in production. */
  private async resolveDeps(): Promise<EditDeps> {
    if (this.deps) {
      return this.deps;
    }
    const { fal } = await import("@fal-ai/client");
    fal.config({ credentials: this.falKey });
    return { fal: fal as unknown as EditDeps["fal"], fetch: globalThis.fetch };
  }

  async generate(mapId: string): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return; // routes reject these before calling; guard anyway, record nothing
    }
    this.inflight.add(mapId);
    this.store.markPending(mapId);
    try {
      const source = detail.source as HexMapSource;
      const compiled = compileHexMap(source);
      const svgMarkup = assembleBoardSvg(buildScene(compiled));
      const deps = await this.resolveDeps();
      // Reroll the seed each run so regenerating the same map yields a different look
      // (spec: "each run varies the fal seed"). A fresh 31-bit seed per generation.
      const profile: MapProfile = {
        ...this.profile,
        edit: { ...this.profile.edit, seed: Math.floor(Math.random() * 0x7fffffff) }
      };
      const webp = await generateTerrainWebp(deps, {
        svgMarkup,
        map: compiled.definition,
        profile
      });
      this.store.saveReady(mapId, webp);
    } catch (err) {
      this.store.markFailed(mapId, err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight.delete(mapId);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/src/maps/terrainService.ts packages/server/test/terrainService.test.ts
git commit -m "feat(server): TerrainService generates terrain from a stored map"
```

---

### Task 5: Config `FAL_KEY` + `MapDetail.terrain` DTO + library wiring

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/server/src/maps/library.ts`
- Test: `packages/server/test/config.test.ts` (extend), `packages/server/test/mapLibrary.test.ts` (extend)

**Interfaces:**
- Consumes: `TerrainStore.status`, `TerrainStatus` (shared, from Task 3 Step 1a).
- Produces:
  - `ServerConfig.falKey: string | undefined`.
  - `MapDetail.terrain: TerrainStatus` (shared DTO — the type already exists; this task adds the field to `MapDetail`).
  - `MapLibrary.get` accepts an optional terrain-status resolver so `MapDetail.terrain` is populated. Signature: `get(id: string, terrainStatus?: (id: string) => TerrainStatus): MapDetail | null` — defaults to `"none"` when omitted (keeps existing callers/tests working).

- [ ] **Step 1: Add `falKey` to config**

In `packages/server/src/config.ts`: add `falKey: z.string().optional()` to the schema object, and in `loadConfig`'s returned object add `falKey: env.FAL_KEY` (before the closing brace). Do not make it required — its absence disables the feature.

- [ ] **Step 2: Add the `terrain` field to `MapDetail`**

`TerrainStatus` was already added to `packages/shared/src/api.ts` in Task 3 Step 1a. Now add the
field to `MapDetail`:

```ts
  /** Server-side terrain generation state; "none" for built-ins and un-generated maps. */
  terrain: TerrainStatus;
```

Run `corepack pnpm --filter @sengoku-jidai/shared run build`.

- [ ] **Step 3: Write the failing test (library populates terrain)**

Add to `packages/server/test/mapLibrary.test.ts` (a new `it`):

```ts
it("get() reports terrain status from the provided resolver", () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const library = new MapLibrary(db);
  const created = library.create(structuredClone(FIXTURE_HEX_MAP));
  if (!created.ok) throw new Error("create failed");
  const id = created.value.id;
  // default: none
  expect(library.get(id)?.terrain).toBe("none");
  // with a resolver
  expect(library.get(id, () => "ready")?.terrain).toBe("ready");
  // built-in always none
  expect(library.get("rivers", () => "ready")?.terrain).toBe("none");
});
```

(If `mapLibrary.test.ts` lacks the imports `openDatabase`/`runMigrations`/`FIXTURE_HEX_MAP`/`MapLibrary`, add them — mirror `mapsApi.test.ts`.)

- [ ] **Step 4: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/mapLibrary.test.ts`
Expected: FAIL — `terrain` is `undefined` / `get` takes one arg.

- [ ] **Step 5: Wire the library**

In `packages/server/src/maps/library.ts`:
- Import the type: `import type { HexMapSourceDto, MapDetail, MapSummary, TerrainStatus } from "@sengoku-jidai/shared";`
- Change `get`:

```ts
  get(id: string, terrainStatus?: (id: string) => TerrainStatus): MapDetail | null {
    const builtin = BUILTIN_SOURCES.find((source) => source.id === id);
    if (builtin) {
      return {
        id,
        name: builtin.name,
        builtin: true,
        updatedAt: null,
        terrain: "none",
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
      source: JSON.parse(row.source_json) as HexMapSourceDto
    };
  }
```

- The `create`/`update` methods also return a `MapDetail`. Add `terrain: "none"` to both of their returned `value` objects (a freshly created/updated map has no terrain yet).

- [ ] **Step 6: Run tests + typecheck**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/server test && corepack pnpm --filter @sengoku-jidai/server typecheck`
Expected: PASS. (The existing `mapsApi.test.ts` may assert `MapDetail` shape — if it deep-equals, add `terrain: "none"` to its expectations.)

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/config.ts packages/shared/src/api.ts packages/server/src/maps/library.ts packages/server/test/mapLibrary.test.ts packages/server/test/config.test.ts
git commit -m "feat(server): FAL_KEY config and MapDetail.terrain status"
```

---

### Task 6: Endpoints + app wiring

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/api/routes.ts`
- Test: `packages/server/test/terrainApi.test.ts` (create)

**Interfaces:**
- Consumes: `TerrainService`, `TerrainStore`, `MapLibrary`.
- Produces: HTTP surface — `POST /api/maps/:mapId/terrain`, `GET /api/maps/:mapId/terrain.webp`, and `MapDetail.terrain` on `GET /api/maps/:mapId`.

- [ ] **Step 1: Wire the service into `app.ts`**

In `packages/server/src/app.ts`, after `mapLibrary.loadAll(app.log);` add:

```ts
  const terrainStore = new TerrainStore(db);
  terrainStore.resetInterrupted();
  const terrainService = new TerrainService({
    library: mapLibrary,
    store: terrainStore,
    falKey: config.falKey
  });
```

Add imports at the top:

```ts
import { TerrainStore } from "./maps/terrainStore.js";
import { TerrainService } from "./maps/terrainService.js";
```

Change the routes registration to pass the new collaborators:

```ts
  registerApiRoutes(app, repository, mapLibrary, terrainStore, terrainService);
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/terrainApi.test.ts`:

```ts
import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it, vi } from "vitest";
import fastify from "fastify";
import { registerApiRoutes } from "../src/api/routes.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";
import { TerrainService } from "../src/maps/terrainService.js";
import { GameRepository } from "../src/persistence/repository.js";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import type { EditDeps } from "@sengoku-jidai/terrain";

function fakeDeps(): EditDeps {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  return {
    fal: {
      storage: { upload: vi.fn(async () => "https://fal/u") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://fal/r.png" }] } }))
    },
    fetch: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(0, png.length) }))
  };
}

function buildTestApp(opts: { falKey?: string; deps?: EditDeps } = {}) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const library = new MapLibrary(db);
  const store = new TerrainStore(db);
  const service = new TerrainService({ library, store, falKey: opts.falKey ?? "k", deps: opts.deps ?? fakeDeps() });
  const app = fastify({ logger: false });
  registerApiRoutes(app, new GameRepository(db), library, store, service);
  return { app, library };
}

async function createMap(app: ReturnType<typeof fastify>) {
  const res = await app.inject({ method: "POST", url: "/api/maps", payload: structuredClone(FIXTURE_HEX_MAP) });
  return res.json().id as string;
}

describe("terrain API", () => {
  it("503 when no FAL_KEY is configured", async () => {
    const { app } = buildTestApp({ falKey: undefined });
    const id = await createMap(app);
    const res = await app.inject({ method: "POST", url: `/api/maps/${id}/terrain` });
    expect(res.statusCode).toBe(503);
  });

  it("404 for an unknown map", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "POST", url: "/api/maps/nope/terrain" });
    expect(res.statusCode).toBe(404);
  });

  it("403 for a built-in map", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "POST", url: "/api/maps/rivers/terrain" });
    expect(res.statusCode).toBe(403);
  });

  it("generates, reports ready, and serves the webp", async () => {
    const { app } = buildTestApp();
    const id = await createMap(app);
    const post = await app.inject({ method: "POST", url: `/api/maps/${id}/terrain` });
    expect(post.statusCode).toBe(202);
    // generation is fire-and-forget; poll the detail until ready
    let terrain = "pending";
    for (let i = 0; i < 50 && terrain !== "ready"; i++) {
      const detail = await app.inject({ method: "GET", url: `/api/maps/${id}` });
      terrain = detail.json().terrain;
      if (terrain !== "ready") await new Promise((r) => setTimeout(r, 20));
    }
    expect(terrain).toBe("ready");
    const img = await app.inject({ method: "GET", url: `/api/maps/${id}/terrain.webp` });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.rawPayload.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("404 on the webp before generation", async () => {
    const { app } = buildTestApp();
    const id = await createMap(app);
    const res = await app.inject({ method: "GET", url: `/api/maps/${id}/terrain.webp` });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainApi.test.ts`
Expected: FAIL — `registerApiRoutes` takes 3 args / routes missing.

- [ ] **Step 4: Implement the routes**

In `packages/server/src/api/routes.ts`:
- Add imports: `import type { TerrainStore } from "../maps/terrainStore.js";` and `import type { TerrainService } from "../maps/terrainService.js";`
- Change the signature and pass the new collaborators through:

```ts
export function registerApiRoutes(
  app: FastifyInstance,
  repository: GameRepository,
  mapLibrary: MapLibrary,
  terrainStore: TerrainStore,
  terrainService: TerrainService
): void {
```

- Change the existing `GET /api/maps/:mapId` handler's `mapLibrary.get(params.data.mapId)` call to pass the resolver:

```ts
    const map = mapLibrary.get(params.data.mapId, (id) => terrainStore.status(id));
```

- Add these two handlers (near the other `/api/maps` routes):

```ts
  app.post("/api/maps/:mapId/terrain", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    if (!terrainService.available()) {
      return sendError(reply, 503, "terrainUnavailable", "Terrain generation is not configured.");
    }
    const detail = mapLibrary.get(params.data.mapId);
    if (!detail) {
      return sendError(reply, 404, "mapNotFound", "Map was not found.");
    }
    if (detail.builtin) {
      return sendError(reply, 403, "builtinMap", "Built-in maps already have terrain.");
    }
    if (terrainService.isGenerating(params.data.mapId)) {
      return sendError(reply, 409, "terrainInProgress", "Terrain is already generating.");
    }
    // Fire-and-forget: generation runs in-process and records its own result.
    void terrainService.generate(params.data.mapId);
    return reply.status(202).send({ status: "pending" });
  });

  app.get("/api/maps/:mapId/terrain.webp", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    const webp = terrainStore.webp(params.data.mapId);
    if (!webp) {
      return sendError(reply, 404, "terrainNotFound", "No terrain for this map.");
    }
    const updatedAt = terrainStore.updatedAt(params.data.mapId) ?? "";
    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=60")
      .header("ETag", `"${params.data.mapId}-${updatedAt}"`)
      .send(webp);
  });
```

- [ ] **Step 5: Run tests + typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/server test && corepack pnpm --filter @sengoku-jidai/server typecheck`
Expected: PASS — including the new `terrainApi.test.ts` and the updated `mapsApi.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/api/routes.ts packages/server/test/terrainApi.test.ts
git commit -m "feat(server): terrain generation + serving endpoints"
```

---

### Task 7: Ops — ship terrain assets in the server image + full gate + PR

**Files:**
- Modify: `Dockerfile` (only if the terrain `profiles/`+`assets/` are not already included in the server runtime)
- Modify: `.env.example` (document `FAL_KEY`)

- [ ] **Step 1: Verify the terrain runtime assets ship**

The server now reads `packages/terrain/profiles/map.json` and `packages/terrain/assets/style-ref.jpeg` at runtime (via `import.meta.url`). Inspect the `Dockerfile` build: confirm the terrain package's `profiles/` and `assets/` directories are present in the final image (per the asset rules in `memory/cross-package-gotchas.md`). If the image prunes non-`dist` files, add a copy step for `packages/terrain/profiles` and `packages/terrain/assets`. If they're already included (workspace copy), note "already shipped" — no Dockerfile change.

- [ ] **Step 2: Document the env var**

In `.env.example`, add (if not present):

```
# Optional: enables server-side terrain generation for custom maps (fal.ai). Feature disabled if unset.
FAL_KEY=
```

- [ ] **Step 3: Full gate**

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm exec prettier --check $(git diff --name-only main..HEAD -- 'packages/**' 'Dockerfile' '.env.example')
```

Expected: all PASS.

- [ ] **Step 4: Push + PR (stop for review)**

```bash
git push -u origin sp6-terrain-custom-maps
gh pr create --base main --title "feat(server): SP6 terrain for custom maps — backend" --body "<summary of endpoints, storage, FAL_KEY gating; note web PR follows>"
```

Watch CI to green, then STOP for Martin's review/merge (squash + delete branch). Do not merge.
Note: this backend PR adds capability with **no UI** — the app is fully working; nothing calls the new endpoints until the web PR.
