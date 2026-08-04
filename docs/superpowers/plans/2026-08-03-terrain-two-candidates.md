# Two-candidate terrain generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editor terrain **Generate** produces two base-only candidate images; the author keeps one, and the fort inpaint runs once on the winner.

**Architecture:** A terrain row gains a `choosing` state backed by a `map_terrain_candidates` side-table holding exactly two base-only webps. `TerrainService.generate` renders two base-only terrains (no `scene` → fort pass skipped) concurrently and lands the row in `choosing`; `TerrainService.choose` runs a new `inpaintFortsOnWebp` on the chosen base and commits it as `ready`. The editor Terrains panel renders the two candidates with **Keep** buttons.

**Tech Stack:** TypeScript, pnpm workspaces, Fastify, better-sqlite3, Zod, Vitest, React, sharp, `@fal-ai/client`.

## Global Constraints

- New `TerrainStatus` value is exactly `choosing`. Do not rename existing values (`none`/`pending`/`ready`/`failed`).
- Exactly **two** candidates per generation (indices `0` and `1`). Do not generalise to N.
- Candidates are **base-only** (call `generateTerrainWebp` WITHOUT `scene`). The fort inpaint runs only in `choose`, on the winner.
- In-game play-view is unaffected: `buildTerrainOptions` already lists only `status === 'ready'` terrains — keep it that way.
- One generation at a time per map (existing `inflight` guard, keyed by map id).
- `MAX_TERRAINS_PER_MAP` counts terrain rows; a `choosing` terrain is one row.
- Cross-package dist: consumers read built dist. After editing `@sengoku-jidai/shared` rebuild it; after editing `@sengoku-jidai/terrain` rebuild it — BEFORE running server/web tests that consume them (see `cross-package-gotchas`).
- Full gate before push: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint` + `corepack pnpm exec prettier --check .` — prettier LAST.
- Testmap id (for any manual check): `fc5161b0-f889-41e6-ab32-9106276c86c7`.

---

### Task 1: Persistence — `choosing` status, migration 006, candidate store ops

**Files:**
- Modify: `packages/shared/src/api.ts` (`TerrainStatus` union)
- Create: `packages/server/migrations/006_terrain_candidates.sql`
- Modify: `packages/server/src/persistence/database.ts` (register migration)
- Modify: `packages/server/src/maps/terrainStore.ts` (candidate ops + candidate-clearing on transitions)
- Test: `packages/server/test/terrainStore.test.ts` (create if absent)

**Interfaces:**
- Consumes: `SqliteDatabase`, existing `TerrainStore`.
- Produces: `TerrainStatus` includes `"choosing"`; `TerrainStore` gains `markChoosing(id)`, `markFinalizing(id)`, `addCandidate(id, idx, webp)`, `clearCandidates(id)`, `candidateWebp(id, idx): Buffer | null`, `candidateCount(id): number`; `markReadyById`/`markFailedById`/`markPendingById` now also clear candidates (but `markFinalizing` does NOT).

- [ ] **Step 1: Add the `choosing` status (shared)**

In `packages/shared/src/api.ts`, change the `TerrainStatus` type:

```ts
export type TerrainStatus = "none" | "pending" | "ready" | "failed" | "choosing";
```

`TerrainInfo.status` is `Exclude<TerrainStatus, "none">` and needs no other edit.

- [ ] **Step 2: Rebuild shared**

Run: `corepack pnpm --filter @sengoku-jidai/shared build`
Expected: exits 0.

- [ ] **Step 3: Create migration 006**

Create `packages/server/migrations/006_terrain_candidates.sql`:

```sql
CREATE TABLE map_terrain_candidates (
  id         TEXT PRIMARY KEY,
  terrain_id TEXT NOT NULL REFERENCES map_terrains(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  webp       BLOB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(terrain_id, idx)
);
CREATE INDEX map_terrain_candidates_terrain_id ON map_terrain_candidates(terrain_id);
```

- [ ] **Step 4: Register the migration**

In `packages/server/src/persistence/database.ts`, append to the `migrations` array (after `"005_admin_tokens.sql"`):

```ts
    "006_terrain_candidates.sql"
```

- [ ] **Step 5: Write failing store tests**

Create `packages/server/test/terrainStore.test.ts`:

```ts
import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const library = new MapLibrary(db);
  const created = library.create(structuredClone(FIXTURE_HEX_MAP));
  if (!created.ok) throw new Error("fixture create failed");
  return { store: new TerrainStore(db), mapId: created.value.id };
}

