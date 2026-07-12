# Terrain Ink Style (PR-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second selectable terrain style — a black-and-white pen-and-ink cartography look (`ink`) — alongside the current colored `antique` look, with a shared style catalog and a `loadStyleProfile(id)` resolver, so PR-A/PR-B can later let authors pick a style when generating.

**Architecture:** The style catalog (id + UI label) is a single source of truth in `@sengoku-jidai/shared`. The terrain package gains a second profile `profiles/ink.json` (a new prompt + a cropped two-band texture swatch) and a `loadStyleProfile(styleId)` function that maps an id → its committed profile JSON (antique→`map.json`, ink→`ink.json`) and throws on unknown ids. The server's `defaultProfile()` is re-pointed through `loadStyleProfile("antique")` — behavior-identical, but it removes the fragile hand-built `../../../terrain/profiles/map.json` path. No engine/GameState/multiplayer changes (terrain is purely client-side per [[multiple-terrains-initiative]]). Actual per-style *selection* at generate time is PR-A (needs the DB `style_id` column + API); this PR only lands the catalog, the ink profile, and the resolver.

**Tech Stack:** TypeScript, zod (profile schema), sharp (swatch crop + pipeline), vitest, fal.ai `gpt-image-1.5/edit` (validation only).

## Global Constraints

- Package manager: `corepack pnpm` (never bare `pnpm`/`npm`). Rebuild shared/engine/terrain **dist** before running filtered tests that consume them (dist-consumption trap, [[cross-package-gotchas]]).
- No new third-party deps — still `@fal-ai/client`, `sharp`, `zod`.
- Full gate before push: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm exec prettier --check .` — fix until green ([[dev-workflow-prefs]]).
- Own branch off fresh `main` → one focused PR → watch CI green → **ask before merging** (squash + delete branch).
- Control colors stay green/blue (`#2e7d32` / `#1565c0`) — internal region markers, never shown; the white/grey ink look comes from the swatch + prompt.
- Ink template source (NOT committed to the repo): `/mnt/ssd_pool/ssd_set/terrain-gen/Alternate_terrain.png` (1559×1009).
- Dockerfile already `COPY`s `packages/terrain/profiles` and `packages/terrain/assets` wholesale — new `ink.json` + `ink-texture-ref.png` ship automatically, no Docker change.
- Limited fal credits: build/verify offline first; exactly **one** real ink generation for validation (pre-approved by Martin, confirm at the gate).

---

### Task 1: Shared terrain-style catalog

**Files:**
- Modify: `packages/shared/src/api.ts` (append the catalog near the other exported consts/types)
- Test: `packages/shared/test/terrainStyles.test.ts` (create)

**Interfaces:**
- Produces:
  - `export const TERRAIN_STYLES: readonly { readonly id: string; readonly label: string }[]`
  - `export type TerrainStyleId = (typeof TERRAIN_STYLES)[number]["id"]` (`"antique" | "ink"`)
  - `export const DEFAULT_TERRAIN_STYLE: TerrainStyleId = "antique"`
  - `export function isTerrainStyleId(v: string): v is TerrainStyleId`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/terrainStyles.test.ts
import { describe, expect, it } from "vitest";
import {
  TERRAIN_STYLES,
  DEFAULT_TERRAIN_STYLE,
  isTerrainStyleId
} from "../src/api.js";

