# Terrain Map Composite Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `gen:map` pipeline that composes an antique map background where the coastline comes from the vector board SVG (deterministic `sharp` compositing) and the model only paints region textures — eliminating the denoise-strength dial that traded coast fidelity against detail.

**Architecture:** From the board SVG, render a crisp binary land/sea mask + an inked coastline stroke. Generate two unclipped full-frame textures (land, sea) via fal text-to-image. Clip land through the mask over sea, lay the coastline on top, then desaturate/tint/vignette into one antique sheet. All structure is vector-derived; the model never sees the boundary.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `sharp` (raster compositing), `jsdom` (SVG DOM prep), `@fal-ai/client` (text-to-image), `zod` (profile schema), Vitest (tests, fal mocked).

## Global Constraints

- Package: `packages/terrain`. All new source in `packages/terrain/src/`, tests in `packages/terrain/test/`.
- ESM: import sibling modules with the `.js` extension (e.g. `from "./masks.js"`), matching existing files.
- fal client (`fal`) and `fetch` are **always injected** into generation code so tests run offline. Never import `fetch`/`fal` directly into testable functions.
- Reuse `FalClient` / `FetchFn` / `firstImageUrl` from `src/backend.js`. Do not redefine them.
- The committed web asset (`packages/web/src/assets/terrain/<mapId>.webp`) is **never** overwritten by this pipeline. The CLI writes only to the external output dir; promoting a chosen result is a manual copy.
- External output dir default comes from `process.env.TERRAIN_OUT_DIR`; the user sets it to `/mnt/ssd_pool/ssd_set/terrain-gen` in the git-ignored `.env`. No absolute machine path is hard-coded in committed source.
- Lint/format gates must pass: no unused imports; run `pnpm --filter @sengoku-jidai/terrain typecheck` and the repo prettier/eslint before each commit.
- Existing `pipeline.ts` / `cli.ts` (matrix + single i2i harness) stay intact — this is a parallel pipeline, not a replacement.

---

## File Structure

- `src/controlImage.ts` — **modify**: extract `prepBoardSvgMarkup` (shared SVG DOM prep), have `renderBaseImage` call it.
- `src/masks.ts` — **create**: `renderMasks` → crisp binary land mask + inked coastline stroke.
- `src/texture.ts` — **create**: `generateTexture` → one fal text-to-image call, returns image bytes.
- `src/composite.ts` — **create**: `compositeMap` (clip land over sea + coastline) and `harmonize` (desaturate/tint/vignette).
- `src/mapProfile.ts` — **create**: zod schema + `loadMapProfile`.
- `profiles/map.json` — **create**: default land/sea prompts, colours, harmonize settings.
- `src/mapPipeline.ts` — **create**: `runMapPipeline` orchestration, writes intermediates + final webp.
- `src/mapPipelineCli.ts` — **create**: CLI entry; arg parse, fal config, calls `runMapPipeline`.
- `package.json` — **modify**: add `"gen:map": "tsx src/mapPipelineCli.ts"`.
- `.env.example` — **modify**: document `TERRAIN_OUT_DIR`.

Note: the optional low-strength img2img "seam marry" pass from the design is **deliberately deferred** (YAGNI) — the pure-`sharp` `harmonize` ships first; add the i2i pass only if the seam proves visible.

---

### Task 1: Extract shared SVG prep from `controlImage.ts`

**Files:**
- Modify: `packages/terrain/src/controlImage.ts`
- Test: `packages/terrain/test/controlImage.test.ts` (existing test must still pass)

**Interfaces:**
- Produces: `prepBoardSvgMarkup(args: { svgMarkup: string; colors: Record<string, string>; backgroundColor: string; width: number; height: number }): string` — returns prepped SVG `outerHTML` (background rect added, non-tile layers hidden, geometry defs neutralized, each tile filled by `colors`), **without** rasterizing or blurring.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `packages/terrain/test/controlImage.test.ts`:

```typescript
import { prepBoardSvgMarkup } from "../src/controlImage.js";

describe("prepBoardSvgMarkup", () => {
  it("returns SVG markup sized to the request with a tile filled by the given colour", () => {
    const svgMarkup = readFileSync(mapSvgPath("rivers"), "utf8");
    const markup = prepBoardSvgMarkup({
      svgMarkup,
      colors: tileColorMap(riversMap, LAND, SEA),
      backgroundColor: LAND,
      width: 256,
      height: 290
    });
    expect(markup).toContain('width="256"');
    expect(markup).toContain('preserveAspectRatio="none"');
    // tile1 is land, so its inline style carries the land fill.
    expect(markup).toMatch(/id="tile1"[^>]*fill:#7e8c5a/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test -- controlImage`
Expected: FAIL — `prepBoardSvgMarkup is not a function`.

- [ ] **Step 3: Refactor `renderBaseImage` to use the extracted function**

In `packages/terrain/src/controlImage.ts`, replace the body that builds the prepped DOM (the `JSDOM` block through the per-tile fill loop, lines ~43–94) with a new exported function, and have `renderBaseImage` call it:

