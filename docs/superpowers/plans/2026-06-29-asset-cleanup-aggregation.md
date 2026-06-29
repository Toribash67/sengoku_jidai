# Asset Cleanup + Per-Map Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale/unused assets and the dead old-generation-pipeline code, and aggregate the remaining assets into one folder per map (source assets at repo root, runtime assets under the web package).

**Architecture:** Split-by-role aggregation. Source/tooling assets move to `assets/maps/<map>/`; runtime Vite-bundled assets move to `packages/web/src/assets/<map>/`. The abandoned Flux img2img pipeline (`gen`/`gen:base`/`gen:matrix`) and everything only it used are deleted; the current `gen:map`/`gen:map-control` edit pipeline stays.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspaces, Vite (web bundling + `import.meta.glob`), vitest, sharp.

## Global Constraints

- Use `git mv` for every asset move so history follows the file.
- ESM: relative imports use `.js` specifiers.
- Staging: `.pnpm-store`, `.claude`, `.superpowers` are untracked and NOT git-ignored — stage files individually by exact path; never `git add -A` / `git add .`.
- Per-task gate (all must pass before commit): `pnpm --filter @sengoku-jidai/terrain typecheck` + `test`, `pnpm --filter @sengoku-jidai/web typecheck` + `test`, `pnpm -w lint`, and prettier on touched files (`pnpm exec prettier --write <paths>`; CI runs `prettier --check .`). vitest does NOT typecheck, so typecheck is mandatory.
- Asset-move tasks ALSO run the web production build (`pnpm --filter @sengoku-jidai/web build`) — Vite resolving every moved import/glob is the real safety net; tests alone won't catch a broken asset path.
- `style-ref.jpeg` stays at `packages/terrain/assets/style-ref.jpeg` (global generation input, not a per-map asset).
- Terrain is a dev-only package; nothing in `web`/`engine`/`server` imports its modules (only docs/READMEs mention its CLIs).

---

### Task 1: Remove dead old-pipeline code, tests, and profiles