describe("terrain style catalog", () => {
  it("lists antique (default, first) and ink with labels", () => {
    expect(TERRAIN_STYLES.map((s) => s.id)).toEqual(["antique", "ink"]);
    for (const s of TERRAIN_STYLES) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("defaults to antique", () => {
    expect(DEFAULT_TERRAIN_STYLE).toBe("antique");
    expect(TERRAIN_STYLES[0].id).toBe(DEFAULT_TERRAIN_STYLE);
  });

  it("recognises valid ids and rejects unknown ones", () => {
    expect(isTerrainStyleId("antique")).toBe(true);
    expect(isTerrainStyleId("ink")).toBe(true);
    expect(isTerrainStyleId("watercolour")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/shared exec vitest run test/terrainStyles.test.ts`
Expected: FAIL — `TERRAIN_STYLES` is not exported.

- [ ] **Step 3: Add the catalog to `packages/shared/src/api.ts`**

Append at the end of the file:

```ts
/** Selectable terrain generation styles (id + UI label). Single source of truth for the
 *  editor style dropdown (PR-B) and the generate API (PR-A). `antique` is the default. The
 *  terrain package maps each id to a committed profile JSON via `loadStyleProfile`. */
export const TERRAIN_STYLES = [
  { id: "antique", label: "Antique (colour)" },
  { id: "ink", label: "Ink (greyscale)" }
] as const;

export type TerrainStyleId = (typeof TERRAIN_STYLES)[number]["id"];

export const DEFAULT_TERRAIN_STYLE: TerrainStyleId = "antique";

export function isTerrainStyleId(value: string): value is TerrainStyleId {
  return TERRAIN_STYLES.some((s) => s.id === value);
}
```

(`packages/shared/src/index.ts` already does `export * from "./api.js"`, so no index edit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/shared exec vitest run test/terrainStyles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/test/terrainStyles.test.ts
git commit -m "feat(shared): terrain style catalog (antique + ink)"
```

---

### Task 2: Ink texture swatch + `profiles/ink.json`

**Files:**
- Create: `packages/terrain/assets/ink-texture-ref.png` (cropped two-band legend, committed binary)
- Create: `packages/terrain/profiles/ink.json`
- Modify: `packages/terrain/profiles/README.md` (note the second profile)
- Test: `packages/terrain/test/inkProfile.test.ts` (create)

**Interfaces:**
- Consumes: the existing `MapProfile` zod schema (`packages/terrain/src/mapProfile.ts`) — no schema change; `ink.json` must satisfy it.
- Produces: a committed `ink.json` whose `edit.styleRef` = `"assets/ink-texture-ref.png"`.

- [ ] **Step 1: Build the two-band swatch (throwaway script, then commit the PNG)**

The swatch is a **texture legend**, not a map: TOP band = an interior LAND patch (white paper with scattered tiny-tree symbols + grass tufts + gentle hill lines — **avoid** the dense central mountain range and any coastline), BOTTOM band = an open SEA patch (flat light-grey mottled parchment). Crop both from `Alternate_terrain.png`, resize to a common width, stack land-over-sea.

Run from `packages/terrain`:

```bash
cd packages/terrain && corepack pnpm exec node -e '
const sharp = require("sharp");
const SRC = "/mnt/ssd_pool/ssd_set/terrain-gen/Alternate_terrain.png"; // 1559x1009
const W = 512;
(async () => {
  // Interior land: scattered trees/tufts on white (no coast, no big mountain).
  const land = await sharp(SRC)
    .extract({ left: 340, top: 420, width: 420, height: 260 })
    .resize(W).png().toBuffer();
  // Open sea: flat grey mottled parchment.
  const sea = await sharp(SRC)
    .extract({ left: 1090, top: 70, width: 420, height: 200 })
    .resize(W).png().toBuffer();
  const lh = (await sharp(land).metadata()).height;
  const sh = (await sharp(sea).metadata()).height;
  await sharp({ create: { width: W, height: lh + sh, channels: 3, background: "#ffffff" } })
    .composite([{ input: land, top: 0, left: 0 }, { input: sea, top: lh, left: 0 }])
    .png()
    .toFile("assets/ink-texture-ref.png");
  console.log("wrote assets/ink-texture-ref.png", W + "x" + (lh + sh));
})().catch((e) => { console.error(e); process.exit(1); });
'
```

- [ ] **Step 2: Eyeball the swatch and adjust crop if needed**

Read `packages/terrain/assets/ink-texture-ref.png`. Confirm: TOP band = clean white land with delicate tree/tuft line-art (no coastline, no dense black mountain), BOTTOM band = flat grey mottled sea. If a band caught a coastline/mountain or too-empty an area, re-run Step 1 with adjusted `extract` rects until both bands read as pure texture.

- [ ] **Step 3: Create `packages/terrain/profiles/ink.json`**

```json
{
  "base": {
    "landColor": "#2e7d32",
    "seaColor": "#1565c0",
    "outputSize": { "width": 1024 },
    "organicSigma": 20,
    "background": "sea",
    "coastWarp": { "amplitude": 45, "scale": 0.006, "seed": 7 }
  },
  "edit": {
    "model": "fal-ai/gpt-image-1.5/edit",
    "styleRef": "assets/ink-texture-ref.png",
    "quality": "high",
    "inputFidelity": "high",
    "prompt": "You are given two images. The FIRST image is a control map: solid GREEN regions are LAND, solid BLUE regions are SEA water. The SECOND image is a TEXTURE LEGEND, not a map — its TOP HALF shows the LAND drawing style (hand-drawn black pen-and-ink fantasy cartography on white paper: fine line-art forests as clusters of tiny trees, small mountain ridges as hatched peaks, grass tufts and hills, delicate and sparse) and its BOTTOM HALF shows the SEA drawing style (flat light grey mottled parchment). Redraw the FIRST image as one black-and-white hand-drawn fantasy ink map: place LAND in every GREEN region and SEA in every BLUE region, keeping the same islands and landmasses in the SAME positions, sizes and overall shapes as the control. This is a flat overhead map filling the ENTIRE frame edge to edge — no horizon, no sky, no perspective, no empty margin. Draw every COASTLINE as a crisp black hand-drawn ink line, and echo each coastline with three to five concentric hand-drawn depth-contour lines rippling out into the grey sea (antique bathymetric lines), following the shore's shape. Fill LAND (white paper) with delicate black line-art — scattered tiny tree symbols, small hatched mountain ridges, grass tufts, gentle hill lines — denser inland, sparser near the coast. Keep SEA a flat light grey mottled parchment with only the contour ripples, no waves. IMPORTANT: do NOT copy any shapes, islands, coastlines, or composition from the texture legend — it supplies ONLY the two drawing styles; ALL land and sea placement comes from the control map. CRITICAL MAPPING: green control region becomes white inked LAND, blue control region becomes grey SEA. Do not swap them. Flat top-down 2D map, no labels, no text, no border."
  },
  "webpQuality": 82
}
```

- [ ] **Step 4: Write the failing test**

```ts
// packages/terrain/test/inkProfile.test.ts
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadMapProfile } from "../src/mapProfile.js";

describe("ink profile", () => {
  it("parses ink.json and points at a committed swatch", () => {
    const p = loadMapProfile(fileURLToPath(new URL("../profiles/ink.json", import.meta.url)));
    expect(p.edit.model).toBe("fal-ai/gpt-image-1.5/edit");
    expect(p.edit.styleRef).toBe("assets/ink-texture-ref.png");
    expect(p.edit.inputFidelity).toBe("high");
    expect(p.base.background).toBe("sea");
    expect(p.edit.prompt).toMatch(/pen-and-ink|ink map/i);
    const swatch = fileURLToPath(
      new URL(`../${p.edit.styleRef}`, import.meta.url)
    );
    expect(existsSync(swatch)).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it passes** (the ink.json + swatch already exist from Steps 1–3)

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/inkProfile.test.ts`
Expected: PASS.

- [ ] **Step 6: Note the second profile in the README**

In `packages/terrain/profiles/README.md`, change the opening so it no longer claims a single profile — add a short line: `ink.json` is the greyscale pen-and-ink style (same schema, different prompt + swatch); `map.json` is the colored antique style. `loadStyleProfile(id)` in the terrain package resolves an id to one of these.

- [ ] **Step 7: Commit**

```bash
git add packages/terrain/assets/ink-texture-ref.png packages/terrain/profiles/ink.json \
        packages/terrain/profiles/README.md packages/terrain/test/inkProfile.test.ts
git commit -m "feat(terrain): ink (greyscale) style profile + texture swatch"
```

---

### Task 3: `loadStyleProfile(styleId)` resolver

**Files:**
- Modify: `packages/terrain/src/mapProfile.ts` (add resolver + a filename map)
- Modify: `packages/terrain/src/index.ts` (export `loadStyleProfile`)
- Test: `packages/terrain/test/mapProfile.test.ts` (extend)

**Interfaces:**
- Consumes: `loadMapProfile(path)` and `MapProfile` (same file); the two committed profiles from Task 2 / existing `map.json`.
- Produces: `export function loadStyleProfile(styleId: string): MapProfile` — maps `"antique"→profiles/map.json`, `"ink"→profiles/ink.json` (resolved via `import.meta.url`, robust under dist), throws `Error(/unknown terrain style/)` on any other id. Ids mirror `TERRAIN_STYLES` in shared (kept in sync by Task 5's test).

- [ ] **Step 1: Write the failing tests** (append to `packages/terrain/test/mapProfile.test.ts`)

```ts
import { loadStyleProfile } from "../src/mapProfile.js";

describe("loadStyleProfile", () => {
  it("resolves antique to the colored profile", () => {
    const p = loadStyleProfile("antique");
    expect(p.edit.styleRef).toBe("assets/texture-ref.jpeg");
    expect(p.edit.prompt.length).toBeGreaterThan(0);
  });

  it("resolves ink to the greyscale profile", () => {
    const p = loadStyleProfile("ink");
    expect(p.edit.styleRef).toBe("assets/ink-texture-ref.png");
  });

  it("throws a clear error on an unknown style id", () => {
    expect(() => loadStyleProfile("watercolour")).toThrow(/unknown terrain style/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/mapProfile.test.ts`
Expected: FAIL — `loadStyleProfile` is not exported.

- [ ] **Step 3: Implement in `packages/terrain/src/mapProfile.ts`**

Add `import { fileURLToPath } from "node:url";` to the existing imports, then at the end of the file:

```ts
/** Committed profile file per style id. Ids mirror `TERRAIN_STYLES` in @sengoku-jidai/shared;
 *  the terrain package owns which JSON each id loads. */
const STYLE_PROFILE_FILES: Record<string, string> = {
  antique: "map.json",
  ink: "ink.json"
};

/** Resolve a terrain style id to its committed, validated profile. Paths resolve via
 *  `import.meta.url` so this works from source (tests) and from the built server's dist. */
export function loadStyleProfile(styleId: string): MapProfile {
  const file = STYLE_PROFILE_FILES[styleId];
  if (!file) {
    throw new Error(
      `unknown terrain style "${styleId}" (known: ${Object.keys(STYLE_PROFILE_FILES).join(", ")})`
    );
  }
  return loadMapProfile(fileURLToPath(new URL(`../profiles/${file}`, import.meta.url)));
}
```

- [ ] **Step 4: Export it from `packages/terrain/src/index.ts`**

Change the profile export line to:

```ts
export { loadMapProfile, loadStyleProfile, type MapProfile } from "./mapProfile.js";
```

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/mapProfile.test.ts`
Expected: PASS (existing 2 + new 3).

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/mapProfile.ts packages/terrain/src/index.ts packages/terrain/test/mapProfile.test.ts
git commit -m "feat(terrain): loadStyleProfile(id) resolver (antique/ink)"
```

---

### Task 4: Route the server's default profile through `loadStyleProfile`

**Files:**
- Modify: `packages/server/src/maps/terrainService.ts:15-20` (`defaultProfile`)
- Test: `packages/server/test/` — extend the existing terrain-service test if one asserts profile wiring; otherwise add `packages/server/test/terrainDefaultProfile.test.ts`

**Interfaces:**
- Consumes: `loadStyleProfile` (Task 3) + `DEFAULT_TERRAIN_STYLE` (Task 1).
- Produces: no signature change — `TerrainService` still defaults to the antique profile when none is injected. (Per-request style selection is PR-A.)

- [ ] **Step 1: Rebuild the libs the server consumes as dist** (dist-consumption trap)

Run: `corepack pnpm --filter @sengoku-jidai/shared --filter @sengoku-jidai/terrain build`
Expected: both build clean.

- [ ] **Step 2: Write the failing test** (`packages/server/test/terrainDefaultProfile.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_STYLE } from "@sengoku-jidai/shared";
import { loadStyleProfile } from "@sengoku-jidai/terrain";

// The server's default terrain profile must be exactly the shared default style's profile,
// resolved through the terrain resolver (not a hand-built relative path).
describe("server default terrain profile", () => {
  it("uses the shared default style via loadStyleProfile", () => {
    const p = loadStyleProfile(DEFAULT_TERRAIN_STYLE);
    expect(DEFAULT_TERRAIN_STYLE).toBe("antique");
    expect(p.edit.styleRef).toBe("assets/texture-ref.jpeg");
  });
});
```

- [ ] **Step 3: Run to verify it fails** (until dist rebuilt / exports resolve)

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainDefaultProfile.test.ts`
Expected: PASS if Step 1's dist rebuild picked up the new exports; if it FAILs on a missing export, rebuild libs and re-run.

- [ ] **Step 4: Simplify `defaultProfile()` in `terrainService.ts`**

Replace the current imports + `defaultProfile`:

```ts
import { compileHexMap } from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { DEFAULT_TERRAIN_STYLE } from "@sengoku-jidai/shared";
import {
  createFalClient,
  generateTerrainWebp,
  loadStyleProfile,
  type EditDeps,
  type MapProfile
} from "@sengoku-jidai/terrain";
import type { MapLibrary } from "./library.js";
import type { TerrainStore } from "./terrainStore.js";

/** The default terrain profile: the shared default style, resolved by the terrain package
 *  (works from source and the built image without a hand-built relative path). */
function defaultProfile(): MapProfile {
  return loadStyleProfile(DEFAULT_TERRAIN_STYLE);
}
```

(Delete the now-unused `fileURLToPath` import and `loadMapProfile` import if they are no longer referenced elsewhere in the file — check with a grep before removing.)

- [ ] **Step 5: Run the server terrain tests**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainDefaultProfile.test.ts && corepack pnpm --filter @sengoku-jidai/server test`
Expected: PASS; existing terrain-service tests unaffected (profile is behavior-identical to the old `map.json`).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/maps/terrainService.ts packages/server/test/terrainDefaultProfile.test.ts
git commit -m "refactor(server): resolve default terrain profile via loadStyleProfile"
```

---

### Task 5: Catalog/resolver sync guard + full offline gate

**Files:**
- Test: `packages/server/test/terrainStyleSync.test.ts` (create) — the sync test lives in the server package because it's the only one that depends on **both** `@sengoku-jidai/shared` (for `TERRAIN_STYLES`) and `@sengoku-jidai/terrain` (for `loadStyleProfile`); terrain itself does not depend on shared.

**Interfaces:**
- Consumes: `TERRAIN_STYLES` (shared) + `loadStyleProfile` (terrain).
- Produces: a guard that every shared style id resolves to a real profile (catches a future style added to the catalog but not to the resolver, per [[cross-package-gotchas]] type-sync pairs).

- [ ] **Step 1: Write the sync test** (`packages/server/test/terrainStyleSync.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { TERRAIN_STYLES } from "@sengoku-jidai/shared";
import { loadStyleProfile } from "@sengoku-jidai/terrain";

// Every catalogued style must resolve to a committed, valid profile with a non-empty prompt.
describe("terrain style catalog ↔ resolver sync", () => {
  for (const style of TERRAIN_STYLES) {
    it(`resolves a profile for "${style.id}"`, () => {
      const p = loadStyleProfile(style.id);
      expect(p.edit.prompt.length).toBeGreaterThan(0);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/terrainStyleSync.test.ts`
Expected: PASS (antique + ink).

- [ ] **Step 3: Run the full gate**

```bash
corepack pnpm build && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm exec prettier --check .
```
Expected: all green. Fix prettier on any touched file (`corepack pnpm exec prettier --write <path>`), re-run.

- [ ] **Step 4: Commit**

```bash
git add packages/server/test/terrainStyleSync.test.ts
git commit -m "test(server): guard terrain style catalog stays in sync with the resolver"
```

---

### Task 6: Real validation generation (ink look) — GATED on Martin

> One real `gpt-image-1.5/edit` generation (~$0.17 high quality). **Pre-approved** in principle ([[multiple-terrains-initiative]]: "1 ink" gen), but credits are limited — **confirm with Martin before running.** This is validation, not a code change; no commit unless the prompt/swatch needs tuning.

**Uses the reusable terrain-validation recipe** ([[multiple-terrains-initiative]]): a throwaway vitest in `packages/terrain/test/` that fetches Small Testmap's `.source` from `http://127.0.0.1:18081/api/maps/fc5161b0-f889-41e6-ab32-9106276c86c7`, compiles it, builds the board SVG, and runs `generateTerrainWebp` with `loadStyleProfile("ink")` + a real fal client.

- [ ] **Step 1: Pull the live FAL_KEY**

```bash
CID=$(docker ps -q --filter name=sengoku | head -1); FAL_KEY=$(docker exec "$CID" printenv FAL_KEY); echo "${FAL_KEY:+key present}"
```

- [ ] **Step 2: Write a throwaway gen test** `packages/terrain/test/_inkgen.test.ts`

```ts
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { createFalClient, generateTerrainWebp, loadStyleProfile } from "../src/index.js";

it("ink gen", { timeout: 180_000 }, async () => {
  const res = await fetch(
    "http://127.0.0.1:18081/api/maps/fc5161b0-f889-41e6-ab32-9106276c86c7"
  );
  const source = (await res.json()).source;
  const compiled = compileHexMap(source);
  const svgMarkup = assembleBoardSvg(buildScene(compiled));
  const fal = createFalClient(process.env.FAL_KEY!);
  const webp = await generateTerrainWebp(
    { fal, fetch: globalThis.fetch },
    { svgMarkup, map: compiled.definition, profile: loadStyleProfile("ink") }
  );
  writeFileSync("/tmp/ink.webp", webp);
});
```

- [ ] **Step 3: Run it**

```bash
FAL_KEY="$FAL_KEY" corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/_inkgen.test.ts
```

- [ ] **Step 4: Eyeball on the board via the PR-D terrain-shot tool**

```bash
corepack pnpm --filter @sengoku-jidai/board-render exec tsx scripts/terrain-shot.ts \
  --map fc5161b0-f889-41e6-ab32-9106276c86c7 --terrain-url /tmp/ink.webp --out /tmp/ink.html
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs /tmp/ink.html /tmp/ink.png
```

Read `/tmp/ink.png`. Confirm: islands sit exactly on the board tiles (fidelity), white inked land / grey sea (mapping not swapped), crisp coastlines with concentric depth rings, delicate tree/mountain line-art. If land/sea is swapped or drifts, tune the ink prompt/swatch and re-run (counts against the credit budget — get Martin's OK for a second gen).

- [ ] **Step 5: Clean up**

```bash
rm packages/terrain/test/_inkgen.test.ts /tmp/ink.webp /tmp/ink.html /tmp/ink.png
```

---

### Task 7: Open PR, watch CI, hold for merge

- [ ] **Step 1:** Push the branch and open the PR (title `PR-2: ink (greyscale) terrain style`; body summarizes the catalog + resolver + ink profile, links the spec, notes the validation gen result, ends with the Claude Code line).
- [ ] **Step 2:** `gh pr checks <n> --watch`; fix any failures (prettier on touched files, determinism anchor, Docker context — the usual, per [[dev-workflow-prefs]]).
- [ ] **Step 3:** Report green + the eyeball PNG to Martin and **hold for his merge** (squash + delete branch). Then update [[multiple-terrains-initiative]]: PR-2 done, next is PR-A (backend many-terrains + `style_id`).

---

## Notes for the executor

- This PR intentionally does **not** thread `styleId` through the generate API or editor — that's PR-A (DB `style_id` column + `POST …/terrains {styleId}`) and PR-B (dropdown). PR-2 only lands the catalog, the ink profile, and the resolver; the running server keeps generating antique exactly as before.
- If `loadMapProfile` becomes unused in `terrainService.ts` after Task 4, drop its import; but it stays exported from the terrain package (the CLIs `mapControlCli.ts` / `mapPipelineCli.ts` still use it directly).