```typescript
/** Prepare the board SVG for rasterization: paint a land background, hide every non-tile
 *  layer, neutralize shared geometry defs, and fill each tile by its colour. Returns the
 *  prepped SVG markup (no rasterization), shared by the colour-base and mask renderers. */
export function prepBoardSvgMarkup(args: {
  svgMarkup: string;
  colors: Record<string, string>;
  backgroundColor: string;
  width: number;
  height: number;
}): string {
  const { svgMarkup, colors, backgroundColor, width, height } = args;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const doc = new JSDOM(`<!doctype html><body>${svgMarkup}</body>`).window.document;
  const svg = doc.querySelector("svg");
  if (!svg) {
    throw new Error("base render: no <svg> in markup");
  }
  const vb = (svg.getAttribute("viewBox") ?? "0 0 0 0").split(/\s+/).map(Number);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");

  const bg = doc.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(vb[0]));
  bg.setAttribute("y", String(vb[1]));
  bg.setAttribute("width", String(vb[2]));
  bg.setAttribute("height", String(vb[3]));
  bg.setAttribute("fill", backgroundColor);
  svg.insertBefore(bg, svg.firstChild);

  const g1 = doc.getElementById("g1");
  if (!g1) {
    throw new Error("base render: SVG has no #g1 group");
  }
  for (const child of Array.from(g1.children)) {
    if (child.id !== "tile-land" && child.id !== "tile-sea") {
      child.setAttribute("style", `${child.getAttribute("style") ?? ""};display:none`);
    }
  }

  for (const id of TILE_GEOMETRY_DEFS) {
    const def = doc.getElementById(id);
    if (def) {
      def.setAttribute("style", `${def.getAttribute("style") ?? ""};fill:inherit;stroke:inherit`);
    }
  }

  for (const [tileId, color] of Object.entries(colors)) {
    const tile = doc.getElementById(tileId);
    if (!tile) {
      throw new Error(`base render: SVG has no element for tile "${tileId}"`);
    }
    tile.setAttribute(
      "style",
      `${tile.getAttribute("style") ?? ""};fill:${color};stroke:${color};stroke-width:2;display:inline`
    );
  }

  return svg.outerHTML;
}
```

Then rewrite `renderBaseImage` to delegate:

```typescript
export async function renderBaseImage(args: {
  svgMarkup: string;
  colors: Record<string, string>;
  backgroundColor: string;
  width: number;
  height: number;
  blurSigma: number;
}): Promise<Buffer> {
  const { width, height, blurSigma, ...prep } = args;
  const markup = prepBoardSvgMarkup({ ...prep, width, height });
  let pipeline = sharp(Buffer.from(markup)).resize(width, height, { fit: "fill" });
  if (blurSigma > 0) {
    pipeline = pipeline.blur(blurSigma);
  }
  return pipeline.png().toBuffer();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/terrain test -- controlImage`
Expected: PASS — both the existing `renderBaseImage` test and the new `prepBoardSvgMarkup` test.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/controlImage.ts packages/terrain/test/controlImage.test.ts
git commit -m "refactor(terrain): extract prepBoardSvgMarkup for reuse by mask renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `renderMasks` — binary land mask + inked coastline

**Files:**
- Create: `packages/terrain/src/masks.ts`
- Test: `packages/terrain/test/masks.test.ts`

**Interfaces:**
- Consumes: `prepBoardSvgMarkup` (Task 1), `tileColorMap` from `./controlImage.js`, `MapDefinition` from `@sengoku-jidai/engine`.
- Produces:
  ```typescript
  export interface BoardMasks { landMask: Buffer; coastStroke: Buffer; width: number; height: number }
  export function renderMasks(args: {
    svgMarkup: string;
    map: MapDefinition;
    width: number;
    height: number;
    organicSigma: number;   // blur-then-threshold to round hex facets; 0 = crisp
    inkColor: string;       // coastline stroke colour, e.g. "#3a2f23"
    strokeWidth: number;    // edge dilation in px, e.g. 2
  }): Promise<BoardMasks>;
  ```
  `landMask` is a single-channel PNG: 255 over land (incl. background), 0 over sea. `coastStroke` is an RGBA PNG: `inkColor` along the land/sea boundary, transparent elsewhere.

**Implementation notes:**
- Render land=`#ffffff`, sea=`#000000`, background=`#ffffff` via `prepBoardSvgMarkup`, rasterize crisp with `sharp(...).resize(w,h,{fit:"fill"}).greyscale()`.
- Organicize: if `organicSigma > 0`, `.blur(organicSigma)` then `.threshold(128)` to round corners while staying binary. Result = `landMask`.
- Coastline: convolve the binary mask with a Laplacian edge kernel to isolate the boundary, `.threshold(40)` to binarize the edge, optionally `.blur(strokeWidth/2)` + `.threshold(40)` to thicken, producing a single-channel edge. Build `coastStroke` by tinting: a solid `inkColor` RGB image with the edge as its alpha channel (`removeAlpha().joinChannel(edge)`).

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/masks.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { riversMap } from "@sengoku-jidai/engine";
import { renderMasks } from "../src/masks.js";
import { mapSvgPath } from "../src/mapSources.js";