describe("TerrainStore candidates", () => {
  it("adds, reads, counts and clears candidates and enters choosing", () => {
    const { store, mapId } = setup();
    const id = store.create(mapId, "Terrain 1", "fantasy");
    store.addCandidate(id, 0, Buffer.from("aaa"));
    store.addCandidate(id, 1, Buffer.from("bbbb"));
    store.markChoosing(id);
    expect(store.get(id)?.status).toBe("choosing");
    expect(store.candidateCount(id)).toBe(2);
    expect(store.candidateWebp(id, 0)?.toString()).toBe("aaa");
    expect(store.candidateWebp(id, 1)?.toString()).toBe("bbbb");
    store.clearCandidates(id);
    expect(store.candidateCount(id)).toBe(0);
    expect(store.candidateWebp(id, 0)).toBeNull();
  });

  it("markReady clears candidates; markFinalizing keeps them", () => {
    const { store, mapId } = setup();
    const id = store.create(mapId, "Terrain 1", "fantasy");
    store.addCandidate(id, 0, Buffer.from("x"));
    store.addCandidate(id, 1, Buffer.from("y"));
    store.markChoosing(id);
    store.markFinalizing(id);
    expect(store.get(id)?.status).toBe("pending");
    expect(store.candidateCount(id)).toBe(2); // preserved for retry/revert
    store.markReadyById(id, Buffer.from("RIFFxxxxWEBP"));
    expect(store.get(id)?.status).toBe("ready");
    expect(store.candidateCount(id)).toBe(0); // consumed
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainStore.test.ts`
Expected: FAIL (methods `addCandidate`/`markChoosing`/etc. not defined).

- [ ] **Step 7: Implement the store ops**

In `packages/server/src/maps/terrainStore.ts`, add these methods to `TerrainStore` (place after `resetInterrupted`):

```ts
  markChoosing(terrainId: string): void {
    this.db
      .prepare("UPDATE map_terrains SET status = 'choosing', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), terrainId);
  }

  /** Finalising after a pick: show progress (pending) but KEEP candidates so a failed inpaint
   *  can revert to choosing. Unlike markPendingById, does not clear candidates. */
  markFinalizing(terrainId: string): void {
    this.db
      .prepare("UPDATE map_terrains SET status = 'pending', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), terrainId);
  }

  addCandidate(terrainId: string, idx: number, webp: Buffer): void {
    this.db
      .prepare(
        `INSERT INTO map_terrain_candidates (id, terrain_id, idx, webp, created_at)
         VALUES (@id, @terrainId, @idx, @webp, @now)`
      )
      .run({ id: randomUUID(), terrainId, idx, webp, now: new Date().toISOString() });
  }

  clearCandidates(terrainId: string): void {
    this.db.prepare("DELETE FROM map_terrain_candidates WHERE terrain_id = ?").run(terrainId);
  }

  candidateWebp(terrainId: string, idx: number): Buffer | null {
    const r = this.db
      .prepare("SELECT webp FROM map_terrain_candidates WHERE terrain_id = ? AND idx = ?")
      .get(terrainId, idx) as { webp: Buffer } | undefined;
    return r?.webp ?? null;
  }

  candidateCount(terrainId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM map_terrain_candidates WHERE terrain_id = ?")
        .get(terrainId) as { n: number }
    ).n;
  }
```

Then add `this.clearCandidates(terrainId);` as the FIRST line of the bodies of `markPendingById`, `markReadyById`, and `markFailedById` (candidates are abandoned on regenerate, consumed on ready, discarded on failure). Do NOT add it to `markFinalizing`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainStore.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/api.ts packages/server/migrations/006_terrain_candidates.sql packages/server/src/persistence/database.ts packages/server/src/maps/terrainStore.ts packages/server/test/terrainStore.test.ts
git commit -m "feat(terrain): choosing status + candidate side-table + store ops"
```

---

### Task 2: terrain pipeline — `inpaintFortsOnWebp`

**Files:**
- Modify: `packages/terrain/src/mapPipeline.ts` (new exported function)
- Modify: `packages/terrain/src/index.ts` (export it)
- Test: `packages/terrain/test/inpaintFortsOnWebp.test.ts`

**Interfaces:**
- Consumes: existing `applyInpaintFortPass`, `applyFortPass`, `fortMarkers`, `toWebp`, `type FortScene`, `MapProfile`, `EditDeps` (all in `mapPipeline.ts` scope).
- Produces: `inpaintFortsOnWebp(deps: EditDeps, args: { webp: Buffer; profile: MapProfile; scene: FortScene }): Promise<Buffer>` — runs the fort pass on an existing base webp (no-op when the scene has no forts), returning webp bytes. Exported from the package index.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/inpaintFortsOnWebp.test.ts`:

```ts
import { compileHexMap } from "@sengoku-jidai/engine";
import { buildScene } from "@sengoku-jidai/board-render";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { EditDeps } from "../src/editPass.js";
import { inpaintFortsOnWebp } from "../src/mapPipeline.js";
import type { MapProfile } from "../src/mapProfile.js";

const FORT_SOURCE = {
  id: "mf",
  name: "Fort",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { fort: true } },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 3
};
const NO_FORT_SOURCE = { ...FORT_SOURCE, tiles: [{ ...FORT_SOURCE.tiles[0], features: {} }, FORT_SOURCE.tiles[1]] };

const PROFILE = {
  base: { landColor: "#2e7d32", seaColor: "#1565c0", outputSize: { width: 64 }, organicSigma: 0, background: "sea", coastWarp: { amplitude: 0, scale: 0.003, seed: 7 } },
  edit: { model: "fake/model", quality: "high", inputFidelity: "high", prompt: "p" },
  fortPass: { method: "inpaint", model: "fake/fill", inpaintPrompt: "castle", prompt: "m", markerRadiusFactor: 0.45, markerColor: "#ff00ff", maskRadiusFactor: 0.7 },
  webpQuality: 80
} as unknown as MapProfile;

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
    fetch: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => onePxPng.buffer.slice(onePxPng.byteOffset, onePxPng.byteOffset + onePxPng.length) }))
  };
}