**Files:**
- Delete: `packages/terrain/src/cli.ts`, `controlCli.ts`, `matrixCli.ts`, `pipeline.ts`, `matrixBackend.ts`, `matrixProfile.ts`, `contactSheet.ts`, `styleProfile.ts`
- Delete: `packages/terrain/test/matrixBackend.test.ts`, `matrixProfile.test.ts`, `contactSheet.test.ts`, `styleProfile.test.ts`
- Delete: `packages/terrain/profiles/antique.json`, `packages/terrain/profiles/matrix.json`
- Delete: `terrain/rivers/base.png`, `terrain/rivers/generated.png` (stale committed outputs of the dead pipeline)
- Modify: `packages/terrain/src/backend.ts` (trim to the new-pipeline exports)
- Rewrite: `packages/terrain/test/backend.test.ts` (cover the kept `firstImageUrl`)
- Modify: `packages/terrain/package.json` (remove dead scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: a trimmed `backend.ts` exporting `firstImageUrl(data: unknown): string`, `interface FalClient`, `type FetchFn` (unchanged signatures). `createFalBackend` and `TerrainBackend` no longer exist.

- [ ] **Step 1: Trim `backend.ts`** — remove the `StyleProfile` import, the `TerrainBackend` interface, and the `createFalBackend` function. The file becomes exactly:

```ts
export interface FalClient {
  storage: { upload(blob: Blob): Promise<string> };
  subscribe(model: string, opts: { input: Record<string, unknown> }): Promise<{ data: unknown }>;
}

export type FetchFn = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Pull the first output image URL out of a fal result payload (`{ images: [{ url }] }`). */
export function firstImageUrl(data: unknown): string {
  const images = (data as { images?: Array<{ url?: string }> })?.images;
  const url = images?.[0]?.url;
  if (!url) {
    throw new Error(`fal result had no image url: ${JSON.stringify(data)}`);
  }
  return url;
}
```

- [ ] **Step 2: Rewrite `test/backend.test.ts`** to cover only the kept export:

```ts
import { describe, expect, it } from "vitest";
import { firstImageUrl } from "../src/backend.js";

describe("firstImageUrl", () => {
  it("returns the first image url from a fal result payload", () => {
    expect(firstImageUrl({ images: [{ url: "https://out/a.png" }, { url: "https://out/b.png" }] })).toBe(
      "https://out/a.png"
    );
  });

  it("throws when the payload has no image url", () => {
    expect(() => firstImageUrl({ images: [] })).toThrow(/no image url/i);
    expect(() => firstImageUrl({})).toThrow(/no image url/i);
  });
});
```

- [ ] **Step 3: Delete the dead files**

```bash
cd /mnt/ssd_pool/martin/repos/sengoku_jidai
git rm packages/terrain/src/cli.ts packages/terrain/src/controlCli.ts \
  packages/terrain/src/matrixCli.ts packages/terrain/src/pipeline.ts \
  packages/terrain/src/matrixBackend.ts packages/terrain/src/matrixProfile.ts \
  packages/terrain/src/contactSheet.ts packages/terrain/src/styleProfile.ts \
  packages/terrain/test/matrixBackend.test.ts packages/terrain/test/matrixProfile.test.ts \
  packages/terrain/test/contactSheet.test.ts packages/terrain/test/styleProfile.test.ts \
  packages/terrain/profiles/antique.json packages/terrain/profiles/matrix.json \
  terrain/rivers/base.png terrain/rivers/generated.png
```
(The now-empty `terrain/rivers/` directory disappears with its last tracked file.)

- [ ] **Step 4: Remove dead scripts from `packages/terrain/package.json`** — delete the `gen`, `gen:base`, and `gen:matrix` lines from `"scripts"`. The remaining scripts are `gen:map`, `gen:map-control`, `test`, `typecheck`.

- [ ] **Step 5: Run the gate**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck && pnpm --filter @sengoku-jidai/terrain test && pnpm -w lint`
Expected: typecheck clean; tests pass (the matrix/contactSheet/styleProfile suites are gone, `backend.test` now has the 2 `firstImageUrl` cases); lint clean. Then `pnpm exec prettier --write packages/terrain/src/backend.ts packages/terrain/test/backend.test.ts packages/terrain/package.json`.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/backend.ts packages/terrain/test/backend.test.ts packages/terrain/package.json
git commit -m "chore(terrain): remove dead old-pipeline code, tests, and profiles"
```

---

### Task 2: Move source assets to `assets/maps/rivers/` (board.svg + card scans)

**Files:**
- Move: `cloned_map.svg` → `assets/maps/rivers/board.svg`
- Move: `cards/rivers/*.png` (9) → `assets/maps/rivers/cards/`
- Modify: `packages/web/src/components/board/MapBoard.tsx:3`
- Modify: `packages/terrain/src/mapSources.ts` (`SVG_BY_MAP`)
- Modify: `packages/terrain/test/mapSources.test.ts` (board.svg assertion only)
- Modify: `packages/engine/src/maps/riversMap.ts` (comments)

**Interfaces:**
- Consumes: nothing.
- Produces: `mapSvgPath("rivers")` resolves to `<repo>/assets/maps/rivers/board.svg`.

- [ ] **Step 1: Move the files with git mv**

```bash
cd /mnt/ssd_pool/martin/repos/sengoku_jidai
mkdir -p assets/maps/rivers/cards
git mv cloned_map.svg assets/maps/rivers/board.svg
git mv cards/rivers/*.png assets/maps/rivers/cards/
```
(After this, the now-empty `cards/rivers/` and `cards/` directories disappear automatically since git tracks files, not dirs.)

- [ ] **Step 2: Update the web SVG import** in `packages/web/src/components/board/MapBoard.tsx` line 3:

```ts
import rawMapSvg from "../../../../../assets/maps/rivers/board.svg?raw";
```

- [ ] **Step 3: Update `SVG_BY_MAP`** in `packages/terrain/src/mapSources.ts`:

```ts
const SVG_BY_MAP: Record<string, string> = {
  rivers: "assets/maps/rivers/board.svg"
};
```

- [ ] **Step 4: Update the `mapSvgPath` test assertion** in `packages/terrain/test/mapSources.test.ts` (leave the `mapControlPath` block untouched — Task 4 removes it):

```ts
    expect(path.endsWith("assets/maps/rivers/board.svg")).toBe(true);
```

- [ ] **Step 5: Update engine comments** in `packages/engine/src/maps/riversMap.ts` — replace each `cloned_map.svg` with `board.svg` (3 occurrences: the file header comment, the adjacency comment, and the bonus-slots comment). These are comments only; no code changes.

- [ ] **Step 6: Run the gate (incl. web build)**

Run:
```bash
pnpm --filter @sengoku-jidai/terrain typecheck && pnpm --filter @sengoku-jidai/terrain test \
 && pnpm --filter @sengoku-jidai/web typecheck && pnpm --filter @sengoku-jidai/web test \
 && pnpm --filter @sengoku-jidai/web build && pnpm -w lint
```
Expected: all green. `mapSources.test` `existsSync(path)` confirms `board.svg` is at the new path; the web build confirms the `?raw` SVG import resolves. Then `pnpm exec prettier --write packages/web/src/components/board/MapBoard.tsx packages/terrain/src/mapSources.ts packages/terrain/test/mapSources.test.ts packages/engine/src/maps/riversMap.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/terrain/src/mapSources.ts \
  packages/terrain/test/mapSources.test.ts packages/engine/src/maps/riversMap.ts
git commit -m "refactor(assets): move board svg + card scans to assets/maps/rivers/, rename board.svg"
```

---

### Task 3: Move runtime webp under `packages/web/src/assets/rivers/` + update Vite imports/glob

**Files:**
- Move: `packages/web/src/assets/cards/*.webp` (9) → `packages/web/src/assets/rivers/cards/`
- Move: `packages/web/src/assets/terrain/rivers.webp` → `packages/web/src/assets/rivers/background.webp`
- Modify: `packages/web/src/components/board/cardImages.ts` (imports + comment)
- Modify: `packages/web/src/components/board/terrainImages.ts` (glob + lookup)
- Modify: `packages/web/test/board/terrainImages.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `terrainImage("rivers")` resolves the background URL from `assets/rivers/background.webp`; card imports resolve from `assets/rivers/cards/`.

- [ ] **Step 1: Move the files with git mv**

```bash
cd /mnt/ssd_pool/martin/repos/sengoku_jidai
mkdir -p packages/web/src/assets/rivers/cards
git mv packages/web/src/assets/cards/*.webp packages/web/src/assets/rivers/cards/
git mv packages/web/src/assets/terrain/rivers.webp packages/web/src/assets/rivers/background.webp
```

- [ ] **Step 2: Update the failing test first** — `packages/web/test/board/terrainImages.test.ts`. The glob now keys on `…/<mapId>/background.webp`:

```ts
import { describe, expect, it } from "vitest";
import { resolveTerrain } from "../../src/components/board/terrainImages.js";

const modules = {
  "/src/assets/rivers/background.webp": "/assets/rivers.hash.webp"
};

describe("resolveTerrain", () => {
  it("returns the asset url for a map that has terrain", () => {
    expect(resolveTerrain(modules, "rivers")).toBe("/assets/rivers.hash.webp");
  });

  it("returns null for a map with no committed terrain", () => {
    expect(resolveTerrain(modules, "mountains")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/web test terrainImages`
Expected: FAIL — current `resolveTerrain` matches suffix `/rivers.webp`, not `/rivers/background.webp`.

- [ ] **Step 4: Update `terrainImages.ts`** — glob the per-map background and key on the parent directory name:

```ts
/**
 * Committed terrain background assets, keyed by map id. Each map's background lives at
 * `assets/<mapId>/background.webp`; discovered via Vite's glob so a map without a generated
 * asset is simply absent (graceful fallback to flat tile fills).
 */
const TERRAIN_MODULES = import.meta.glob("../../assets/*/background.webp", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

/** Pure lookup: find the terrain URL whose path is `…/<mapId>/background.webp`, else null. */
export function resolveTerrain(modules: Record<string, string>, mapId: string): string | null {
  const suffix = `/${mapId}/background.webp`;
  for (const [path, url] of Object.entries(modules)) {
    if (path.endsWith(suffix)) {
      return url;
    }
  }
  return null;
}

/** Terrain background URL for a map id, or null if no asset is committed. */
export function terrainImage(mapId: string): string | null {
  return resolveTerrain(TERRAIN_MODULES, mapId);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/web test terrainImages`
Expected: PASS (2 tests).

- [ ] **Step 6: Update card imports** in `packages/web/src/components/board/cardImages.ts` — change all 9 import paths from `../../assets/cards/<name>.webp` to `../../assets/rivers/cards/<name>.webp`:

```ts
import ambush from "../../assets/rivers/cards/ambush.webp";
import commandeer from "../../assets/rivers/cards/commandeer.webp";
import counterattack from "../../assets/rivers/cards/counterattack.webp";
import groundAssault from "../../assets/rivers/cards/ground_assault.webp";
import mobilise from "../../assets/rivers/cards/mobilise.webp";
import riverAssault from "../../assets/rivers/cards/river_assault.webp";
import shipStrike from "../../assets/rivers/cards/ship_strike.webp";
import shoreStrike from "../../assets/rivers/cards/shore_strike.webp";
import cardBackUrl from "../../assets/rivers/cards/rivers_back.webp";
```

- [ ] **Step 7: Update the regenerate-command comment** in `cardImages.ts` (the JSDoc block above the imports) to the new source/output paths:

```ts
/**
 * Card-face artwork URL by card id. These are web-sized WebP copies (1000px wide, ≈0.5MB) of
 * the full-resolution scans in `assets/maps/rivers/cards/` — regenerate the fronts with:
 *   pnpm dlx sharp-cli --input "assets/maps/rivers/cards/*.png" \
 *     --output packages/web/src/assets/rivers/cards --format webp resize 1000
 * The back scan is landscape, so rotate it upright first (two passes — rotate then resize):
 *   pnpm dlx sharp-cli --input assets/maps/rivers/cards/rivers_back.png --output <tmp> --format png rotate 270
 *   pnpm dlx sharp-cli --input <tmp>/rivers_back.png \
 *     --output packages/web/src/assets/rivers/cards --format webp resize 1000
 * Vite emits each to dist and the browser fetches it only when the <img> renders.
 */
```

- [ ] **Step 8: Add the scratch output dir to `.gitignore`** — append after the `source-material/` block:

```
# Terrain generation scratch output (gen:map / gen:map-control default dir)
/terrain/
```

- [ ] **Step 9: Run the gate (incl. web build)**

Run:
```bash
pnpm --filter @sengoku-jidai/web typecheck && pnpm --filter @sengoku-jidai/web test \
 && pnpm --filter @sengoku-jidai/web build && pnpm -w lint
```
Expected: all green. The build is critical here — it confirms Vite resolves all 9 card imports and the `import.meta.glob` finds `assets/rivers/background.webp`. Then `pnpm exec prettier --write packages/web/src/components/board/cardImages.ts packages/web/src/components/board/terrainImages.ts packages/web/test/board/terrainImages.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/components/board/cardImages.ts packages/web/src/components/board/terrainImages.ts \
  packages/web/test/board/terrainImages.test.ts .gitignore
git commit -m "refactor(assets): aggregate web runtime webp under assets/rivers/, ignore /terrain/ scratch"
```

---

### Task 4: Remove committed control image, drop `mapControlPath`, repoint `gen:map-control`

**Files:**
- Delete: `packages/terrain/assets/controls/rivers-control.png`
- Modify: `packages/terrain/src/mapSources.ts` (remove `mapControlPath`)
- Modify: `packages/terrain/src/mapControlCli.ts` (write to scratch dir)
- Modify: `packages/terrain/test/mapSources.test.ts` (remove `mapControlPath` block)

**Interfaces:**
- Consumes: `mapSvgPath` (unchanged).
- Produces: `gen:map-control` writes the preview control to `<TERRAIN_OUT_DIR>/<mapId>/control.png` (or repo-local `terrain/<mapId>/control.png` when `TERRAIN_OUT_DIR` is unset). `mapControlPath` no longer exists.

- [ ] **Step 1: Delete the committed control image**

```bash
cd /mnt/ssd_pool/martin/repos/sengoku_jidai
git rm packages/terrain/assets/controls/rivers-control.png
```
(The now-empty `packages/terrain/assets/controls/` directory disappears with its last tracked file.)

- [ ] **Step 2: Remove `mapControlPath`** from `packages/terrain/src/mapSources.ts` — delete the entire `mapControlPath` function and its doc comment. Keep `mapSvgPath`, `repoRoot`, `SVG_BY_MAP`. After this `fileURLToPath` is still used by `repoRoot`, so keep its import.

- [ ] **Step 3: Repoint `mapControlCli.ts`** — remove the `mapControlPath` import and write to the scratch output dir using the same pattern as `mapPipelineCli.ts`. Replace the import line:

```ts
import { mapSvgPath } from "./mapSources.js";
```

Add `join` to the existing `node:path` import (it currently imports `dirname`):

```ts
import { dirname, join } from "node:path";
```

Replace the output block (the `const outPath = mapControlPath(mapId)` lines through the final `console.log`):

```ts
  const baseOut =
    process.env.TERRAIN_OUT_DIR ??
    fileURLToPath(new URL(`../../../terrain/${mapId}`, import.meta.url));
  const outDir = process.env.TERRAIN_OUT_DIR ? join(baseOut, mapId) : baseOut;
  const outPath = join(outDir, "control.png");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, control);
  console.log(`[terrain] control written: ${outPath}`);
```

Also update the function's doc comment (it currently says "write it to a committed asset"): change to describe a fal-free preview written to the scratch output dir for inspecting/tuning the control (e.g. with `--amplitude`).

- [ ] **Step 4: Remove the `mapControlPath` test** in `packages/terrain/test/mapSources.test.ts` — delete the entire `describe("mapControlPath", …)` block and drop `mapControlPath` from the import so only `mapSvgPath` is imported:

```ts
import { mapSvgPath } from "../src/mapSources.js";
```
(`existsSync` is still used by the `mapSvgPath` test — keep its import.)

- [ ] **Step 5: Run the gate**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck && pnpm --filter @sengoku-jidai/terrain test && pnpm -w lint`
Expected: all green.

- [ ] **Step 6: Smoke-test `gen:map-control`** writes to scratch, not a committed path:

```bash
pnpm --filter @sengoku-jidai/terrain gen:map-control rivers
git status --short
```
Expected: log `control written: …/terrain/rivers/control.png`; `git status --short` shows NO new tracked changes (the `terrain/` output is git-ignored from Task 3). Then `pnpm exec prettier --write packages/terrain/src/mapSources.ts packages/terrain/src/mapControlCli.ts packages/terrain/test/mapSources.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/terrain/src/mapSources.ts packages/terrain/src/mapControlCli.ts packages/terrain/test/mapSources.test.ts
git commit -m "refactor(terrain): drop committed control image; gen:map-control writes to scratch dir"
```

---

### Task 5: Rewrite docs to the current pipeline

**Files:**
- Modify: `README.md` (terrain section)
- Rewrite: `packages/terrain/README.md`
- Rewrite: `packages/terrain/profiles/README.md`

**Interfaces:**
- Consumes: the final state of Tasks 1–4 (scripts, paths, profile).
- Produces: docs with no references to removed scripts/profiles/paths.

- [ ] **Step 1: Replace the root README terrain section** — in `README.md`, replace the block from the "Preview the colour base" heading through the end of the terrain generation prose (the `### Preview the colour base …` and `### Generate a terrain background …` subsections, currently ~lines 99–131) with:

```markdown
### Preview the land/sea control (no API key, no cost)

The control is the green-land / blue-sea image (with organic, domain-warped coastlines)
that conditions generation. Render it on its own to tune the coastline:

```bash
corepack pnpm build:libs
corepack pnpm --filter @sengoku-jidai/terrain gen:map-control rivers
# sweep the coastline distortion without editing the profile:
corepack pnpm --filter @sengoku-jidai/terrain gen:map-control rivers --amplitude 60
```

This writes `terrain/rivers/control.png` (git-ignored scratch) — handy to sanity-check a
map's land/sea layout before spending a generation.

### Generate a terrain background (full pipeline)

This calls the hosted **fal.ai** edit model, so it needs an API key:

```bash
export FAL_KEY=...   # or put it in the git-ignored .env (see .env.example)
corepack pnpm build:libs
corepack pnpm --filter @sengoku-jidai/terrain gen:map rivers
```

It builds the control from the board SVG, sends it with the shared style reference
(`packages/terrain/assets/style-ref.jpeg`) to the edit model, and writes intermediates plus
`background.webp` to the scratch dir. Promote the result by copying it to
`packages/web/src/assets/<mapId>/background.webp` and committing it — the web board picks it
up automatically (Vite globs `src/assets/*/background.webp`).

The art style is controlled by one shared profile
([`packages/terrain/profiles/map.json`](packages/terrain/profiles/map.json)), so every map
looks consistent; adding a future map needs an `SVG_BY_MAP` entry and a generation run.
```

Also fix the intro prose just above (currently mentions "Flux" / "image-to-image"): change the sentence describing the model to reference the multi-image **edit** model (control + style reference → restyled map) rather than Flux img2img. Leave the surrounding paragraphs intact.

- [ ] **Step 2: Rewrite `packages/terrain/README.md`** to describe the current pipeline. Replace the whole file with:

```markdown
# @sengoku-jidai/terrain

A **dev-only** offline pipeline that generates antique-style terrain background images for
the game board. It runs outside the app and CI: the generated image is committed as a static
asset, so the running app never calls an image API. Until an asset is committed, the board
renders with flat tile fills.

## How it works

1. Render a flat land/sea **control** image from the board SVG (`assets/maps/<map>/board.svg`):
   green = land, blue = sea, with the hex coastline domain-warped into organic shores.
2. Send the control plus a shared **style reference**
   (`assets/style-ref.jpeg`) to a multi-image instruction-**edit** model (fal.ai
   `nano-banana-pro/edit`), which redraws the control's land/sea layout in the reference's
   hand-drawn style.
3. Convert to `background.webp` at the board's aspect ratio.

Everything that controls the look lives in one shared profile,
[`profiles/map.json`](profiles/map.json) — see [`profiles/README.md`](profiles/README.md).

## Commands

```bash
# Preview only the land/sea control (no API key, no cost). Writes terrain/<map>/control.png.
pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId> [--amplitude <px>]

# Full pipeline (needs FAL_KEY). Writes the control, intermediates, and background.webp.
pnpm --filter @sengoku-jidai/terrain gen:map <mapId>
```

`--amplitude <px>` overrides the profile's coastline-warp amplitude (max pixel displacement;
0 disables) so you can sweep distortion cheaply with the fal-free control render.

## Output location

Both commands write to `TERRAIN_OUT_DIR/<mapId>/` if `TERRAIN_OUT_DIR` is set, otherwise the
git-ignored repo-local `terrain/<mapId>/`. To ship a generated background, copy
`background.webp` to `packages/web/src/assets/<mapId>/background.webp` and commit it.

## Adding a map

1. Add the board SVG at `assets/maps/<mapId>/board.svg`.
2. Add an `SVG_BY_MAP` entry in `src/mapSources.ts`.
3. Run `gen:map <mapId>` and promote the resulting `background.webp`.
```

- [ ] **Step 3: Rewrite `packages/terrain/profiles/README.md`** to document only the current `map.json` profile. Replace the whole file with:

```markdown
# Map profile

[`map.json`](map.json) is the single shared profile for terrain generation. One style is
applied to every map so backgrounds look like siblings.

## `base` — the land/sea control

- `landColor` / `seaColor`: fills painted into the control for land vs. sea (bold green/blue
  read most reliably to the edit model; they never appear in the final map).
- `outputSize.width`: control render width; height is derived from the board viewBox.
- `organicSigma`: blur that softens the hex facets of the land mask.
- `coastWarp`: domain-warps the coastline through a smooth noise field.
  - `amplitude`: max displacement in pixels (kept low so the background hugs the tile
    layout; `gen:map-control --amplitude` overrides it; 0 disables).
  - `scale`: noise base frequency (smaller = larger bays).
  - `seed`: noise seed.

## `edit` — the style pass

- `model`: the fal.ai multi-image edit endpoint (default `fal-ai/nano-banana-pro/edit`).
- `styleRef`: path (relative to the package root) to the style reference image.
- `resolution`: `1K` / `2K` / `4K`.
- `seed`: locked seed for reproducibility.
- `prompt`: instructions mapping green→land and blue→sea in the reference's style.

## `webpQuality`

Final webp quality (1–100).
```

- [ ] **Step 4: Verify and format**

Run: `git grep -nE "gen:base|gen:matrix|antique\.json|matrix\.json|cloned_map|createFalBackend|styleProfile|assets/controls|assets/terrain/rivers|cards/rivers|mapControlPath" -- ':!docs/superpowers'`
Expected: NO matches (only the spec/plan under `docs/superpowers/` may still reference old names historically). Then `pnpm exec prettier --write README.md packages/terrain/README.md packages/terrain/profiles/README.md` and `pnpm -w lint`.

- [ ] **Step 5: Commit**

```bash
git add README.md packages/terrain/README.md packages/terrain/profiles/README.md
git commit -m "docs(terrain): rewrite docs for the current gen:map edit pipeline"
```

---

### Task 6: Final whole-tree verification

**Files:** none (verification only).

- [ ] **Step 1: Full repo gate**

Run:
```bash
pnpm --filter @sengoku-jidai/terrain typecheck && pnpm --filter @sengoku-jidai/terrain test \
 && pnpm --filter @sengoku-jidai/web typecheck && pnpm --filter @sengoku-jidai/web test \
 && pnpm --filter @sengoku-jidai/web build && pnpm -w lint
```
Expected: all green; the web build emits hashed assets for the moved card webp and `background.webp`.

- [ ] **Step 2: Prettier check (as CI runs it)**

Run: `pnpm exec prettier --check .`
Expected: "All matched files use Prettier code style!" (ignore `.pnpm-store` noise if present).

- [ ] **Step 3: Confirm no orphan references and a clean tree**

Run:
```bash
git grep -nE "cloned_map|assets/cards/|assets/terrain/|assets/controls|cards/rivers|gen:base|gen:matrix|antique\.json|matrix\.json|mapControlPath|createFalBackend|styleProfile" -- ':!docs/superpowers'
git status --short | grep -v '^?? \.'
```
Expected: first command prints nothing; second prints nothing (all changes committed; `terrain/` scratch ignored).

- [ ] **Step 4: Confirm the final asset tree**

Run: `git ls-files | grep -iE '\.(png|webp|jpe?g|svg)$' | grep -v node_modules`
Expected exactly:
```
assets/maps/rivers/board.svg
assets/maps/rivers/cards/ambush.png
assets/maps/rivers/cards/commandeer.png
assets/maps/rivers/cards/counterattack.png
assets/maps/rivers/cards/ground_assault.png
assets/maps/rivers/cards/mobilise.png
assets/maps/rivers/cards/river_assault.png
assets/maps/rivers/cards/rivers_back.png
assets/maps/rivers/cards/ship_strike.png
assets/maps/rivers/cards/shore_strike.png
packages/terrain/assets/style-ref.jpeg
packages/web/src/assets/rivers/background.webp
packages/web/src/assets/rivers/cards/ambush.webp
packages/web/src/assets/rivers/cards/commandeer.webp
packages/web/src/assets/rivers/cards/counterattack.webp
packages/web/src/assets/rivers/cards/ground_assault.webp
packages/web/src/assets/rivers/cards/mobilise.webp
packages/web/src/assets/rivers/cards/river_assault.webp
packages/web/src/assets/rivers/cards/rivers_back.webp
packages/web/src/assets/rivers/cards/ship_strike.webp
packages/web/src/assets/rivers/cards/shore_strike.webp
```
(No `terrain/rivers/*.png`, no `assets/controls/`, no root `cards/` or `cloned_map.svg`.)