describe("renderMasks", () => {
  it("produces a binary land mask (white land, black sea) and a non-empty coastline", async () => {
    const svgMarkup = readFileSync(mapSvgPath("rivers"), "utf8");
    const { landMask, coastStroke, width, height } = await renderMasks({
      svgMarkup,
      map: riversMap,
      width: 256,
      height: 290,
      organicSigma: 0,
      inkColor: "#3a2f23",
      strokeWidth: 2
    });
    expect(width).toBe(256);
    expect(height).toBe(290);

    // Land mask is strictly binary with both populations present.
    const mask = await sharp(landMask).greyscale().raw().toBuffer();
    let white = 0;
    let black = 0;
    for (const v of mask) {
      if (v > 200) white += 1;
      else if (v < 50) black += 1;
    }
    expect(white + black).toBe(mask.length); // no greys → binary
    expect(white / mask.length).toBeGreaterThan(0.4); // land + background dominate
    expect(black / mask.length).toBeGreaterThan(0.1); // sea is a real minority

    // Coastline has opaque ink pixels (the boundary) but is mostly transparent.
    const { data, info } = await sharp(coastStroke)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3]! > 128) opaque += 1;
    }
    const totalPx = info.width * info.height;
    expect(opaque).toBeGreaterThan(0);
    expect(opaque / totalPx).toBeLessThan(0.2); // a stroke, not a fill
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test -- masks`
Expected: FAIL — cannot resolve `../src/masks.js`.

- [ ] **Step 3: Implement `renderMasks`**

Create `packages/terrain/src/masks.ts`:

```typescript
import type { MapDefinition } from "@sengoku-jidai/engine";
import sharp from "sharp";
import { prepBoardSvgMarkup, tileColorMap } from "./controlImage.js";

export interface BoardMasks {
  landMask: Buffer;
  coastStroke: Buffer;
  width: number;
  height: number;
}

/** 3x3 Laplacian: nonzero only where the binary mask changes (the coastline). */
const EDGE_KERNEL = { width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] };

/**
 * Render the structural masks for a map from its board SVG. The land mask is the
 * compositing authority (coastline fidelity is 100% because it is the vector outline,
 * never a model output); the coastline stroke is the inked boundary laid over the
 * finished composite. Land + the area outside the tiles read as land; sea tiles read
 * as sea. `organicSigma` rounds the hex facets into organic curves while keeping the
 * mask strictly binary.
 */