async function baseWebp(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#888888" } }).webp().toBuffer();
}

describe("inpaintFortsOnWebp", () => {
  it("runs one inpaint call per fort and returns webp", async () => {
    const scene = buildScene(compileHexMap(FORT_SOURCE as never));
    const deps = fakeDeps();
    const out = await inpaintFortsOnWebp(deps, { webp: await baseWebp(64, 70), profile: PROFILE, scene });
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(1); // one fort tile
  });

  it("is a no-op (no model calls) when the scene has no forts", async () => {
    const scene = buildScene(compileHexMap(NO_FORT_SOURCE as never));
    const deps = fakeDeps();
    const input = await baseWebp(64, 70);
    const out = await inpaintFortsOnWebp(deps, { webp: input, profile: PROFILE, scene });
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/inpaintFortsOnWebp.test.ts`
Expected: FAIL — `inpaintFortsOnWebp` is not exported.

- [ ] **Step 3: Implement `inpaintFortsOnWebp`**

In `packages/terrain/src/mapPipeline.ts`, add after `generateTerrainWebp` (it reuses the same in-file helpers `applyInpaintFortPass`, `applyFortPass`, `fortMarkers`, `toWebp`):

```ts
/**
 * Apply the fort pass to an EXISTING base terrain webp (used by the two-candidate flow: the base
 * is generated first, forts are inpainted only onto the chosen winner). Width/height come from the
 * webp itself. When the scene has no fort tiles this re-encodes the input unchanged (no model call).
 */
export async function inpaintFortsOnWebp(
  deps: EditDeps,
  args: { webp: Buffer; profile: MapProfile; scene: FortScene }
): Promise<Buffer> {
  const { webp, profile, scene } = args;
  const meta = await sharp(webp).metadata();
  const width = meta.width ?? profile.base.outputSize.width;
  const height = meta.height ?? width;
  const base = await sharp(webp).resize(width, height, { fit: "fill" }).png().toBuffer();

  const hasForts = fortMarkers(scene, width, profile.fortPass.markerRadiusFactor).length > 0;
  if (!hasForts) {
    return toWebp(base, { width, height, quality: profile.webpQuality });
  }
  const terrain =
    profile.fortPass.method === "inpaint"
      ? await applyInpaintFortPass(deps, {
          base,
          width,
          height,
          profile,
          scene,
          model: profile.fortPass.model,
          prompt: profile.fortPass.inpaintPrompt
        })
      : await applyFortPass(deps, { base, width, height, profile, scene });
  return toWebp(terrain, { width, height, quality: profile.webpQuality });
}
```

- [ ] **Step 4: Export it**

In `packages/terrain/src/index.ts`, add `inpaintFortsOnWebp` to the `mapPipeline.js` export:

```ts
export { generateTerrainWebp, runMapPipeline, inpaintFortsOnWebp } from "./mapPipeline.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/inpaintFortsOnWebp.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild terrain (server consumes dist)**

Run: `corepack pnpm --filter @sengoku-jidai/terrain build`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/terrain/src/mapPipeline.ts packages/terrain/src/index.ts packages/terrain/test/inpaintFortsOnWebp.test.ts
git commit -m "feat(terrain): inpaintFortsOnWebp — fort pass over an existing base webp"
```

---

### Task 3: `TerrainService` — two-candidate generate + choose

**Files:**
- Modify: `packages/server/src/maps/terrainService.ts`
- Test: `packages/server/test/terrainService.test.ts` (add cases)

**Interfaces:**
- Consumes: `TerrainStore` candidate ops (Task 1); `inpaintFortsOnWebp` (Task 2); existing `generateTerrainWebp`, `loadStyleProfile`, `compileHexMap`, `buildScene`, `assembleBoardSvg`.
- Produces: `generate(mapId, styleId)` renders TWO base-only candidates and lands the row in `choosing`; new `choose(mapId, terrainId, index: number): void` finalises the winner. `isGenerating` unchanged.

- [ ] **Step 1: Write failing service tests**

Add to `packages/server/test/terrainService.test.ts` (reuse its existing `setup`, `fakeDeps`, `waitFor`):

```ts
  it("generate() renders two base candidates and lands in choosing", async () => {
    const { library, store, mapId } = setup();
    const deps = fakeDeps();
    const service = new TerrainService({ library, store, falKey: "k", deps });
    const id = service.generate(mapId, "fantasy");
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
    expect(store.candidateCount(id)).toBe(2);
    // Two base passes (control+style upload each), zero fort model calls at generate time.
    // Each base pass calls subscribe once → two subscribe calls total for a fort-less base.
    expect((deps.fal.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("choose() finalises the picked candidate to ready and clears candidates", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = service.generate(mapId, "fantasy");
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
    service.choose(mapId, id, 0);
    await waitFor(() => expect(store.get(id)?.status).toBe("ready"));
    expect(store.webpById(id)?.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(store.candidateCount(id)).toBe(0);
  });
```

(The FIXTURE map's fort count drives whether `choose` makes an inpaint call; the finalise result is `ready` either way. Fort-call counting is covered in Task 2.)

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainService.test.ts`
Expected: FAIL (status is `ready` after generate, or `choose` undefined).

- [ ] **Step 3: Implement two-candidate generate + choose**

In `packages/server/src/maps/terrainService.ts`:

Add the import:

```ts
import {
  createFalClient,
  generateTerrainWebp,
  inpaintFortsOnWebp,
  loadStyleProfile,
  type EditDeps
} from "@sengoku-jidai/terrain";
```

Replace the `run` method with a base-candidates renderer, and add `choose` + a private `finalize`:

```ts
  /** Render TWO base-only candidates (gpt-image varies naturally) and land the row in choosing.
   *  Inflight guard keyed by map id so a map generates one terrain at a time. */
  private async run(mapId: string, terrainId: string, styleId: string): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return;
    }
    this.inflight.add(mapId);
    this.store.markPendingById(terrainId); // clears any stale candidates from a prior attempt
    try {
      const compiled = compileHexMap(detail.source as HexMapSource);
      const svgMarkup = assembleBoardSvg(buildScene(compiled));
      const deps = await this.resolveDeps();
      const profile = loadStyleProfile(styleId);
      // Base-only: no `scene` → the fort pass is skipped for candidates.
      const [a, b] = await Promise.all([
        generateTerrainWebp(deps, { svgMarkup, map: compiled.definition, profile }),
        generateTerrainWebp(deps, { svgMarkup, map: compiled.definition, profile })
      ]);
      this.store.addCandidate(terrainId, 0, a);
      this.store.addCandidate(terrainId, 1, b);
      this.store.markChoosing(terrainId);
    } catch (err) {
      this.store.markFailedById(terrainId, err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight.delete(mapId);
    }
  }

  /** Keep candidate `index`: inpaint forts onto that base and commit it as the ready terrain. */
  choose(mapId: string, terrainId: string, index: number): void {
    void this.finalize(mapId, terrainId, index);
  }

  private async finalize(mapId: string, terrainId: string, index: number): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return;
    }
    const base = this.store.candidateWebp(terrainId, index);
    if (!base) {
      return; // nothing to finalise
    }
    const styleId = this.store.styleIdOf(terrainId) ?? "antique";
    this.inflight.add(mapId);
    this.store.markFinalizing(terrainId); // pending, candidates preserved
    try {
      const compiled = compileHexMap(detail.source as HexMapSource);
      const scene = buildScene(compiled);
      const deps = await this.resolveDeps();
      const webp = await inpaintFortsOnWebp(deps, { webp: base, profile: loadStyleProfile(styleId), scene });
      this.store.markReadyById(terrainId, webp); // clears candidates
    } catch {
      this.store.markChoosing(terrainId); // revert; candidates intact so the pick can be retried
    } finally {
      this.inflight.delete(mapId);
    }
  }
```

Remove the now-unused `assembleBoardSvg` import ONLY if it is no longer referenced (it still is, in `run`). Keep `buildScene`/`assembleBoardSvg`/`compileHexMap` imports.

- [ ] **Step 4: Run to verify pass**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainService.test.ts`
Expected: PASS (all cases, including the pre-existing ones — the pre-existing "generate() creates a ready terrain" test asserted `ready`; UPDATE it to expect `choosing` + candidateCount 2, since behaviour intentionally changed).

- [ ] **Step 5: Reconcile the pre-existing generate test**

The pre-existing `generate() creates a ready terrain and returns its id` test now contradicts the new behaviour. Change its assertion to the choosing lifecycle:

```ts
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
    expect(store.candidateCount(id)).toBe(2);
    expect(store.list(mapId).map((t) => t.name)).toEqual(["Terrain 1"]);
```

Re-run the file; expect PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/maps/terrainService.ts packages/server/test/terrainService.test.ts
git commit -m "feat(terrain): TerrainService renders 2 candidates + choose() finalises winner"
```

---

### Task 4: Routes — serve candidates + choose endpoint

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Test: `packages/server/test/terrainApi.test.ts` (add cases)

**Interfaces:**
- Consumes: `terrainStore.candidateWebp`/`get`, `terrainService.choose`/`isGenerating` (Tasks 1, 3).
- Produces: `GET /api/maps/:mapId/terrains/:terrainId/candidates/:idx.webp` (serves a candidate while `choosing`); `POST /api/maps/:mapId/terrains/:terrainId/choose` (body `{ index: 0 | 1 }`).

- [ ] **Step 1: Write failing route tests**

Add to `packages/server/test/terrainApi.test.ts` (mirror the existing generate-and-serve test's harness — same app builder + fake deps; poll the map detail for status). Concretely:

```ts
  it("serves candidates while choosing, then choose finalises to a served webp", async () => {
    const { app, mapId } = await setupWithTerrain(); // existing helper that builds app + a custom map
    const create = await app.inject({ method: "POST", url: `/api/maps/${mapId}/terrains`, payload: { styleId: "fantasy" } });
    const { id } = create.json() as { id: string };

    await vi.waitFor(async () => {
      const detail = await app.inject({ method: "GET", url: `/api/maps/${mapId}` });
      const t = (detail.json() as { terrains: { id: string; status: string }[] }).terrains.find((x) => x.id === id);
      expect(t?.status).toBe("choosing");
    }, { timeout: 20000, interval: 50 });

    const cand = await app.inject({ method: "GET", url: `/api/maps/${mapId}/terrains/${id}/candidates/0.webp` });
    expect(cand.statusCode).toBe(200);
    expect(cand.headers["content-type"]).toBe("image/webp");

    const bad = await app.inject({ method: "POST", url: `/api/maps/${mapId}/terrains/${id}/choose`, payload: { index: 5 } });
    expect(bad.statusCode).toBe(400);

    const chosen = await app.inject({ method: "POST", url: `/api/maps/${mapId}/terrains/${id}/choose`, payload: { index: 0 } });
    expect(chosen.statusCode).toBe(202);

    await vi.waitFor(async () => {
      const webp = await app.inject({ method: "GET", url: `/api/maps/${mapId}/terrains/${id}.webp` });
      expect(webp.statusCode).toBe(200);
    }, { timeout: 20000, interval: 50 });
  });
```

If `terrainApi.test.ts` lacks a `setupWithTerrain` helper, model the app/deps construction on the file's existing generate test (reuse its exact setup lines).

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainApi.test.ts`
Expected: FAIL (candidate route 404 / choose route missing).

- [ ] **Step 3: Add the routes**

In `packages/server/src/api/routes.ts`, after the existing `GET …/:terrainId.webp` handler, add:

```ts
  app.get("/api/maps/:mapId/terrains/:terrainId/candidates/:idx.webp", async (request, reply) => {
    const params = z
      .object({ mapId: z.string().min(1), terrainId: z.string().min(1), idx: z.coerce.number().int().min(0).max(1) })
      .safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    const terrain = terrainStore.get(params.data.terrainId);
    if (!terrain || terrain.status !== "choosing") {
      return sendError(reply, 404, "terrainNotFound", "No candidate for this id.");
    }
    const webp = terrainStore.candidateWebp(params.data.terrainId, params.data.idx);
    if (!webp) {
      return sendError(reply, 404, "terrainNotFound", "No candidate for this id.");
    }
    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=60")
      .header("ETag", `"${params.data.terrainId}-${params.data.idx}-${terrain.updatedAt}"`)
      .send(webp);
  });

  app.post("/api/maps/:mapId/terrains/:terrainId/choose", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    const body = z.object({ index: z.number().int().min(0).max(1) }).safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalidRequest", "index must be 0 or 1.");
    }
    const terrain = terrainStore.get(params.data.terrainId);
    if (!terrain) {
      return sendError(reply, 404, "terrainNotFound", "Terrain was not found.");
    }
    if (terrain.status !== "choosing") {
      return sendError(reply, 409, "terrainNotChoosing", "This terrain is not awaiting a choice.");
    }
    if (terrainService.isGenerating(params.data.mapId)) {
      return sendError(reply, 409, "terrainInProgress", "Terrain is busy.");
    }
    terrainService.choose(params.data.mapId, params.data.terrainId, body.data.index);
    return reply.status(202).send({ id: params.data.terrainId });
  });
```

(`terrainParamsSchema` already exists above in this file.)

- [ ] **Step 4: Run to verify pass**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/test/terrainApi.test.ts
git commit -m "feat(terrain): candidate webp route + choose endpoint"
```

---

### Task 5: Editor UI — candidate chooser

**Files:**
- Modify: `packages/web/src/client/api.ts` (choose call + candidate url)
- Modify: `packages/web/src/components/editor/TerrainsPanel.tsx` (render chooser)
- Test: `packages/web/src/components/board/terrainImages.test.ts` (choosing excluded) and `packages/web/src/components/editor/TerrainsPanel.test.tsx` (chooser UI)

**Interfaces:**
- Consumes: `POST …/choose`, `GET …/candidates/:idx.webp` (Task 4); `TerrainInfo.status === "choosing"` (Task 1).
- Produces: `chooseTerrainCandidate(mapId, terrainId, index)` + `candidatePreviewUrl(...)` in the client; a two-candidate chooser row in the panel.

- [ ] **Step 1: Add the client calls**

In `packages/web/src/client/api.ts`, after `deleteTerrain`:

```ts
export async function chooseTerrainCandidate(
  mapId: string,
  terrainId: string,
  index: number
): Promise<void> {
  await request(
    `/api/maps/${encodeURIComponent(mapId)}/terrains/${encodeURIComponent(terrainId)}/choose`,
    { method: "POST", body: JSON.stringify({ index }) }
  );
}

/** Cache-busted URL for a base-only candidate preview (only valid while the terrain is choosing). */
export function candidatePreviewUrl(
  mapId: string,
  terrainId: string,
  idx: number,
  updatedAt: string
): string {
  return `/api/maps/${encodeURIComponent(mapId)}/terrains/${encodeURIComponent(terrainId)}/candidates/${idx}.webp?v=${encodeURIComponent(updatedAt)}`;
}
```

- [ ] **Step 2: Write a failing `buildTerrainOptions` exclusion test**

Add to `packages/web/src/components/board/terrainImages.test.ts`:

```ts
  it("excludes a choosing terrain from play-view options", () => {
    const options = buildTerrainOptions({
      mapId: "m",
      committed: null,
      terrains: [
        { id: "t1", name: "A", styleId: "fantasy", status: "choosing", updatedAt: "1" },
        { id: "t2", name: "B", styleId: "fantasy", status: "ready", updatedAt: "1" }
      ] as never
    });
    expect(options.map((o) => o.key)).toEqual(["flat", "t2"]);
  });
```

- [ ] **Step 3: Run to verify it passes already (guard test)**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/components/board/terrainImages.test.ts`
Expected: PASS immediately — `buildTerrainOptions` already filters `status === "ready"`. (This test locks that behaviour against regressions; no code change needed.)

- [ ] **Step 4: Write the failing panel test**

Create `packages/web/src/components/editor/TerrainsPanel.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerrainsPanel } from "./TerrainsPanel.js";
import * as api from "../../client/api.js";

const choosingTerrain = { id: "t1", name: "Terrain 1", styleId: "fantasy", status: "choosing", updatedAt: "1" };

describe("TerrainsPanel chooser", () => {
  it("shows two Keep buttons for a choosing terrain and calls choose", async () => {
    const spy = vi.spyOn(api, "chooseTerrainCandidate").mockResolvedValue();
    vi.spyOn(api, "fetchMap").mockResolvedValue({ terrains: [choosingTerrain] } as never);
    render(
      <TerrainsPanel
        mapId="m"
        terrains={[choosingTerrain as never]}
        selectedTerrainId={null}
        onSelect={() => {}}
        onTerrainsChange={() => {}}
      />
    );
    const keeps = screen.getAllByRole("button", { name: /keep/i });
    expect(keeps).toHaveLength(2);
    fireEvent.click(keeps[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("m", "t1", 0));
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/components/editor/TerrainsPanel.test.tsx`
Expected: FAIL (no Keep buttons rendered).

- [ ] **Step 6: Implement the chooser in the panel**

In `packages/web/src/components/editor/TerrainsPanel.tsx`:

Add to the imports from `../../client/api.js`: `chooseTerrainCandidate` and `candidatePreviewUrl`.

Add a handler inside the component (near `confirmDelete`):

```ts
  async function handleChoose(terrainId: string, index: number): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await chooseTerrainCandidate(mapId, terrainId, index);
      await refetch(); // status flips to pending (finalising); polling drives it to ready
    } catch {
      setError("Choosing failed — try again.");
      await refetch();
    } finally {
      setBusy(false);
    }
  }
```

In the terrain `<li>` rendering, when `terrain.status === "choosing"`, render the chooser (place it after the status badge, replacing the normal preview radio/name row for that terrain — the simplest is to render an extra block below the name row):

```tsx
              {terrain.status === "choosing" ? (
                <div className="terrain-candidates">
                  {[0, 1].map((idx) => (
                    <div key={idx} className="terrain-candidate">
                      <img
                        alt={`Candidate ${idx + 1}`}
                        src={candidatePreviewUrl(mapId, terrain.id, idx, terrain.updatedAt)}
                      />
                      <button
                        type="button"
                        onClick={() => void handleChoose(terrain.id, idx)}
                        disabled={busy}
                      >
                        Keep {idx + 1}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
```

- [ ] **Step 7: Run to verify pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/components/editor/TerrainsPanel.test.tsx src/components/board/terrainImages.test.ts`
Expected: PASS.

- [ ] **Step 8: Add minimal styles (optional but keeps the chooser usable)**

In the editor CSS (search for `.terrains-list` in `packages/web/src/styles/app.css`), add:

```css
.terrain-candidates { display: flex; gap: 8px; margin-top: 6px; }
.terrain-candidate { display: flex; flex-direction: column; gap: 4px; }
.terrain-candidate img { width: 120px; height: auto; border-radius: 4px; }
```

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/client/api.ts packages/web/src/components/editor/TerrainsPanel.tsx packages/web/src/components/editor/TerrainsPanel.test.tsx packages/web/src/components/board/terrainImages.test.ts packages/web/src/styles/app.css
git commit -m "feat(terrain): editor candidate chooser (two previews, Keep to finalise)"
```

---

### Task 6: Full gate + PR

**Files:** none new — verifies the whole change set.

- [ ] **Step 1: Rebuild dist + run the full gate**

```bash
corepack pnpm --filter @sengoku-jidai/shared --filter @sengoku-jidai/terrain build
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint
```
Expected: all green. Common failures: e2e specs asserting old terrain UI text (update to match), the terrain typecheck including `test/`.

- [ ] **Step 2: Prettier LAST**

Run: `corepack pnpm exec prettier --check .` (then `--write` any flagged touched files and re-check).

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/terrain-generate-two-candidates
gh pr create --title "feat(terrain): generate 2 candidates, author keeps one" --body "$(cat <<'EOF'
Editor **Generate** now renders two base-only terrain candidates; the author picks one and the fort inpaint runs on the winner.

- New `choosing` terrain status + `map_terrain_candidates` side-table (migration 006).
- `TerrainService.generate` renders 2 base-only webps concurrently → `choosing`; `choose()` inpaints forts onto the winner → `ready`. `inpaintFortsOnWebp` (terrain pkg) runs the fort pass over an existing base webp.
- Routes: `GET …/terrains/:id/candidates/:idx.webp`, `POST …/terrains/:id/choose`.
- Editor Terrains panel shows the two candidates with Keep buttons.
- Play-view picker unchanged (only `ready` terrains listed).

Cost: 2× base per generate; fort inpaint once, on the winner.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI to green**

Run: `gh pr checks <n> --watch`; fix failures and re-push.

- [ ] **Step 5: Ask before merging.** Report green; ask Martin to merge (squash + delete branch). Do NOT self-merge.

---

## Self-Review

**Spec coverage:**
- `choosing` status → Task 1. ✓
- Candidates side-table + migration → Task 1. ✓
- Store candidate ops + candidate-clearing transitions → Task 1. ✓
- `inpaintFortsOnWebp` (base-only + winner inpaint split) → Task 2. ✓
- Service 2-candidate generate + choose (revert-on-failure) → Task 3. ✓
- Candidate serve + choose routes → Task 4. ✓
- Client calls + chooser UI + play-view exclusion → Task 5. ✓
- Cost model / one-at-a-time / cap unchanged → constraints honoured across Tasks 3–4. ✓

**Placeholder scan:** No TBD/TODO. Test steps that reuse an existing file's harness (Task 3 `setup`/`fakeDeps`, Task 4 `setupWithTerrain`) name the exact existing symbols to reuse rather than re-pasting them, and say to mirror the file's existing generate test if a helper is absent — the implementer has the file open.

**Type/name consistency:** `choosing` status, `map_terrain_candidates(id,terrain_id,idx,webp,created_at)`, `markChoosing`/`markFinalizing`/`addCandidate`/`clearCandidates`/`candidateWebp`/`candidateCount`, `inpaintFortsOnWebp({webp,profile,scene})`, `choose(mapId,terrainId,index)`, `chooseTerrainCandidate`/`candidatePreviewUrl` are used identically across Tasks 1–5. `markFinalizing` intentionally does NOT clear candidates while the other `mark*` transitions do — asserted in Task 1's test and relied on by Task 3's revert path.
