# Terrain Fort Drawings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a Sengoku-era Japanese castle into the generated terrain background at every tile carrying a fort, via a second gpt-image edit pass that runs only when a map has forts.

**Architecture:** After the base terrain webp is generated (unchanged), derive fort tile positions deterministically from the board `BoardScene`, overlay a bright signal-color marker at each on the base terrain, and run a second `editMapPass` (input_fidelity high) that draws a castle at each marker and removes the marker. Maps without forts skip the second pass entirely — byte-identical to today, no extra fal cost.

**Tech Stack:** TypeScript, `sharp` (raster compositing), `jsdom` (already used for SVG prep), `zod` (profile schema), `vitest`. gpt-image via the injected `EditDeps` fal client. Board geometry from `@sengoku-jidai/board-render` (`buildScene`, `BoardScene`).

## Global Constraints

- Package manager is `corepack pnpm`; run package scripts with `--filter @sengoku-jidai/terrain`.
- The `terrain` package is ESM; imports use explicit `.js` extensions (e.g. `./fortMarkers.js`).
- `EditDeps` (fal client + fetch) is always injected so tests run offline — never call fal directly.
- Marker signal color default is `#ff00ff` (magenta); it must be absent from terrain palettes.
- Fort is land-only and already exists in the data model (`SceneTile.features.fort: boolean`); no engine/state changes.
- Do NOT touch board-render's on-board fort border — it is already shipped.
- The pipeline stays filesystem-free in its core (`generateTerrainWebp`); only the packaged style ref is read.
- Cross-package dist trap: after editing `terrain` src, rebuild it (`corepack pnpm --filter @sengoku-jidai/terrain build`) before typechecking the `server` package, which consumes terrain's dist.

---

### Task 1: `fortMarkers.ts` — fort positions from the scene

**Files:**
- Create: `packages/terrain/src/fortMarkers.ts`
- Test: `packages/terrain/test/fortMarkers.test.ts`

**Interfaces:**
- Consumes: `BoardScene` from `@sengoku-jidai/board-render` — fields used: `viewBox: {x,y,width,height}`, `hexSize: number`, `tiles: { centroid: {x,y}, features: { fort: boolean } }[]`.
- Produces:
  - `export interface FortMarker { x: number; y: number; radius: number }`
  - `export function fortMarkers(scene: BoardScene, outputWidth: number, markerRadiusFactor: number): FortMarker[]`
  - Positions are in **output-image pixels**: `scale = outputWidth / scene.viewBox.width`; `x = (centroid.x - viewBox.x) * scale`; `y = (centroid.y - viewBox.y) * scale`; `radius = hexSize * markerRadiusFactor * scale`. Only tiles with `features.fort === true` are included.

- [ ] **Step 1: Write the failing test**

```ts
// packages/terrain/test/fortMarkers.test.ts
import { compileHexMap } from "@sengoku-jidai/engine";
import { buildScene } from "@sengoku-jidai/board-render";
import { describe, expect, it } from "vitest";
import { fortMarkers } from "../src/fortMarkers.js";

const SOURCE = {
  id: "m",
  name: "Fort Marker Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { fort: true } },
    { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} },
    { id: "t3", kind: "sea", hexes: [{ q: 2, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 4
};

describe("fortMarkers", () => {
  it("returns one marker per fort tile, scaled into output pixels", () => {
    const scene = buildScene(compileHexMap(SOURCE as never));
    const outputWidth = scene.viewBox.width * 2; // scale = 2
    const markers = fortMarkers(scene, outputWidth, 0.5);

    expect(markers).toHaveLength(1);
    const fortTile = scene.tiles.find((t) => t.features.fort)!;
    expect(markers[0].x).toBeCloseTo((fortTile.centroid.x - scene.viewBox.x) * 2, 5);
    expect(markers[0].y).toBeCloseTo((fortTile.centroid.y - scene.viewBox.y) * 2, 5);
    expect(markers[0].radius).toBeCloseTo(scene.hexSize * 0.5 * 2, 5);
  });

  it("returns an empty array when no tile has a fort", () => {
    const noFort = { ...SOURCE, tiles: SOURCE.tiles.map((t) => ({ ...t, features: {} })) };
    const scene = buildScene(compileHexMap(noFort as never));
    expect(fortMarkers(scene, 1024, 0.5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/fortMarkers.test.ts`
