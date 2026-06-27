# Terrain Background Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a faded, antique-style terrain background image (coastlines following the hex land/sea data) and render it behind the SVG board vectors.

**Architecture:** A new dev-only workspace package `@sengoku-jidai/terrain` runs an offline pipeline: (1) render a 2-tone land/sea control image from the board SVG via Playwright, (2) send it to a hosted SDXL+ControlNet+IP-Adapter API (fal.ai) under a committed "style profile", (3) post-process to webp and commit the asset. The web app gains one additive change: `MapBoard` renders the committed webp as the bottom layer of the board SVG, with unowned tile fills made transparent so terrain shows through.

**Tech Stack:** TypeScript (ESM, NodeNext), Playwright (`@playwright/test`, already present), `@fal-ai/client`, `sharp`, `zod` (already present), Vitest. The engine (`@sengoku-jidai/engine`) is the source of truth for per-tile land/sea (`kind`).

## Global Constraints

- ESM only; `"type": "module"`; relative imports use the `.js` extension. Copy this from existing packages.
- Node `>=22` (global `fetch`, `Blob` available).
- Package manager is pnpm 9.15.2; run scripts with `corepack pnpm`.
- The terrain package is **dev-only**: never imported by `@sengoku-jidai/server` or `@sengoku-jidai/web` at runtime, and not added to the Dockerfile.
- Board SVG facts (verified): viewBox `0 0 1133.8602 1288.1589`; tiles are `<use id="tileN">` split across `#tile-land` / `#tile-sea`, which are **direct children of `#g1`** (`#g1` has `transform="translate(489.92961,1670.3293)"`); the shared tile geometry defs whose inline fill/stroke must be neutralized are `["path9","path9-2","path9-2-2","path9-5","path9-5-0"]`; geometry defs live in `#layer1` (`display:none`) and are referenced by `<use>`.
- Control image + generated output size: **1024 × 1160** (aspect ≈ the viewBox's 0.880, both multiples of 8).
- Secrets via env only (`FAL_KEY`); never commit keys. Generated webp assets are committed; the API is never called from CI or the server.

---

### Task 1: Scaffold the `@sengoku-jidai/terrain` dev package

**Files:**
- Create: `packages/terrain/package.json`
- Create: `packages/terrain/tsconfig.json`
- Create: `packages/terrain/src/index.ts`
- Modify: `.env.example` (add `FAL_KEY`)

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable/typecheckable workspace package `@sengoku-jidai/terrain` with deps `@fal-ai/client`, `sharp`, `@playwright/test`, `@sengoku-jidai/engine`, `zod`.

- [ ] **Step 1: Create `packages/terrain/package.json`**

```json
{
  "name": "@sengoku-jidai/terrain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "gen": "tsx src/cli.ts",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@sengoku-jidai/engine": "workspace:*",
    "@fal-ai/client": "^1.10.1",
    "sharp": "^0.35.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `packages/terrain/tsconfig.json`** (mirror the engine's typecheck config — `noEmit`, no `rootDir`, so including `test/` is fine; the package runs via `tsx`, no build step)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/terrain/src/index.ts`** (placeholder so the package resolves)

```ts
export const TERRAIN_PACKAGE = "@sengoku-jidai/terrain";
```

- [ ] **Step 4: Add `FAL_KEY` to `.env.example`**

Append this line to `.env.example`:

```
# fal.ai API key for the offline terrain-generation pipeline (packages/terrain). Not needed at runtime.
FAL_KEY=
```

- [ ] **Step 5: Install dependencies**

Run: `corepack pnpm install`
Expected: lockfile updates; `@fal-ai/client` and `sharp` resolved under `packages/terrain`.

- [ ] **Step 6: Verify typecheck passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/terrain/package.json packages/terrain/tsconfig.json packages/terrain/src/index.ts .env.example pnpm-lock.yaml
git commit -m "feat(terrain): scaffold dev-only terrain-generation package"
```

---

### Task 2: Control-image colour map (pure)

The fidelity-critical mapping: every map tile → white (land) or black (sea). Pure and fully tested.

**Files:**
- Create: `packages/terrain/src/controlImage.ts`
- Create: `packages/terrain/test/controlImage.test.ts`

**Interfaces:**
- Consumes: `MapDefinition`, `MapArea` from `@sengoku-jidai/engine`.
- Produces: `LAND_COLOR`, `SEA_COLOR` constants and `tileColorMap(map: MapDefinition): Record<string, string>` — maps each tile id to `LAND_COLOR`/`SEA_COLOR` by `kind`.

- [ ] **Step 1: Write the failing test** — `packages/terrain/test/controlImage.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { riversMap } from "@sengoku-jidai/engine";
import { LAND_COLOR, SEA_COLOR, tileColorMap } from "../src/controlImage.js";

describe("tileColorMap", () => {
  it("maps every tile to land-white or sea-black by kind", () => {
    const colors = tileColorMap(riversMap);
    // Every area is present.
    expect(Object.keys(colors).sort()).toEqual(Object.keys(riversMap.areas).sort());
    // Land vs sea map to the two colours.
    expect(colors.tile1).toBe(LAND_COLOR); // tile1 is land
    expect(colors.tile3).toBe(SEA_COLOR); // tile3 is sea
    // Only the two colours ever appear.
    for (const value of Object.values(colors)) {
      expect([LAND_COLOR, SEA_COLOR]).toContain(value);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: FAIL — cannot find `../src/controlImage.js`.

- [ ] **Step 3: Write minimal implementation** — `packages/terrain/src/controlImage.ts`

```ts
import type { MapDefinition } from "@sengoku-jidai/engine";

/** Control-image classes: land is white, sea (and everything outside the tiles) is black. */
export const LAND_COLOR = "#ffffff";
export const SEA_COLOR = "#000000";

/** Map every tile id in a map to its control-image colour by land/sea kind. */
export function tileColorMap(map: MapDefinition): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const area of Object.values(map.areas)) {
    colors[area.id] = area.kind === "land" ? LAND_COLOR : SEA_COLOR;
  }
  return colors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/controlImage.ts packages/terrain/test/controlImage.test.ts
git commit -m "feat(terrain): tile land/sea colour map for the control image"
```

---

### Task 3: Control-image renderer (Playwright)

Renders the 2-tone control image from the board SVG. Browser-dependent, so it is verified by a real render (not a CI unit test) — consistent with the repo's no-local-DOM-test norm; the produced `control.png` is eyeballed.

**Files:**
- Modify: `packages/terrain/src/controlImage.ts`

**Interfaces:**
- Consumes: `tileColorMap` (Task 2); the board SVG markup as a string; the `["path9","path9-2","path9-2-2","path9-5","path9-5-0"]` def ids.
- Produces: `renderControlImage(args: { svgMarkup: string; colors: Record<string, string>; width: number; height: number }): Promise<Buffer>` — a PNG buffer at `width × height`.

- [ ] **Step 1: Append the renderer to `packages/terrain/src/controlImage.ts`**

```ts
import { chromium } from "@playwright/test";

/** Shared tile geometry defs whose inline fill/stroke must be neutralized so each
 *  tile <use> can drive its own appearance (mirrors the web MapBoard prep). */
const TILE_GEOMETRY_DEFS = ["path9", "path9-2", "path9-2-2", "path9-5", "path9-5-0"];

/**
 * Render the land/sea control image from the board SVG. Approach:
 *  - black background rect behind everything (so sea + outside-the-tiles read as ocean),
 *  - hide every `#g1` child except the `#tile-land` / `#tile-sea` groups (no re-parenting,
 *    so every transform is preserved and coastlines match the board pixel-for-pixel),
 *  - neutralize the shared geometry defs, then fill each tile by its colour with no stroke
 *    (so adjacent same-class tiles merge and the only edge is the coastline),
 *  - size the SVG to width×height with preserveAspectRatio="none" and screenshot it.
 */
export async function renderControlImage(args: {
  svgMarkup: string;
  colors: Record<string, string>;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { svgMarkup, colors, width, height } = args;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><style>*{margin:0;padding:0}</style></head><body>${svgMarkup}</body></html>`,
      { waitUntil: "load" }
    );
    await page.evaluate(
      ({ colors, geometryDefs, width, height, seaColor }) => {
        const svg = document.querySelector("svg");
        if (!svg) {
          throw new Error("control render: no <svg> in markup");
        }
        const SVG_NS = "http://www.w3.org/2000/svg";
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.setAttribute("preserveAspectRatio", "none");

        // Black ocean background covering the whole viewBox, behind all tiles.
        const vb = svg.viewBox.baseVal;
        const bg = document.createElementNS(SVG_NS, "rect");
        bg.setAttribute("x", String(vb.x));
        bg.setAttribute("y", String(vb.y));
        bg.setAttribute("width", String(vb.width));
        bg.setAttribute("height", String(vb.height));
        bg.setAttribute("fill", seaColor);
        svg.insertBefore(bg, svg.firstChild);

        // Hide every feature/order/visual layer; keep only the tile groups.
        const g1 = svg.querySelector("#g1");
        if (g1) {
          for (const child of Array.from(g1.children)) {
            if (child.id !== "tile-land" && child.id !== "tile-sea") {
              (child as SVGElement).style.display = "none";
            }
          }
        }

        // Neutralize shared geometry def fill/stroke so per-tile fill wins.
        for (const id of geometryDefs) {
          const def = document.getElementById(id) as SVGElement | null;
          if (def) {
            def.style.fill = "inherit";
            def.style.stroke = "inherit";
          }
        }

        // Colour each tile by class; no stroke so same-class neighbours merge cleanly.
        for (const [tileId, color] of Object.entries(colors)) {
          const tile = document.getElementById(tileId) as SVGElement | null;
          if (!tile) {
            throw new Error(`control render: SVG has no element for tile "${tileId}"`);
          }
          tile.style.fill = color;
          tile.style.stroke = "none";
          tile.style.display = "inline";
        }
      },
      { colors, geometryDefs: TILE_GEOMETRY_DEFS, width, height, seaColor: SEA_COLOR }
    );
    const svgHandle = await page.$("svg");
    if (!svgHandle) {
      throw new Error("control render: no <svg> to screenshot");
    }
    return await svgHandle.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `corepack pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

> Note: no CI unit test launches a browser here (matches the repo's no-local-DOM-test convention). This function is exercised end-to-end by the CLI in Task 7, where `control.png` is written for visual inspection. Task 2's pure `tileColorMap` already covers the land/sea correctness that matters.

- [ ] **Step 3: Commit**

```bash
git add packages/terrain/src/controlImage.ts
git commit -m "feat(terrain): render land/sea control image from the board SVG via Playwright"
```

---

### Task 4: Style profile (type + loader + committed profile)

The shared style profile is what makes every map's background look like a sibling. Validated with zod.

**Files:**
- Create: `packages/terrain/src/styleProfile.ts`
- Create: `packages/terrain/profiles/antique.json`
- Create: `packages/terrain/profiles/README.md`
- Create: `packages/terrain/test/styleProfile.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StyleProfile` type and `loadStyleProfile(path: string): StyleProfile` (reads + zod-validates JSON; throws on invalid). Fields: `model`, `prompt`, `negativePrompt`, `seed`, `styleReference` (path, relative to the profile file), `controlImageKey`, `styleImageKey`, `extraInput` (record), `outputSize` `{ width, height }`, `webpQuality`.

- [ ] **Step 1: Write the failing test** — `packages/terrain/test/styleProfile.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStyleProfile } from "../src/styleProfile.js";

const ANTIQUE = fileURLToPath(new URL("../profiles/antique.json", import.meta.url));

describe("loadStyleProfile", () => {
  it("loads and validates the committed antique profile", () => {
    const profile = loadStyleProfile(ANTIQUE);
    expect(profile.outputSize).toEqual({ width: 1024, height: 1160 });
    expect(typeof profile.prompt).toBe("string");
    expect(profile.seed).toBeTypeOf("number");
  });

  it("throws a clear error on an invalid profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "profile-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ prompt: "x" }));
    expect(() => loadStyleProfile(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: FAIL — cannot find `../src/styleProfile.js`.

- [ ] **Step 3: Write the loader** — `packages/terrain/src/styleProfile.ts`

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const StyleProfileSchema = z.object({
  /** fal.ai model/endpoint id (an SDXL ControlNet + IP-Adapter pipeline). */
  model: z.string().min(1),
  prompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  seed: z.number().int(),
  /** Style reference image path, relative to the profile file (fed via IP-Adapter). */
  styleReference: z.string().min(1),
  /** Input key the chosen fal model expects for the ControlNet image URL. */
  controlImageKey: z.string().default("control_image_url"),
  /** Input key the chosen fal model expects for the IP-Adapter/style image URL. */
  styleImageKey: z.string().default("ip_adapter_image_url"),
  /** Any additional static input the model takes (strengths, steps, etc.). */
  extraInput: z.record(z.unknown()).default({}),
  outputSize: z.object({ width: z.number().int(), height: z.number().int() }),
  webpQuality: z.number().int().min(1).max(100).default(82)
});

export type StyleProfile = z.infer<typeof StyleProfileSchema> & {
  /** Absolute path to the style reference image, resolved from `styleReference`. */
  styleReferencePath: string;
};

/** Read and validate a style profile JSON file. Throws with a clear message on invalid input. */
export function loadStyleProfile(path: string): StyleProfile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = StyleProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid style profile at ${path}: ${parsed.error.message}`);
  }
  return {
    ...parsed.data,
    styleReferencePath: resolve(dirname(path), parsed.data.styleReference)
  };
}
```

- [ ] **Step 4: Create the committed profile** — `packages/terrain/profiles/antique.json`

```json
{
  "model": "fal-ai/sdxl-controlnet-union",
  "prompt": "antique hand-drawn cartography map, faded aged parchment, muted earthy terrain, soft watercolour landmasses, calm pale sea, subtle paper texture, vintage atlas, no text, no labels, no grid",
  "negativePrompt": "modern, satellite photo, vivid saturated colours, text, labels, lettering, borders, ui, neon, photorealistic",
  "seed": 1568,
  "styleReference": "antique-reference.png",
  "controlImageKey": "control_image_url",
  "styleImageKey": "ip_adapter_image_url",
  "extraInput": {
    "controlnet_conditioning_scale": 0.85,
    "num_inference_steps": 30
  },
  "outputSize": { "width": 1024, "height": 1160 },
  "webpQuality": 82
}
```

- [ ] **Step 5: Create `packages/terrain/profiles/README.md`** (documents the human-supplied reference image)

```markdown
# Style profiles

Each profile defines one shared art style, applied to every map so backgrounds
look like siblings. `antique.json` is the default.

## Required: a style reference image

`styleReference` points at an image (e.g. `antique-reference.png`) fed to the
model via IP-Adapter — it is the main style dial. **You must add this image**
before running the pipeline; it is curated art, not generated here. Recommended:
a single representative antique-map crop, ~1024px. Commit it alongside the profile.

## Tuning

- `prompt` / `negativePrompt` / `seed`: locked text + seed for consistency.
- `extraInput`: model-specific knobs (ControlNet strength, steps, IP-Adapter weight).
- `model` / `controlImageKey` / `styleImageKey`: confirm these against the chosen
  fal.ai model's input schema; defaults target an SDXL ControlNet-union pipeline.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add packages/terrain/src/styleProfile.ts packages/terrain/profiles/antique.json packages/terrain/profiles/README.md packages/terrain/test/styleProfile.test.ts
git commit -m "feat(terrain): style profile schema, loader, and committed antique profile"
```

---

### Task 5: fal.ai generation backend

A backend-agnostic adapter; the fal implementation takes its client and `fetch` as injected deps so tests never touch the network.

**Files:**
- Create: `packages/terrain/src/backend.ts`
- Create: `packages/terrain/test/backend.test.ts`

**Interfaces:**
- Consumes: `StyleProfile` (Task 4).
- Produces:
  - `interface TerrainBackend { generate(args: { control: Buffer; styleReference: Buffer; profile: StyleProfile }): Promise<Buffer> }`
  - `createFalBackend(deps: { fal: FalClient; fetch: FetchFn }): TerrainBackend` where
    `FalClient = { storage: { upload(blob: Blob): Promise<string> }; subscribe(model: string, opts: { input: Record<string, unknown> }): Promise<{ data: unknown }> }`
    and `FetchFn = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>`.

- [ ] **Step 1: Write the failing test** — `packages/terrain/test/backend.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { createFalBackend } from "../src/backend.js";
import type { StyleProfile } from "../src/styleProfile.js";

const profile: StyleProfile = {
  model: "fal-ai/test-model",
  prompt: "antique map",
  negativePrompt: "modern",
  seed: 42,
  styleReference: "ref.png",
  styleReferencePath: "/abs/ref.png",
  controlImageKey: "control_image_url",
  styleImageKey: "ip_adapter_image_url",
  extraInput: { controlnet_conditioning_scale: 0.85 },
  outputSize: { width: 1024, height: 1160 },
  webpQuality: 82
};

describe("createFalBackend", () => {
  it("uploads images, calls the model with the assembled input, and returns the result bytes", async () => {
    const uploads: Blob[] = [];
    const fal = {
      storage: {
        upload: vi.fn(async (blob: Blob) => {
          uploads.push(blob);
          return uploads.length === 1 ? "https://up/control.png" : "https://up/ref.png";
        })
      },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/result.png" }] } }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("PNGBYTES").buffer
    }));

    const backend = createFalBackend({ fal, fetch });
    const out = await backend.generate({
      control: Buffer.from("control"),
      styleReference: Buffer.from("ref"),
      profile
    });

    // Two uploads (control, then style reference).
    expect(fal.storage.upload).toHaveBeenCalledTimes(2);
    // Model + assembled input.
    const [model, opts] = fal.subscribe.mock.calls[0]!; // non-null: asserted called above
    expect(model).toBe("fal-ai/test-model");
    expect(opts.input).toMatchObject({
      prompt: "antique map",
      negative_prompt: "modern",
      seed: 42,
      control_image_url: "https://up/control.png",
      ip_adapter_image_url: "https://up/ref.png",
      controlnet_conditioning_scale: 0.85
    });
    // Result bytes are the fetched image.
    expect(fetch).toHaveBeenCalledWith("https://out/result.png");
    expect(out.toString()).toBe("PNGBYTES");
  });

  it("throws when the result image fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn(async () => "https://up/x.png") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/r.png" }] } }))
    };
    const fetch = vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    const backend = createFalBackend({ fal, fetch });
    await expect(
      backend.generate({ control: Buffer.from("c"), styleReference: Buffer.from("r"), profile })
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: FAIL — cannot find `../src/backend.js`.

- [ ] **Step 3: Write the backend** — `packages/terrain/src/backend.ts`

```ts
import type { StyleProfile } from "./styleProfile.js";

export interface TerrainBackend {
  generate(args: { control: Buffer; styleReference: Buffer; profile: StyleProfile }): Promise<Buffer>;
}

export interface FalClient {
  storage: { upload(blob: Blob): Promise<string> };
  subscribe(model: string, opts: { input: Record<string, unknown> }): Promise<{ data: unknown }>;
}

export type FetchFn = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Pull the first output image URL out of a fal result payload (`{ images: [{ url }] }`). */
function firstImageUrl(data: unknown): string {
  const images = (data as { images?: Array<{ url?: string }> })?.images;
  const url = images?.[0]?.url;
  if (!url) {
    throw new Error(`fal result had no image url: ${JSON.stringify(data)}`);
  }
  return url;
}

/** fal.ai-backed terrain generator. `fal` and `fetch` are injected so tests stay offline. */
export function createFalBackend(deps: { fal: FalClient; fetch: FetchFn }): TerrainBackend {
  const { fal, fetch } = deps;
  return {
    async generate({ control, styleReference, profile }) {
      const controlUrl = await fal.storage.upload(new Blob([control], { type: "image/png" }));
      const styleUrl = await fal.storage.upload(new Blob([styleReference], { type: "image/png" }));

      const input: Record<string, unknown> = {
        ...profile.extraInput,
        prompt: profile.prompt,
        negative_prompt: profile.negativePrompt,
        seed: profile.seed,
        image_size: { width: profile.outputSize.width, height: profile.outputSize.height },
        [profile.controlImageKey]: controlUrl,
        [profile.styleImageKey]: styleUrl
      };

      const result = await fal.subscribe(profile.model, { input });
      const url = firstImageUrl(result.data);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`fetching generated image failed: ${response.status} ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/backend.ts packages/terrain/test/backend.test.ts
git commit -m "feat(terrain): fal.ai generation backend behind an injectable interface"
```

---

### Task 6: Post-processing to webp

**Files:**
- Create: `packages/terrain/src/postprocess.ts`
- Create: `packages/terrain/test/postprocess.test.ts`

**Interfaces:**
- Consumes: nothing (takes a PNG buffer).
- Produces: `toWebp(png: Buffer, opts: { width: number; height: number; quality: number }): Promise<Buffer>` — resizes to `width × height` and encodes webp.

- [ ] **Step 1: Write the failing test** — `packages/terrain/test/postprocess.test.ts`

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { toWebp } from "../src/postprocess.js";

describe("toWebp", () => {
  it("resizes and encodes a webp of the requested size", async () => {
    // A small red PNG as input.
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 60, b: 40 } }
    })
      .png()
      .toBuffer();

    const out = await toWebp(png, { width: 128, height: 145, quality: 80 });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(145);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: FAIL — cannot find `../src/postprocess.js`.

- [ ] **Step 3: Write the implementation** — `packages/terrain/src/postprocess.ts`

```ts
import sharp from "sharp";

/** Resize a generated PNG to the final dimensions and encode it as webp. */
export async function toWebp(
  png: Buffer,
  opts: { width: number; height: number; quality: number }
): Promise<Buffer> {
  return await sharp(png)
    .resize(opts.width, opts.height, { fit: "fill" })
    .webp({ quality: opts.quality })
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/postprocess.ts packages/terrain/test/postprocess.test.ts
git commit -m "feat(terrain): webp post-processing of generated terrain"
```

---

### Task 7: Map-source registry + CLI orchestrator

Wires the stages into `pnpm --filter @sengoku-jidai/terrain gen <mapId>`. The CLI itself is verified by a real run (it needs `FAL_KEY` + a reference image); its only pure unit is the map-source resolver.

**Files:**
- Create: `packages/terrain/src/mapSources.ts`
- Create: `packages/terrain/test/mapSources.test.ts`
- Create: `packages/terrain/src/cli.ts`

**Interfaces:**
- Consumes: `getMap` from `@sengoku-jidai/engine`; `tileColorMap` + `renderControlImage` (Tasks 2–3); `loadStyleProfile` (Task 4); `createFalBackend` (Task 5); `toWebp` (Task 6).
- Produces: `mapSvgPath(mapId: string): string` (absolute path to that map's board SVG; throws on unknown map) and a runnable CLI.

- [ ] **Step 1: Write the failing test** — `packages/terrain/test/mapSources.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mapSvgPath } from "../src/mapSources.js";

describe("mapSvgPath", () => {
  it("resolves the rivers map SVG to an existing file", () => {
    const path = mapSvgPath("rivers");
    expect(path.endsWith("cloned_map.svg")).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("throws on an unknown map id", () => {
    expect(() => mapSvgPath("nope")).toThrow(/unknown map/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: FAIL — cannot find `../src/mapSources.js`.

- [ ] **Step 3: Write the resolver** — `packages/terrain/src/mapSources.ts`

```ts
import { fileURLToPath } from "node:url";

/** Repo root, relative to packages/terrain/src/. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Board SVG path per map id (relative to repo root). Future maps add an entry here. */
const SVG_BY_MAP: Record<string, string> = {
  rivers: "cloned_map.svg"
};

/** Absolute path to a map's board SVG. Throws on an unknown map id. */
export function mapSvgPath(mapId: string): string {
  const rel = SVG_BY_MAP[mapId];
  if (!rel) {
    throw new Error(`Unknown map "${mapId}" — add its SVG to SVG_BY_MAP in mapSources.ts`);
  }
  return repoRoot + rel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS.

- [ ] **Step 5: Write the CLI** — `packages/terrain/src/cli.ts`

```ts
import { fal } from "@fal-ai/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMap } from "@sengoku-jidai/engine";
import { createFalBackend } from "./backend.js";
import { renderControlImage, tileColorMap } from "./controlImage.js";
import { mapSvgPath } from "./mapSources.js";
import { toWebp } from "./postprocess.js";
import { loadStyleProfile } from "./styleProfile.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen <mapId>");
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set (see .env.example)");
  }

  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  const profilePath = fileURLToPath(new URL("../profiles/antique.json", import.meta.url));
  const profile = loadStyleProfile(profilePath);
  const styleReference = readFileSync(profile.styleReferencePath); // throws with a clear ENOENT if missing

  // Stage 1: control image (also saved for inspection).
  console.log(`[terrain] rendering control image for "${mapId}"…`);
  const control = await renderControlImage({
    svgMarkup,
    colors: tileColorMap(map),
    width: profile.outputSize.width,
    height: profile.outputSize.height
  });
  const sourceDir = `${repoRoot}terrain/${mapId}`;
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(`${sourceDir}/control.png`, control);

  // Stage 2: generate.
  console.log(`[terrain] generating terrain via ${profile.model}…`);
  fal.config({ credentials: key });
  const backend = createFalBackend({ fal, fetch });
  const generated = await backend.generate({ control, styleReference, profile });
  writeFileSync(`${sourceDir}/generated.png`, generated);

  // Stage 3: post-process + write the committed web asset.
  const webp = await toWebp(generated, {
    width: profile.outputSize.width,
    height: profile.outputSize.height,
    quality: profile.webpQuality
  });
  const assetPath = `${repoRoot}packages/web/src/assets/terrain/${mapId}.webp`;
  mkdirSync(dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, webp);

  console.log(`[terrain] done:\n  control:   ${sourceDir}/control.png\n  asset:     ${assetPath}`);
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Verify typecheck passes**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

- [ ] **Step 7: Manual end-to-end check (developer machine; requires `FAL_KEY` + a reference image)**

1. Add a style reference image at `packages/terrain/profiles/antique-reference.png` (see `profiles/README.md`).
2. Build the engine (the CLI imports its built `dist`), then run the pipeline:
   `corepack pnpm build:libs && FAL_KEY=… corepack pnpm --filter @sengoku-jidai/terrain gen rivers`
3. Inspect `terrain/rivers/control.png` — landmasses white on black, coastline matching the board.
4. Inspect `packages/web/src/assets/terrain/rivers.webp` — antique terrain whose coastline follows the control image.
5. If the fal call rejects on unknown input keys, reconcile `model` / `controlImageKey` / `styleImageKey` / `extraInput` in `profiles/antique.json` with the chosen model's schema, then re-run.

> If the chosen fal model's input schema differs from the SDXL-controlnet-union defaults, that reconciliation is config-only (`antique.json`) — no code change. The `image_size`, `prompt`, `negative_prompt`, and `seed` keys are standard across fal SDXL pipelines.

- [ ] **Step 8: Commit** (code + the curated reference image + the generated asset/sources)

```bash
git add packages/terrain/src/mapSources.ts packages/terrain/test/mapSources.test.ts packages/terrain/src/cli.ts \
        packages/terrain/profiles/antique-reference.png \
        terrain/rivers/control.png terrain/rivers/generated.png \
        packages/web/src/assets/terrain/rivers.webp
git commit -m "feat(terrain): CLI pipeline + generated Rivers terrain asset"
```

---

### Task 8: Web — terrain asset resolver

Resolves a committed terrain webp by map id, with a graceful null when none exists. The lookup is a pure, tested function; the actual asset discovery uses Vite's `import.meta.glob` so a missing asset is simply absent (no build-time import error).

**Files:**
- Create: `packages/web/src/components/board/terrainImages.ts`
- Create: `packages/web/test/board/terrainImages.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveTerrain(modules: Record<string, string>, mapId: string): string | null` (pure) and `terrainImage(mapId: string): string | null` (wraps the glob).

- [ ] **Step 1: Write the failing test** — `packages/web/test/board/terrainImages.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { resolveTerrain } from "../../src/components/board/terrainImages.js";

const modules = {
  "/src/assets/terrain/rivers.webp": "/assets/rivers.hash.webp"
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

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — cannot find `terrainImages.js`.

- [ ] **Step 3: Write the implementation** — `packages/web/src/components/board/terrainImages.ts`

```ts
/**
 * Committed terrain background assets, keyed by map id. Discovered via Vite's glob so a
 * map without a generated asset is simply absent (graceful fallback to flat tile fills).
 * Each module's key is its source path; the value is the emitted asset URL.
 */
const TERRAIN_MODULES = import.meta.glob("../../assets/terrain/*.webp", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

/** Pure lookup: find the terrain URL whose filename matches `<mapId>.webp`, else null. */
export function resolveTerrain(modules: Record<string, string>, mapId: string): string | null {
  const suffix = `/${mapId}.webp`;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/terrainImages.ts packages/web/test/board/terrainImages.test.ts
git commit -m "feat(web): resolve committed terrain background assets by map id"
```

---

### Task 9: Web — render the terrain layer in MapBoard

Insert the terrain `<image>` as the bottom layer of the board SVG and make unowned/supplied tile fills transparent when terrain is present, so terrain shows through while every existing overlay (supply tints, highlights, unit stacks, selection) still paints above. The attribute builder is pure + tested; the DOM insertion and fill change are verified by the Browser Smoke Test (the repo does not unit-test SVG/DOM rendering).

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx`
- Create: `packages/web/test/board/terrainLayer.test.ts`
- Modify: `packages/web/src/App.tsx:786-798` (pass `terrainUrl`)

**Interfaces:**
- Consumes: `terrainImage` (Task 8); `MapBoardProps`.
- Produces: a new optional `terrainUrl?: string | null` prop on `MapBoard`; an exported pure helper `terrainImageAttrs(viewBox: { x: number; y: number; width: number; height: number })` returning the `<image>` attribute values.

- [ ] **Step 1: Write the failing test** — `packages/web/test/board/terrainLayer.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { terrainImageAttrs } from "../../src/components/board/MapBoard.js";

describe("terrainImageAttrs", () => {
  it("covers the full viewBox with no aspect distortion-compensation", () => {
    const attrs = terrainImageAttrs({ x: 0, y: 0, width: 1133.8602, height: 1288.1589 });
    expect(attrs).toEqual({
      x: 0,
      y: 0,
      width: 1133.8602,
      height: 1288.1589,
      preserveAspectRatio: "none"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — `terrainImageAttrs` is not exported.

- [ ] **Step 3: Add the pure helper + constants to `MapBoard.tsx`**

Near the top of `packages/web/src/components/board/MapBoard.tsx` (after the existing `const OVERLAY_ID = "map-overlay";` line), add:

```ts
const TERRAIN_LAYER_ID = "map-terrain";

/** `<image>` attributes that stretch the terrain across the full viewBox. The terrain webp is
 *  rendered at the viewBox aspect, so `preserveAspectRatio="none"` aligns it 1:1 with the tiles
 *  (no cropping of coastal edges). */
export function terrainImageAttrs(viewBox: { x: number; y: number; width: number; height: number }) {
  return {
    x: viewBox.x,
    y: viewBox.y,
    width: viewBox.width,
    height: viewBox.height,
    preserveAspectRatio: "none" as const
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS.

- [ ] **Step 5: Add the `terrainUrl` prop to `MapBoardProps`**

In the `MapBoardProps` interface in `MapBoard.tsx`, add after `pendingAttack?…;`:

```ts
  /** Committed terrain background for the active map, painted behind all tiles. Null = flat fills. */
  terrainUrl?: string | null;
```

- [ ] **Step 6: Insert/remove the terrain `<image>` as the SVG's first child**

Add this helper above the `MapBoard` component (e.g. after `resetOverlay`):

```ts
/** Insert (or update/remove) the terrain background as the first child of the SVG, so it paints
 *  beneath every tile and overlay. */
function applyTerrain(svg: SVGSVGElement, terrainUrl: string | null | undefined): void {
  const existing = svg.querySelector<SVGImageElement>(`#${TERRAIN_LAYER_ID}`);
  if (!terrainUrl) {
    existing?.remove();
    return;
  }
  const image = existing ?? document.createElementNS(SVG_NS, "image");
  if (!existing) {
    image.setAttribute("id", TERRAIN_LAYER_ID);
    image.setAttribute("pointer-events", "none");
    svg.insertBefore(image, svg.firstChild);
  }
  const attrs = terrainImageAttrs(svg.viewBox.baseVal);
  image.setAttribute("x", String(attrs.x));
  image.setAttribute("y", String(attrs.y));
  image.setAttribute("width", String(attrs.width));
  image.setAttribute("height", String(attrs.height));
  image.setAttribute("preserveAspectRatio", attrs.preserveAspectRatio);
  image.setAttribute("href", terrainUrl);
  image.setAttributeNS(XLINK_NS, "xlink:href", terrainUrl);
}
```

- [ ] **Step 7: Make base tile fills transparent when terrain is present**

In `decorate`, thread a `hasTerrain` flag. Change the `DecorateInput` interface to add `hasTerrain?: boolean;`, destructure it in `decorate`, and change the unowned/supplied fill assignment (currently around `MapBoard.tsx:409`):

Replace:

```ts
    tile.style.fill =
      area.owner === null || isSupplied
        ? (tile.dataset.authoredFill ?? (area.kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL))
        : tileFill(area);
```

with:

```ts
    if (area.owner === null || isSupplied) {
      // With terrain behind the board, let it show through unowned/supplied tiles (the
      // hex stroke grid still paints on top); otherwise keep the authored flat fill.
      tile.style.fill = hasTerrain
        ? "transparent"
        : (tile.dataset.authoredFill ?? (area.kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL));
    } else {
      tile.style.fill = tileFill(area);
    }
```

- [ ] **Step 8: Wire `terrainUrl` through the component**

In the `MapBoard` function signature destructuring, add `terrainUrl` to the params. In the inject `useEffect` (the one that sets `host.innerHTML`) call `applyTerrain(svg, terrainUrl)` right after `prepareSvg(svg);`. In the re-decorate `useEffect`, call `applyTerrain(svg, terrainUrl)` before `decorate(...)`, pass `hasTerrain: terrainUrl != null` into the `decorate` input object, and add `terrainUrl` to that effect's dependency array.

Concretely, the inject effect becomes:

```ts
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = rawMapSvg;
    const svg = host.querySelector("svg");
    if (svg) {
      prepareSvg(svg);
      applyTerrain(svg, terrainUrl);
    }
  }, [terrainUrl]);
```

and the re-decorate effect's body becomes:

```ts
    const svg = hostRef.current?.querySelector("svg");
    if (svg) {
      applyTerrain(svg, terrainUrl);
      decorate(svg, {
        areas,
        selectedAreaId,
        actionSpaces,
        onSelectArea,
        legalTargetIds,
        sourceIds,
        onSourceClick,
        stagedCounts,
        activeSourceId,
        pendingAttack,
        hasTerrain: terrainUrl != null
      });
    }
```

with `terrainUrl` added to that effect's dependency array.

- [ ] **Step 9: Pass `terrainUrl` from `App.tsx`**

Add the import near the other board imports in `App.tsx`:

```ts
import { terrainImage } from "./components/board/terrainImages.js";
```

In the `<MapBoard …/>` JSX (around `App.tsx:786`), add the prop:

```tsx
            terrainUrl={terrainImage(game.view.mapId)}
```

- [ ] **Step 10: Verify the web package typechecks and tests pass**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm --filter @sengoku-jidai/web test`
Expected: no type errors; all tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/web/test/board/terrainLayer.test.ts packages/web/src/App.tsx
git commit -m "feat(web): render antique terrain behind the board with transparent tile fills"
```

---

### Task 10: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full workspace gate**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint`
Expected: all green. (The terrain package's tests run as part of `pnpm -r test`; no test hits the network or launches a browser.)

- [ ] **Step 2: Push and let CI run the Browser Smoke Test**

The terrain layer's visual rendering (image present, coastline alignment, overlays still on top) is verified by CI's Browser Smoke Test, since there is no local browser verification. Open a PR and confirm the smoke test passes.

---

## Notes for the implementer

- **Why no browser unit test for the renderer / MapBoard DOM:** the web package has no jsdom; existing tests (e.g. `combatPanel.test.ts`) test pure logic only. We follow that: pure functions (`tileColorMap`, `loadStyleProfile`, `createFalBackend`, `toWebp`, `mapSvgPath`, `resolveTerrain`, `terrainImageAttrs`) are unit-tested; SVG/DOM behaviour is verified by the CLI's `control.png` output and CI's Browser Smoke Test.
- **Style consistency across future maps** comes entirely from the shared `profiles/antique.json` + reference image; adding a map only needs an `SVG_BY_MAP` entry, a `gen <mapId>` run, and committing the resulting `<mapId>.webp`.
- **Backend swap (fal → Replicate):** implement another `TerrainBackend` (e.g. `createReplicateBackend`) with the same interface and select it in `cli.ts`; nothing else changes.
```