export async function renderMasks(args: {
  svgMarkup: string;
  map: MapDefinition;
  width: number;
  height: number;
  organicSigma: number;
  inkColor: string;
  strokeWidth: number;
}): Promise<BoardMasks> {
  const { svgMarkup, map, width, height, organicSigma, inkColor, strokeWidth } = args;

  const markup = prepBoardSvgMarkup({
    svgMarkup,
    colors: tileColorMap(map, "#ffffff", "#000000"),
    backgroundColor: "#ffffff",
    width,
    height
  });

  let maskPipe = sharp(Buffer.from(markup)).resize(width, height, { fit: "fill" }).greyscale();
  if (organicSigma > 0) {
    maskPipe = maskPipe.blur(organicSigma);
  }
  const landMask = await maskPipe.threshold(128).png().toBuffer();

  // Coastline: edge-detect the binary mask, thicken, then tint with ink as alpha.
  let edgePipe = sharp(landMask).greyscale().convolve(EDGE_KERNEL).threshold(40);
  if (strokeWidth > 1) {
    edgePipe = edgePipe.blur(strokeWidth / 2).threshold(40);
  }
  const edge = await edgePipe.toColourspace("b-w").raw().toBuffer();

  const { r, g, b } = parseHex(inkColor);
  const coastStroke = await sharp(
    {
      create: { width, height, channels: 3, background: { r, g, b } }
    } as sharp.SharpOptions
  )
    .joinChannel(edge, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return { landMask, coastStroke, width, height };
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test -- masks`
Expected: PASS. If the binary assertion fails because `threshold` left an alpha channel, confirm the `.greyscale()` before `.threshold(128)` and that `landMask` reads back single-channel.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`

```bash
git add packages/terrain/src/masks.ts packages/terrain/test/masks.test.ts
git commit -m "feat(terrain): renderMasks — binary land mask + inked coastline from SVG

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `generateTexture` — fal text-to-image call

**Files:**
- Create: `packages/terrain/src/texture.ts`
- Test: `packages/terrain/test/texture.test.ts`

**Interfaces:**
- Consumes: `FalClient`, `FetchFn`, `firstImageUrl` from `./backend.js`.
- Produces:
  ```typescript
  export interface TextureDeps { fal: FalClient; fetch: FetchFn }
  export function generateTexture(deps: TextureDeps, args: {
    model: string;
    prompt: string;
    seed: number;
    width: number;
    height: number;
    guidanceScale: number;
    numInferenceSteps: number;
  }): Promise<Buffer>;
  ```
  A **text-to-image** call: sends `image_size` (no `image_url`), returns the fetched image bytes.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/texture.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { generateTexture } from "../src/texture.js";

describe("generateTexture", () => {
  it("calls the t2i model with image_size and no image_url, returns the fetched bytes", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/land.png" }] } }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("LANDBYTES").buffer
    }));

    const out = await generateTexture(
      { fal, fetch },
      {
        model: "fal-ai/flux/dev",
        prompt: "antique parchment landmass",
        seed: 1568,
        width: 1024,
        height: 1164,
        guidanceScale: 3.5,
        numInferenceSteps: 34
      }
    );

    expect(fal.storage.upload).not.toHaveBeenCalled(); // t2i: nothing uploaded
    const [model, opts] = fal.subscribe.mock.calls[0]!;
    expect(model).toBe("fal-ai/flux/dev");
    expect(opts.input).toMatchObject({
      prompt: "antique parchment landmass",
      seed: 1568,
      num_images: 1,
      guidance_scale: 3.5,
      num_inference_steps: 34,
      enable_safety_checker: false,
      image_size: { width: 1024, height: 1164 }
    });
    expect(opts.input).not.toHaveProperty("image_url");
    expect(fetch).toHaveBeenCalledWith("https://out/land.png");
    expect(out.toString()).toBe("LANDBYTES");
  });

  it("throws when the image fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/x.png" }] } }))
    };
    const fetch = vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(
      generateTexture(
        { fal, fetch },
        { model: "m", prompt: "p", seed: 1, width: 8, height: 8, guidanceScale: 3.5, numInferenceSteps: 34 }
      )
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test -- texture`
Expected: FAIL — cannot resolve `../src/texture.js`.

- [ ] **Step 3: Implement `generateTexture`**

Create `packages/terrain/src/texture.ts`:

```typescript
import { firstImageUrl, type FalClient, type FetchFn } from "./backend.js";

export interface TextureDeps {
  fal: FalClient;
  fetch: FetchFn;
}

/**
 * Generate one full-frame, unconstrained texture via a fal text-to-image endpoint. The
 * model never sees the coastline (no init image), so there are no boundary artifacts — the
 * texture is clipped to the land/sea mask afterward in compositeMap.
 */
export async function generateTexture(
  deps: TextureDeps,
  args: {
    model: string;
    prompt: string;
    seed: number;
    width: number;
    height: number;
    guidanceScale: number;
    numInferenceSteps: number;
  }
): Promise<Buffer> {
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    seed: args.seed,
    num_images: 1,
    guidance_scale: args.guidanceScale,
    num_inference_steps: args.numInferenceSteps,
    enable_safety_checker: false,
    image_size: { width: args.width, height: args.height }
  };
  const result = await deps.fal.subscribe(args.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`texture fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test -- texture`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`

```bash
git add packages/terrain/src/texture.ts packages/terrain/test/texture.test.ts
git commit -m "feat(terrain): generateTexture — full-frame text-to-image region textures

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `compositeMap` + `harmonize`

**Files:**
- Create: `packages/terrain/src/composite.ts`
- Test: `packages/terrain/test/composite.test.ts`

**Interfaces:**
- Consumes: `BoardMasks` shape from Task 2 (the `landMask` / `coastStroke` buffers).
- Produces:
  ```typescript
  export function compositeMap(args: {
    landTexture: Buffer;
    seaTexture: Buffer;
    landMask: Buffer;     // single-channel: 255 = land
    coastStroke: Buffer;  // RGBA ink boundary
    width: number;
    height: number;
  }): Promise<Buffer>;     // PNG

  export function harmonize(image: Buffer, opts: {
    saturation: number;   // 0..1 multiplier (e.g. 0.6 desaturates)
    brightness: number;   // multiplier (e.g. 0.95 dims)
    parchmentTint: string; // hex multiplied over the image, e.g. "#d8c8a8"
    vignette: boolean;
  }): Promise<Buffer>;     // PNG
  ```

**Implementation notes:**
- `compositeMap`: resize both textures to `width×height` (`fit:"fill"`). Build land-with-alpha = `sharp(land).removeAlpha().resize(...).joinChannel(maskRaw)` where `maskRaw` is the single-channel mask resized to match. Composite land over sea, then `coastStroke` over that.
- `harmonize`: `.modulate({ saturation, brightness })`, then multiply the parchment tint (composite a solid tint with `blend:"multiply"`), then optional vignette (composite a radial-gradient PNG with `blend:"multiply"`). Build the vignette as an inline SVG radial gradient so no asset file is needed.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/composite.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compositeMap, harmonize } from "../src/composite.js";

const W = 16;
const H = 16;

// A solid-colour PNG helper.
async function solid(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

// Left half land (255), right half sea (0): a vertical split single-channel mask.
async function splitMask(): Promise<Buffer> {
  const raw = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) raw[y * W + x] = x < W / 2 ? 255 : 0;
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

async function transparent(): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
}

describe("compositeMap", () => {
  it("paints land where the mask is white and sea where it is black", async () => {
    const out = await compositeMap({
      landTexture: await solid(0, 200, 0), // green land
      seaTexture: await solid(0, 0, 200), // blue sea
      landMask: await splitMask(),
      coastStroke: await transparent(),
      width: W,
      height: H
    });
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * 3;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
    expect(px(2, 8)[1]).toBeGreaterThan(150); // left → green land
    expect(px(13, 8)[2]).toBeGreaterThan(150); // right → blue sea
  });
});

describe("harmonize", () => {
  it("reduces saturation of the input", async () => {
    const vivid = await solid(220, 30, 30); // saturated red
    const out = await harmonize(vivid, {
      saturation: 0.3,
      brightness: 1,
      parchmentTint: "#ffffff",
      vignette: false
    });
    const before = await sharp(vivid).stats();
    const after = await sharp(out).stats();
    const spread = (s: Awaited<ReturnType<typeof sharp.prototype.stats>>) =>
      Math.max(...s.channels.map((c) => c.max)) - Math.min(...s.channels.map((c) => c.min));
    expect(spread(after)).toBeLessThan(spread(before)); // channels pulled together
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test -- composite`
Expected: FAIL — cannot resolve `../src/composite.js`.

- [ ] **Step 3: Implement `compositeMap` + `harmonize`**

Create `packages/terrain/src/composite.ts`:

```typescript
import sharp from "sharp";

/** Clip the land texture through the land mask over the sea texture, then ink the coast. */
export async function compositeMap(args: {
  landTexture: Buffer;
  seaTexture: Buffer;
  landMask: Buffer;
  coastStroke: Buffer;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { width, height } = args;
  const fit = { width, height, fit: "fill" as const };

  const sea = await sharp(args.seaTexture).resize(fit).removeAlpha().png().toBuffer();
  const maskRaw = await sharp(args.landMask).resize(fit).greyscale().raw().toBuffer();
  const landRgb = await sharp(args.landTexture).resize(fit).removeAlpha().raw().toBuffer();

  // Land texture with the mask as its alpha channel → only land regions are opaque.
  const landWithAlpha = await sharp(landRgb, { raw: { width, height, channels: 3 } })
    .joinChannel(maskRaw, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(sea)
    .composite([{ input: landWithAlpha }, { input: args.coastStroke }])
    .png()
    .toBuffer();
}

/** Desaturate, multiply a parchment tint, and (optionally) vignette into one antique sheet. */
export async function harmonize(
  image: Buffer,
  opts: { saturation: number; brightness: number; parchmentTint: string; vignette: boolean }
): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const overlays: sharp.OverlayOptions[] = [
    {
      input: {
        create: { width, height, channels: 3, background: opts.parchmentTint }
      },
      blend: "multiply"
    }
  ];
  if (opts.vignette) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#7a6a4a"/>
      </radialGradient>
      <rect width="100%" height="100%" fill="url(#v)"/></svg>`;
    overlays.push({ input: Buffer.from(svg), blend: "multiply" });
  }

  return sharp(image)
    .modulate({ saturation: opts.saturation, brightness: opts.brightness })
    .composite(overlays)
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test -- composite`
Expected: PASS (both `compositeMap` and `harmonize`).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`

```bash
git add packages/terrain/src/composite.ts packages/terrain/test/composite.test.ts
git commit -m "feat(terrain): compositeMap + harmonize — clip textures to mask, age into one sheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Map profile schema + `profiles/map.json`

**Files:**
- Create: `packages/terrain/src/mapProfile.ts`
- Create: `packages/terrain/profiles/map.json`
- Test: `packages/terrain/test/mapProfile.test.ts`

**Interfaces:**
- Consumes: nothing new (`zod`, `node:fs`).
- Produces:
  ```typescript
  export interface MapProfile { /* inferred from schema below */ }
  export function loadMapProfile(path: string): MapProfile;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/mapProfile.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadMapProfile } from "../src/mapProfile.js";