Expected: FAIL — `fortMarkers` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/terrain/src/fortMarkers.ts
import type { BoardScene } from "@sengoku-jidai/board-render";

/** A fort marker to overlay on the base terrain, in output-image pixel coordinates. */
export interface FortMarker {
  x: number;
  y: number;
  radius: number;
}

/**
 * Derive one marker per fort tile from the board scene, scaled from viewBox coordinates into
 * the terrain's output pixels. Scale is uniform (the output height preserves the viewBox
 * aspect), so `outputWidth / viewBox.width` maps both axes. `markerRadiusFactor` sizes the
 * marker relative to the flat-top hex radius.
 */
export function fortMarkers(
  scene: BoardScene,
  outputWidth: number,
  markerRadiusFactor: number
): FortMarker[] {
  const scale = outputWidth / scene.viewBox.width;
  const markers: FortMarker[] = [];
  for (const tile of scene.tiles) {
    if (tile.features.fort !== true) continue;
    markers.push({
      x: (tile.centroid.x - scene.viewBox.x) * scale,
      y: (tile.centroid.y - scene.viewBox.y) * scale,
      radius: scene.hexSize * markerRadiusFactor * scale
    });
  }
  return markers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/fortMarkers.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/fortMarkers.ts packages/terrain/test/fortMarkers.test.ts
git commit -m "feat(terrain): derive fort marker positions from the board scene"
```

---

### Task 2: `fortMarkerOverlay.ts` — composite markers onto the base terrain

**Files:**
- Create: `packages/terrain/src/fortMarkerOverlay.ts`
- Test: `packages/terrain/test/fortMarkerOverlay.test.ts`

**Interfaces:**
- Consumes: `FortMarker` from `./fortMarkers.js`.
- Produces:
  - `export async function fortMarkerOverlay(args: { base: Buffer; width: number; height: number; markers: FortMarker[]; color: string }): Promise<Buffer>`
  - Returns a PNG (`width`×`height`) = the `base` image with a filled disc of `color` drawn at each marker. This becomes the control image for the second edit pass.

- [ ] **Step 1: Write the failing test**

```ts
// packages/terrain/test/fortMarkerOverlay.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fortMarkerOverlay } from "../src/fortMarkerOverlay.js";

async function whiteBase(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: "#ffffff" }
  })
    .png()
    .toBuffer();
}

describe("fortMarkerOverlay", () => {
  it("draws the marker color at the marker center and leaves far pixels untouched", async () => {
    const W = 40;
    const H = 40;
    const out = await fortMarkerOverlay({
      base: await whiteBase(W, H),
      width: W,
      height: H,
      markers: [{ x: 20, y: 20, radius: 6 }],
      color: "#ff00ff"
    });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Center is magenta (marker disc).
    expect(at(20, 20)).toEqual([255, 0, 255]);
    // Far corner is still white (untouched).
    expect(at(1, 1)).toEqual([255, 255, 255]);
  });

  it("returns the base unchanged when there are no markers", async () => {
    const W = 16;
    const H = 16;
    const base = await whiteBase(W, H);
    const out = await fortMarkerOverlay({ base, width: W, height: H, markers: [], color: "#ff00ff" });
    const a = await sharp(out).raw().toBuffer();
    const b = await sharp(base).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
    expect(Buffer.compare(a, b)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/fortMarkerOverlay.test.ts`
Expected: FAIL — `fortMarkerOverlay` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/terrain/src/fortMarkerOverlay.ts
import sharp from "sharp";
import type { FortMarker } from "./fortMarkers.js";

/**
 * Overlay a filled disc of `color` at each fort marker on the base terrain, returning a
 * `width`×`height` PNG. The disc is a bright signal color absent from terrain palettes so the
 * second edit pass can unambiguously locate each fort. With no markers the base is returned
 * unchanged (resized to width×height, RGB).
 */
export async function fortMarkerOverlay(args: {
  base: Buffer;
  width: number;
  height: number;
  markers: FortMarker[];
  color: string;
}): Promise<Buffer> {
  const { base, width, height, markers, color } = args;
  const canvas = sharp(base).resize(width, height, { fit: "fill" }).removeAlpha();
  if (markers.length === 0) {
    return canvas.png().toBuffer();
  }
  const circles = markers
    .map((m) => `<circle cx="${m.x}" cy="${m.y}" r="${m.radius}" fill="${color}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`;
  return canvas
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/fortMarkerOverlay.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/fortMarkerOverlay.ts packages/terrain/test/fortMarkerOverlay.test.ts
git commit -m "feat(terrain): composite fort markers onto the base terrain"
```

---

### Task 3: `fortPass` profile config

**Files:**
- Modify: `packages/terrain/src/mapProfile.ts` (add `fortPass` to `MapProfileSchema`, before `webpQuality`)
- Test: `packages/terrain/test/mapProfile.test.ts` (add a fort-pass defaults test)

**Interfaces:**
- Produces: `MapProfile["fortPass"]` = `{ prompt: string; markerRadiusFactor: number; markerColor: string }`, always present after parse (whole block defaults when absent). Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Add to `packages/terrain/test/mapProfile.test.ts` (create the file with this content if it does not already exist; otherwise append the `describe` block):

```ts
import { describe, expect, it } from "vitest";
import { loadStyleProfile } from "../src/mapProfile.js";

describe("fortPass profile defaults", () => {
  it("fills fortPass defaults when the profile omits the block", () => {
    const profile = loadStyleProfile("antique"); // profiles/map.json has no fortPass block
    expect(profile.fortPass.markerColor).toBe("#ff00ff");
    expect(profile.fortPass.markerRadiusFactor).toBeCloseTo(0.45, 5);
    expect(profile.fortPass.prompt.toLowerCase()).toContain("castle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/mapProfile.test.ts`
Expected: FAIL — `profile.fortPass` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `packages/terrain/src/mapProfile.ts`, add this block to `MapProfileSchema` immediately before the `webpQuality` line:

```ts
  /** Second edit pass that draws a fort (Sengoku-era Japanese castle) at each fort tile. A
   *  bright signal-colour marker is overlaid at each fort's centroid on the finished terrain,
   *  then the edit model draws a castle at each marker and removes the marker. Skipped entirely
   *  for maps with no forts. Whole block defaults when omitted. */
  fortPass: z
    .object({
      prompt: z
        .string()
        .default(
          "Each bright magenta circle in this image marks the location of a fortress. At the exact centre of every magenta circle, draw one small Sengoku-era Japanese castle (a tenshukaku keep with white plaster walls and stacked tiered blue-grey tiled roofs) rendered in the SAME hand-drawn style, linework and colour palette as the rest of this map, sized to sit inside the circle without overflowing it. Then COMPLETELY REMOVE every magenta circle, blending its area back into the surrounding terrain. Leave every other part of the image — coastlines, land texture, sea, and colours — unchanged."
        ),
      markerRadiusFactor: z.number().positive().default(0.45),
      markerColor: z.string().default("#ff00ff")
    })
    .default({}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/mapProfile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/mapProfile.ts packages/terrain/test/mapProfile.test.ts
git commit -m "feat(terrain): add fortPass profile config with Japanese-castle default prompt"
```

---

### Task 4: Second edit pass in `generateTerrainWebp`

**Files:**
- Modify: `packages/terrain/src/mapPipeline.ts`
- Test: `packages/terrain/test/generateTerrainWebp.test.ts` (add fort-pass cases; existing test stays green)

**Interfaces:**
- Consumes: `fortMarkers` (Task 1), `fortMarkerOverlay` (Task 2), `MapProfile.fortPass` (Task 3), `BoardScene` (`@sengoku-jidai/board-render`), existing `editMapPass`, `planGptImageAspect`, `toWebp`.
- Produces: `generateTerrainWebp(deps, args)` where `args` gains an **optional** `scene?: BoardScene`. When `scene` is present and has ≥1 fort tile, a second edit pass runs; otherwise behavior is unchanged. Extracts a private `padEditCrop(...)` helper returning a `width`×`height` PNG so both passes share identical letterbox/crop geometry.

- [ ] **Step 1: Write the failing test**

Add to `packages/terrain/test/generateTerrainWebp.test.ts`. Reuse the existing `PROFILE` and `fakeDeps()` in that file. Add a fort source and two cases inside the existing `describe("generateTerrainWebp", ...)` block:

```ts
// Add near the top-level SOURCE constant:
const FORT_SOURCE = {
  id: "mf",
  name: "Fort Gen Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { fort: true } },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 3
};

// Add these two it() blocks inside describe("generateTerrainWebp", ...):
it("runs a second edit pass when the scene has a fort", async () => {
  const compiled = compileHexMap(FORT_SOURCE as never);
  const scene = buildScene(compiled);
  const svgMarkup = assembleBoardSvg(scene);
  const deps = fakeDeps();
  const out = await generateTerrainWebp(deps, {
    svgMarkup,
    map: compiled.definition,
    profile: PROFILE,
    scene
  });
  expect(out.subarray(0, 4).toString("ascii")).toBe("RIFF");
  // Pass 1 (control + style) + pass 2 (marker control only) = 2 model calls, 3 uploads.
  expect(deps.fal.subscribe).toHaveBeenCalledTimes(2);
  expect(deps.fal.storage.upload).toHaveBeenCalledTimes(3);
});

it("skips the second pass when the scene has no fort", async () => {
  const compiled = compileHexMap(SOURCE as never);
  const scene = buildScene(compiled);
  const svgMarkup = assembleBoardSvg(scene);
  const deps = fakeDeps();
  await generateTerrainWebp(deps, {
    svgMarkup,
    map: compiled.definition,
    profile: PROFILE,
    scene
  });
  expect(deps.fal.subscribe).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/generateTerrainWebp.test.ts`
Expected: FAIL — "second edit pass" test sees only 1 `subscribe` call (fort pass not implemented).

- [ ] **Step 3: Write minimal implementation**

Rewrite `generateTerrainWebp` in `packages/terrain/src/mapPipeline.ts` to extract a `padEditCrop` helper and add the conditional second pass. Replace the current body (imports at top of file gain the four new imports):

```ts
// add to the imports at the top of mapPipeline.ts:
import type { BoardScene } from "@sengoku-jidai/board-render";
import { fortMarkers } from "./fortMarkers.js";
import { fortMarkerOverlay } from "./fortMarkerOverlay.js";

/**
 * Pad a width×height control PNG into the fixed gpt-image size, run one edit pass, and crop
 * back to a width×height PNG. Shared by the base terrain pass and the fort pass so both use
 * identical letterbox geometry. `styleImage` is the optional aesthetic reference (null for the
 * fort pass, which restyles from the already-styled base image via the prompt).
 */
async function padEditCrop(
  deps: EditDeps,
  args: {
    control: Buffer;
    styleImage: Buffer | null;
    width: number;
    height: number;
    prompt: string;
    edit: MapProfile["edit"];
  }
): Promise<Buffer> {
  const { control, styleImage, width, height, prompt, edit } = args;
  const plan = planGptImageAspect(width, height);
  const paddedControl = await sharp(control)
    .resize(plan.contentW, plan.contentH, { fit: "fill" })
    .extend({
      top: plan.padTop,
      bottom: plan.padBottom,
      left: plan.padLeft,
      right: plan.padRight,
      background: "#1565c0" // sea-blue letterbox; cropped off after
    })
    .png()
    .toBuffer();
  const edited = await editMapPass(deps, {
    controlImage: paddedControl,
    styleImage,
    model: edit.model,
    prompt,
    imageSize: plan.imageSize,
    quality: edit.quality,
    inputFidelity: edit.inputFidelity
  });
  return sharp(edited)
    .resize(plan.targetW, plan.targetH, { fit: "fill" })
    .extract({ left: plan.padLeft, top: plan.padTop, width: plan.contentW, height: plan.contentH })
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
}

export async function generateTerrainWebp(
  deps: EditDeps,
  args: { svgMarkup: string; map: MapDefinition; profile: MapProfile; scene?: BoardScene }
): Promise<Buffer> {
  const { svgMarkup, map, profile, scene } = args;
  const { base } = profile;
  const width = base.outputSize.width;
  const height = outputHeightForViewBox(svgMarkup, width);

  const landMask = await renderLandMask({
    svgMarkup,
    map,
    width,
    height,
    organicSigma: base.organicSigma,
    background: base.background,
    coastWarp: base.coastWarp
  });
  const control = await renderControl({
    landMask,
    landColor: base.landColor,
    seaColor: base.seaColor,
    width,
    height
  });

  let styleImage: Buffer | null = null;
  if (profile.edit.styleRef) {
    const plan = planGptImageAspect(width, height);
    styleImage = await sharp(
      readFileSync(fileURLToPath(new URL(`../${profile.edit.styleRef}`, import.meta.url)))
    )
      .resize(plan.contentW, plan.contentH, { fit: "cover" })
      .jpeg()
      .toBuffer();
  }

  let terrain = await padEditCrop(deps, {
    control,
    styleImage,
    width,
    height,
    prompt: profile.edit.prompt,
    edit: profile.edit
  });

  // Fort pass: draw a castle at each fort tile. Only when the caller supplied the scene and it
  // has at least one fort — otherwise this is byte-for-byte the pre-fort behaviour.
  const markers = scene ? fortMarkers(scene, width, profile.fortPass.markerRadiusFactor) : [];
  if (markers.length > 0) {
    const overlaid = await fortMarkerOverlay({
      base: terrain,
      width,
      height,
      markers,
      color: profile.fortPass.markerColor
    });
    terrain = await padEditCrop(deps, {
      control: overlaid,
      styleImage: null,
      width,
      height,
      prompt: profile.fortPass.prompt,
      edit: profile.edit
    });
  }

  return toWebp(terrain, { width, height, quality: profile.webpQuality });
}
```

Note: the sea-blue letterbox value `#1565c0` matches the previous inline `base.seaColor` use; keep using `base.seaColor` if you prefer — pass it through `padEditCrop` args. Reading `base.seaColor` is fine since `base` is in scope of `generateTerrainWebp`; to keep `padEditCrop` self-contained the plan hardcodes the same default. Either is acceptable; if you thread it, add `seaColor: string` to the helper args and pass `base.seaColor`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/generateTerrainWebp.test.ts`
Expected: PASS — the original test (no `scene`, 1 call, 2 uploads) still passes; the fort test sees 2 calls / 3 uploads; the no-fort test sees 1 call.

- [ ] **Step 5: Run the full terrain test suite + typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run && corepack pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/mapPipeline.ts packages/terrain/test/generateTerrainWebp.test.ts
git commit -m "feat(terrain): second edit pass draws forts at fort tiles"
```

---

### Task 5: Wire the scene through both generation call sites

**Files:**
- Modify: `packages/terrain/src/mapSources.ts` (expose the scene alongside the SVG)
- Modify: `packages/terrain/src/mapPipeline.ts` (`runMapPipeline` passes `scene`)
- Modify: `packages/server/src/maps/terrainService.ts` (pass `scene`)
- Test: `packages/terrain/test/mapSources.test.ts` (assert the new accessor returns a scene with matching viewBox)

**Interfaces:**
- Consumes: `generateTerrainWebp` optional `scene` (Task 4), `buildScene`/`BoardScene`.
- Produces: `export function mapStructureScene(mapId: string): { svgMarkup: string; scene: BoardScene }` in `mapSources.ts`. `mapStructureSvg` is reimplemented to return `mapStructureScene(mapId).svgMarkup` (unchanged behavior/signature).

- [ ] **Step 1: Write the failing test**

Add to `packages/terrain/test/mapSources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapStructureScene, mapStructureSvg } from "../src/mapSources.js";

describe("mapStructureScene", () => {
  it("returns a scene whose viewBox matches the structure SVG for a built-in map", () => {
    const { svgMarkup, scene } = mapStructureScene("rivers");
    expect(svgMarkup).toBe(mapStructureSvg("rivers")); // same SVG as the legacy accessor
    const vb = svgMarkup.match(/viewBox="([\d.\s-]+)"/i)![1].trim().split(/\s+/).map(Number);
    expect(scene.viewBox.width).toBeCloseTo(vb[2], 3);
    expect(scene.viewBox.height).toBeCloseTo(vb[3], 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/mapSources.test.ts`
Expected: FAIL — `mapStructureScene` is not exported.

- [ ] **Step 3: Implement `mapStructureScene` and rewire callers**

In `packages/terrain/src/mapSources.ts`, replace the `mapStructureSvg` function with:

```ts
import type { BoardScene } from "@sengoku-jidai/board-render";

/**
 * The board structure SVG *and* its scene, built once from live board-render geometry. The SVG
 * conditions the terrain control image; the scene carries fort positions for the fort pass. Both
 * derive from the same `buildScene(compileHexMap(source))` so they always agree. Throws on an
 * unknown map id.
 */
export function mapStructureScene(mapId: string): { svgMarkup: string; scene: BoardScene } {
  const source = SOURCE_BY_MAP[mapId];
  if (!source) {
    throw new Error(`Unknown map "${mapId}" — add its source to SOURCE_BY_MAP in mapSources.ts`);
  }
  const scene = buildScene(compileHexMap(source));
  return { svgMarkup: assembleBoardSvg(scene), scene };
}

/** The board structure SVG only (see `mapStructureScene`). Kept for callers that need just the SVG. */
export function mapStructureSvg(mapId: string): string {
  return mapStructureScene(mapId).svgMarkup;
}
```

In `packages/terrain/src/mapPipeline.ts`, update `runMapPipeline` to use the scene:

```ts
// replace the mapStructureSvg import usage; import mapStructureScene instead:
import { mapStructureScene } from "./mapSources.js";

// inside runMapPipeline, replace the svgMarkup line and the generateTerrainWebp call:
  const map = getMap(mapId); // throws on unknown map id
  const { svgMarkup, scene } = mapStructureScene(mapId); // live geometry + fort positions
  mkdirSync(outDir, { recursive: true });
  const webp = await generateTerrainWebp(deps, { svgMarkup, map, profile, scene });
```

In `packages/server/src/maps/terrainService.ts`, thread the already-built scene (around lines 81-90):

```ts
      const compiled = compileHexMap(detail.source as HexMapSource);
      const scene = buildScene(compiled);
      const svgMarkup = assembleBoardSvg(scene);
      const deps = await this.resolveDeps();
      const webp = await generateTerrainWebp(deps, {
        svgMarkup,
        map: compiled.definition,
        profile: loadStyleProfile(styleId),
        scene
      });
```

- [ ] **Step 4: Run the terrain tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/mapSources.test.ts test/generateTerrainWebp.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild terrain, then typecheck server (dist trap)**

Run: `corepack pnpm --filter @sengoku-jidai/terrain build && corepack pnpm --filter @sengoku-jidai/server typecheck`
Expected: both succeed (server consumes terrain's dist; rebuild first).

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/mapSources.ts packages/terrain/src/mapPipeline.ts packages/server/src/maps/terrainService.ts packages/terrain/test/mapSources.test.ts
git commit -m "feat(terrain): pass board scene into terrain generation for the fort pass"
```

---

### Task 6: Export new modules + full-gate verification

**Files:**
- Modify: `packages/terrain/src/index.ts` (export the new modules if the package re-exports its surface)

**Interfaces:**
- Produces: `fortMarkers`, `FortMarker`, `fortMarkerOverlay`, `mapStructureScene` reachable from the package entry (only if `index.ts` follows the existing re-export convention).

- [ ] **Step 1: Check the package export convention**

Run: `sed -n '1,60p' packages/terrain/src/index.ts`
If `index.ts` re-exports the pipeline modules (e.g. it already `export *` / names `mapPipeline`, `mapSources`, `mapProfile`), add matching exports for `fortMarkers.js` and `fortMarkerOverlay.js`, and ensure `mapStructureScene` is reachable (it is exported from `mapSources`, so any existing `mapSources` re-export already covers it). If `index.ts` does NOT re-export these internal modules, make NO change — the new files are internal to the pipeline and reached via `mapPipeline`/`mapSources`. Record which case applies.

- [ ] **Step 2: Add exports only if the convention requires it**

Example (only if `index.ts` uses `export * from "./<module>.js"` for pipeline modules):

```ts
export * from "./fortMarkers.js";
export * from "./fortMarkerOverlay.js";
```

- [ ] **Step 3: Run the full gate for the touched packages**

Run:
```bash
corepack pnpm --filter @sengoku-jidai/terrain exec vitest run \
  && corepack pnpm --filter @sengoku-jidai/terrain typecheck \
  && corepack pnpm --filter @sengoku-jidai/terrain build \
  && corepack pnpm --filter @sengoku-jidai/server typecheck
```
Expected: all green.

- [ ] **Step 4: Run the repo formatter (prettier gate runs in CI)**

Run: `corepack pnpm format` (or the repo's format script — check `package.json` root `scripts`)
Expected: no diff, or only formatting of the new files. Re-run the gate if files changed.

- [ ] **Step 5: Commit (only if Step 2 or Step 4 changed files)**

```bash
git add -A
git commit -m "chore(terrain): export fort-pass modules and format"
```

---

### Task 7: Capped real-generation verification (manual, ≤2 fal generations)

**Files:**
- Create (throwaway, deleted after): `packages/terrain/test/_fortgen.test.ts`

This task validates the one non-deterministic behavior — that gpt-image draws a clean castle at the marker and preserves the rest. It costs real fal credits, so it is manual and capped. Follow the terrain-validation recipe.

- [ ] **Step 1: Pull the live fal key + a fort-bearing map**

```bash
CID=$(docker ps -q --filter name=sengoku | head -1)
FAL_KEY=$(docker exec "$CID" printenv FAL_KEY)
echo "key length: ${#FAL_KEY}"
```
Use a small test map that HAS a fort. If none exists, add a fort to a copy via the editor first, or author a tiny `HexMapSource` inline in the throwaway test with one `features: { fort: true }` land tile (mirror `FORT_SOURCE` from Task 4 but with a few tiles so the board is legible).

- [ ] **Step 2: Offline dry-run the deterministic parts first**

Write `_fortgen.test.ts` that builds the scene, calls `fortMarkers` + `fortMarkerOverlay` on a placeholder base (or the committed Rivers background), and writes the overlay PNG to the scratchpad. Read it back to confirm markers land on the correct tiles BEFORE spending any fal credits.

```bash
corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/_fortgen.test.ts
```
Read the written overlay PNG; confirm each magenta disc sits on a fort tile.

- [ ] **Step 3: One real generation**

Extend the throwaway test to call `generateTerrainWebp` with real `createFalClient` deps and the fort-bearing scene (180s timeout). Cap at ONE generation first.

```bash
FAL_KEY="$FAL_KEY" corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/_fortgen.test.ts
```

- [ ] **Step 4: Eyeball on the board**

Composite the produced webp onto the board and render to PNG per the recipe:

```bash
corepack pnpm --filter @sengoku-jidai/board-render exec tsx scripts/terrain-shot.ts \
  --map <mapId> --terrain-url <scratch>/fort-terrain.webp --out <scratch>/fort.html
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs \
  <scratch>/fort.html <scratch>/fort.png
```
Read `fort.png`. Confirm: a Japanese castle appears at each fort tile, no magenta remains, and the rest of the terrain is unchanged.

- [ ] **Step 5: Tune if needed (≤1 more generation)**

If the castle is too big/small, adjust `markerRadiusFactor` in `profiles/map.json`'s `fortPass` block (add the block to override the default). If magenta leaks or placement drifts, tighten the `fortPass.prompt`. Re-run ONE more generation max. Stop at 2 total.

- [ ] **Step 6: Delete the throwaway test**

```bash
rm packages/terrain/test/_fortgen.test.ts
```
Commit any profile tuning:

```bash
git add packages/terrain/profiles/map.json packages/terrain/profiles/ink.json
git commit -m "chore(terrain): tune fort-pass marker size/prompt from real-gen verification"
```

---

## Self-Review

**Spec coverage:**
- Second edit pass after base terrain → Task 4. ✅
- Fort positions from `BoardScene` centroid, scaled to output px → Task 1. ✅
- Bright marker overlay → Task 2. ✅
- `fortPass` profile block (prompt, radius factor, color) with Japanese-castle default → Task 3. ✅
- Skip second pass when no forts (no cost, no regression) → Task 4 (`markers.length > 0` guard) + test. ✅
- Wire scene through both call sites (server + CLI) → Task 5. ✅
- Reuse pad/edit/crop geometry across both passes → Task 4 (`padEditCrop`). ✅
- input_fidelity high + "leave everything unchanged" prompt → Task 3 default prompt + Task 4 (uses `profile.edit.inputFidelity`, already "high"). ✅
- Offline unit tests + capped real-gen verification → Tasks 1–6 (offline) + Task 7 (manual, ≤2 gens). ✅
- Out of scope (board border, engine/state) untouched → no task modifies them. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N"; every code step has full content. Task 6 Step 1 is a deliberate conditional (export convention differs by repo) with both branches specified. Task 7 is inherently manual (real fal spend) with exact commands. ✅

**Type consistency:** `FortMarker { x, y, radius }` defined in Task 1, consumed identically in Tasks 2 & 4. `fortMarkers(scene, outputWidth, markerRadiusFactor)` signature matches its call in Task 4. `fortMarkerOverlay({ base, width, height, markers, color })` matches Task 4's call. `mapStructureScene(mapId): { svgMarkup, scene }` defined in Task 5, consumed in `runMapPipeline`. `profile.fortPass.{prompt,markerRadiusFactor,markerColor}` defined in Task 3, consumed in Task 4. `generateTerrainWebp` optional `scene?: BoardScene` added in Task 4, passed by both callers in Task 5. ✅