describe("loadMapProfile", () => {
  it("loads the committed default map profile with land + sea prompts", () => {
    const path = fileURLToPath(new URL("../profiles/map.json", import.meta.url));
    const p = loadMapProfile(path);
    expect(p.land.prompt.length).toBeGreaterThan(0);
    expect(p.sea.prompt.length).toBeGreaterThan(0);
    expect(p.base.outputSize.width).toBeGreaterThan(0);
    expect(p.base.organicSigma).toBeGreaterThanOrEqual(0);
  });

  it("throws a clear error on an invalid profile", () => {
    expect(() => loadMapProfile(fileURLToPath(new URL("./mapProfile.test.ts", import.meta.url)))).toThrow(
      /Invalid map profile/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test -- mapProfile`
Expected: FAIL — cannot resolve `../src/mapProfile.js`.

- [ ] **Step 3: Implement the schema + loader**

Create `packages/terrain/src/mapProfile.ts`:

```typescript
import { readFileSync } from "node:fs";
import { z } from "zod";

const RegionSchema = z.object({ prompt: z.string().min(1), seed: z.number().int() });

const MapProfileSchema = z.object({
  base: z.object({
    /** fal text-to-image endpoint id used for both region textures. */
    model: z.string().min(1),
    landColor: z.string().default("#7e8c5a"),
    seaColor: z.string().default("#566f80"),
    outputSize: z.object({ width: z.number().int(), height: z.number().int() }),
    /** Blur-then-threshold sigma that rounds hex facets into organic coastline. */
    organicSigma: z.number().min(0).default(2),
    inkColor: z.string().default("#3a2f23"),
    strokeWidth: z.number().min(1).default(2)
  }),
  land: RegionSchema,
  sea: RegionSchema,
  guidanceScale: z.number().default(3.5),
  numInferenceSteps: z.number().int().default(34),
  harmonize: z.object({
    saturation: z.number().min(0).default(0.6),
    brightness: z.number().min(0).default(0.96),
    parchmentTint: z.string().default("#d8c8a8"),
    vignette: z.boolean().default(true)
  }),
  webpQuality: z.number().int().min(1).max(100).default(82)
});

export type MapProfile = z.infer<typeof MapProfileSchema>;

/** Read and validate a map profile JSON file. Throws with a clear message on invalid input. */
export function loadMapProfile(path: string): MapProfile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = MapProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid map profile at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 4: Create the default profile**

Create `packages/terrain/profiles/map.json`:

```json
{
  "base": {
    "model": "fal-ai/flux/dev",
    "landColor": "#7e8c5a",
    "seaColor": "#566f80",
    "outputSize": { "width": 1024, "height": 1164 },
    "organicSigma": 2,
    "inkColor": "#3a2f23",
    "strokeWidth": 2
  },
  "land": {
    "prompt": "seamless top-down antique map texture of forested feudal-Japan land, aged sepia parchment, hand-inked tiny mountains and pine groves, faded green and ochre watercolour wash, weathered paper grain, no coastline, no water, no text, no border",
    "seed": 1568
  },
  "sea": {
    "prompt": "seamless top-down antique map texture of calm sea, aged parchment, faded blue-grey watercolour wash, fine hand-drawn wave hatching, subtle ripples, weathered paper grain, no land, no coastline, no text, no border",
    "seed": 1568
  },
  "guidanceScale": 3.5,
  "numInferenceSteps": 34,
  "harmonize": {
    "saturation": 0.6,
    "brightness": 0.96,
    "parchmentTint": "#d8c8a8",
    "vignette": true
  },
  "webpQuality": 82
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test -- mapProfile`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`

```bash
git add packages/terrain/src/mapProfile.ts packages/terrain/profiles/map.json packages/terrain/test/mapProfile.test.ts
git commit -m "feat(terrain): map profile schema + default land/sea/harmonize profile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `runMapPipeline` orchestration

**Files:**
- Create: `packages/terrain/src/mapPipeline.ts`
- Test: `packages/terrain/test/mapPipeline.test.ts`

**Interfaces:**
- Consumes: `renderMasks` (Task 2), `generateTexture` + `TextureDeps` (Task 3), `compositeMap` + `harmonize` (Task 4), `MapProfile` (Task 5), `getMap` from `@sengoku-jidai/engine`, `mapSvgPath` from `./mapSources.js`, `toWebp` from `./postprocess.js`.
- Produces:
  ```typescript
  export function runMapPipeline(
    deps: TextureDeps,
    args: { mapId: string; profile: MapProfile; outDir: string }
  ): Promise<{ outDir: string; webpPath: string }>;
  ```
  Renders masks, generates both textures **in parallel**, composites + harmonizes, writes every intermediate (`landMask.png`, `coastStroke.png`, `land.png`, `sea.png`, `composite.png`) and the final `background.webp` into `outDir`, and returns the paths.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/mapPipeline.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadMapProfile } from "../src/mapProfile.js";
import { runMapPipeline } from "../src/mapPipeline.js";
import { fileURLToPath } from "node:url";

describe("runMapPipeline", () => {
  it("generates two textures, writes intermediates + a webp, returns paths", async () => {
    const profile = loadMapProfile(fileURLToPath(new URL("../profiles/map.json", import.meta.url)));
    // Shrink for a fast test.
    profile.base.outputSize = { width: 32, height: 36 };

    // Each fal call returns a distinct solid PNG so we can tell land/sea apart if needed.
    const png = async (r: number, g: number, b: number) =>
      (await sharp({ create: { width: 32, height: 36, channels: 3, background: { r, g, b } } }).png().toBuffer());
    const subscribe = vi
      .fn()
      .mockResolvedValueOnce({ data: { images: [{ url: "https://o/land.png" }] } })
      .mockResolvedValueOnce({ data: { images: [{ url: "https://o/sea.png" }] } });
    const fal = { storage: { upload: vi.fn() }, subscribe };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => (await png(0, 180, 0)).buffer })
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => (await png(0, 0, 180)).buffer });

    const outDir = mkdtempSync(join(tmpdir(), "terrain-"));
    const res = await runMapPipeline({ fal, fetch }, { mapId: "rivers", profile, outDir });

    expect(subscribe).toHaveBeenCalledTimes(2); // land + sea, t2i
    for (const f of ["landMask.png", "coastStroke.png", "land.png", "sea.png", "composite.png", "background.webp"]) {
      expect(existsSync(join(outDir, f))).toBe(true);
    }
    expect(res.webpPath).toBe(join(outDir, "background.webp"));
    // Final webp is a valid image of the requested size.
    const meta = await sharp(readFileSync(res.webpPath)).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(36);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test -- mapPipeline`
Expected: FAIL — cannot resolve `../src/mapPipeline.js`.

- [ ] **Step 3: Implement `runMapPipeline`**

Create `packages/terrain/src/mapPipeline.ts`:

```typescript
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getMap } from "@sengoku-jidai/engine";
import { compositeMap, harmonize } from "./composite.js";
import { mapSvgPath } from "./mapSources.js";
import { renderMasks } from "./masks.js";
import type { MapProfile } from "./mapProfile.js";
import { toWebp } from "./postprocess.js";
import { generateTexture, type TextureDeps } from "./texture.js";

/**
 * Run the mask-composite map pipeline: structure comes from the vector SVG (renderMasks),
 * texture from two parallel text-to-image calls, then deterministic clip + harmonize. Writes
 * every intermediate next to the final webp for inspection.
 */
export async function runMapPipeline(
  deps: TextureDeps,
  args: { mapId: string; profile: MapProfile; outDir: string }
): Promise<{ outDir: string; webpPath: string }> {
  const { mapId, profile, outDir } = args;
  const { base } = profile;
  const { width, height } = base.outputSize;

  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");

  mkdirSync(outDir, { recursive: true });

  const masks = await renderMasks({
    svgMarkup,
    map,
    width,
    height,
    organicSigma: base.organicSigma,
    inkColor: base.inkColor,
    strokeWidth: base.strokeWidth
  });
  writeFileSync(join(outDir, "landMask.png"), masks.landMask);
  writeFileSync(join(outDir, "coastStroke.png"), masks.coastStroke);

  const texArgs = (region: { prompt: string; seed: number }) => ({
    model: base.model,
    prompt: region.prompt,
    seed: region.seed,
    width,
    height,
    guidanceScale: profile.guidanceScale,
    numInferenceSteps: profile.numInferenceSteps
  });
  const [landTexture, seaTexture] = await Promise.all([
    generateTexture(deps, texArgs(profile.land)),
    generateTexture(deps, texArgs(profile.sea))
  ]);
  writeFileSync(join(outDir, "land.png"), landTexture);
  writeFileSync(join(outDir, "sea.png"), seaTexture);

  const composited = await compositeMap({
    landTexture,
    seaTexture,
    landMask: masks.landMask,
    coastStroke: masks.coastStroke,
    width,
    height
  });
  writeFileSync(join(outDir, "composite.png"), composited);

  const aged = await harmonize(composited, profile.harmonize);
  const webp = await toWebp(aged, { width, height, quality: profile.webpQuality });
  const webpPath = join(outDir, "background.webp");
  writeFileSync(webpPath, webp);

  return { outDir, webpPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test -- mapPipeline`
Expected: PASS — 2 fal calls, all six files present, webp is 32×36.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`

```bash
git add packages/terrain/src/mapPipeline.ts packages/terrain/test/mapPipeline.test.ts
git commit -m "feat(terrain): runMapPipeline — masks + parallel textures + composite + harmonize

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `gen:map` CLI + env wiring

**Files:**
- Create: `packages/terrain/src/mapPipelineCli.ts`
- Modify: `packages/terrain/package.json` (add `gen:map` script)
- Modify: `.env.example` (document `TERRAIN_OUT_DIR`)

**Interfaces:**
- Consumes: `runMapPipeline` (Task 6), `loadMapProfile` (Task 5), `fal` from `@fal-ai/client`.
- Produces: a runnable CLI; no exported API (no unit test — verified by the manual run in Task 8).

- [ ] **Step 1: Implement the CLI**

Create `packages/terrain/src/mapPipelineCli.ts`:

```typescript
import { fal } from "@fal-ai/client";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadMapProfile } from "./mapProfile.js";
import { runMapPipeline } from "./mapPipeline.js";

async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen:map <mapId>");
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set (see .env.example)");
  }
  const baseOut =
    process.env.TERRAIN_OUT_DIR ??
    fileURLToPath(new URL(`../../../terrain/${mapId}`, import.meta.url));
  const outDir = process.env.TERRAIN_OUT_DIR ? join(baseOut, mapId) : baseOut;

  const profile = loadMapProfile(fileURLToPath(new URL("../profiles/map.json", import.meta.url)));

  console.log(`[terrain] map pipeline for "${mapId}" → ${outDir}`);
  fal.config({ credentials: key });
  const { webpPath } = await runMapPipeline({ fal, fetch }, { mapId, profile, outDir });
  console.log(`[terrain] done. final: ${webpPath}\n  intermediates in: ${outDir}`);
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the `gen:map` script**

In `packages/terrain/package.json`, add to `scripts` (after `gen:matrix`):

```json
    "gen:map": "tsx src/mapPipelineCli.ts",
```

- [ ] **Step 3: Document the env var**

Append to `.env.example` (create the line if the file lacks it):

```
# Directory for terrain pipeline outputs (intermediates + final webp). Each map gets a subdir.
TERRAIN_OUT_DIR=/mnt/ssd_pool/ssd_set/terrain-gen
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full terrain test + lint gates**

Run: `pnpm --filter @sengoku-jidai/terrain test`
Run repo lint/format (e.g. `pnpm lint` / `pnpm format:check` as the repo defines).
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/mapPipelineCli.ts packages/terrain/package.json .env.example
git commit -m "feat(terrain): gen:map CLI + TERRAIN_OUT_DIR wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Live smoke run + tuning loop (manual)

**Files:** none committed (output goes to `TERRAIN_OUT_DIR`).

This task has no automated test — it is the human-in-the-loop verification the design calls for (local image preview is unavailable to the agent).

- [ ] **Step 1: Ensure `.env` has both vars**

`.env` (git-ignored) must contain:
```
FAL_KEY=<the key>
TERRAIN_OUT_DIR=/mnt/ssd_pool/ssd_set/terrain-gen
```

- [ ] **Step 2: Run the pipeline for the rivers map**

Run (loading `.env` into the environment):
```bash
set -a; . ./.env; set +a
pnpm --filter @sengoku-jidai/terrain gen:map rivers
```
Expected: console prints the output dir; `/mnt/ssd_pool/ssd_set/terrain-gen/rivers/` contains `landMask.png`, `coastStroke.png`, `land.png`, `sea.png`, `composite.png`, `background.webp`.

- [ ] **Step 3: User reviews the output**

User inspects the six files. Checkpoints:
- `landMask.png` — coastline matches the board, hex facets acceptably rounded (tune `base.organicSigma`).
- `land.png` / `sea.png` — textures read as antique map material (tune prompts / `seed`).
- `composite.png` — coast is crisp and correct; no bleed.
- `background.webp` — land + sea read as one aged sheet (tune `harmonize`).

- [ ] **Step 4: Tune and re-run**

Adjust `profiles/map.json` per the review (seeds, prompts, `organicSigma`, `harmonize`), re-run Step 2. Repeat until satisfactory. Commit profile changes that improve the result:
```bash
git add packages/terrain/profiles/map.json
git commit -m "chore(terrain): tune map profile from review"
```

- [ ] **Step 5: Promote the chosen result (only when approved)**

When the user approves an image, copy it into the committed web asset (the pipeline never does this automatically):
```bash
cp /mnt/ssd_pool/ssd_set/terrain-gen/rivers/background.webp packages/web/src/assets/terrain/rivers.webp
git add packages/web/src/assets/terrain/rivers.webp
git commit -m "feat(terrain): ship mask-composite rivers background"
```

---

## Self-Review

**Spec coverage:**
- Principle (model = texture only, structure from SVG) → Tasks 2, 3, 4, 6. ✓
- `renderMasks` (crisp binary mask + organicize + coast stroke) → Task 2. ✓
- Shared SVG-prep factored out of `controlImage.ts` → Task 1. ✓
- `generateTexture` full-frame t2i → Task 3. ✓
- `compositeMap` + `harmonize` → Task 4. ✓
- `mapPipeline.ts` orchestration writing intermediates → Task 6. ✓
- `mapPipelineCli.ts` + `gen:map` + profile → Tasks 5, 7. ✓
- Output to external dir, committed asset untouched → Tasks 6, 7, 8 (Global Constraints). ✓
- Tests with fal mocked → every code task. ✓
- Optional i2i seam pass → deferred, noted in File Structure (YAGNI). ✓ (spec marks it optional/off)

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `TextureDeps` defined in Task 3, consumed in Task 6/7. `BoardMasks.landMask`/`coastStroke` from Task 2 feed `compositeMap` args in Task 4/6. `MapProfile` fields (`base.model`, `base.organicSigma`, `base.inkColor`, `base.strokeWidth`, `land`/`sea`, `harmonize`, `guidanceScale`, `numInferenceSteps`, `webpQuality`) defined in Task 5, consumed identically in Task 6. `prepBoardSvgMarkup` signature defined Task 1, consumed Task 2. ✓
