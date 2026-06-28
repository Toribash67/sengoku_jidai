# Terrain Comparison Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gen:matrix` command to `packages/terrain` that generates a labelled contact sheet of terrain candidates across several fal models × generation approaches × antique-map aesthetics, so we can eyeball and pick a winner instead of guessing at one img2img recipe.

**Architecture:** A curated candidate list in `profiles/matrix.json` (zod-validated) drives a CLI that renders the colour base once, runs each candidate through a per-method fal input builder, writes per-candidate PNGs, and composites a labelled grid PNG via `sharp`. Nothing touches the committed web `.webp` or the default `antique.json`; promotion of a winner is a manual follow-up. All fal interaction is behind injected `fal`/`fetch` deps so tests stay fully offline.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod, sharp, `@fal-ai/client`, vitest, tsx.

## Global Constraints

- **ESM imports** use `.js` specifiers even for `.ts` sources (e.g. `import { x } from "./backend.js"`).
- **All validation** uses zod, mirroring `styleProfile.ts`.
- **No live fal in tests.** Every test injects fake `fal`/`fetch` or uses tiny in-memory `sharp` buffers, mirroring `backend.test.ts` / `postprocess.test.ts`.
- **Tests** run with `pnpm --filter @sengoku-jidai/terrain test` (vitest). Typecheck with `pnpm --filter @sengoku-jidai/terrain typecheck`.
- **Do not modify** `profiles/antique.json`, `src/cli.ts` generation behaviour, or any committed `packages/web/src/assets/terrain/*.webp` in this work.
- **Candidate labels** must match `^[a-z0-9-]+$` (used directly as PNG filenames).
- **Seed is fixed** (`1568`) across all candidates for fair comparison.
- **Output dims** stay `1024 × 1164` (board viewBox aspect), as in `antique.json`.

---

## File Structure

**Create:**
- `packages/terrain/src/matrixProfile.ts` — zod schema + `loadMatrixConfig` for the candidate list.
- `packages/terrain/src/matrixBackend.ts` — `buildCandidateInput` (pure, per-method fal input) + `generateCandidate` (subscribe + fetch bytes).
- `packages/terrain/src/contactSheet.ts` — `gridLayout` (pure grid math) + `buildContactSheet` (sharp composite).
- `packages/terrain/src/matrixCli.ts` — `gen:matrix <mapId>` glue.
- `packages/terrain/profiles/matrix.json` — the 15 committed candidates.
- `packages/terrain/test/matrixProfile.test.ts`, `test/matrixBackend.test.ts`, `test/contactSheet.test.ts`.

**Modify:**
- `packages/terrain/src/backend.ts` — export `firstImageUrl` (currently private) for reuse.
- `packages/terrain/src/pipeline.ts` — narrow `renderMapBase`'s parameter type; add `candidatesDir`.
- `packages/terrain/package.json` — add `"gen:matrix"` script.
- `packages/terrain/profiles/README.md` — document the harness, verified fal endpoints, and manual promotion.

---

## Task 1: Verify fal endpoints & params, record them

The matrix calls **paid** fal endpoints. Before writing any candidate config or input
builder, confirm the exact endpoint ids and input parameter names from fal's current
docs, so we don't burn calls on 404s or wrong params. This task produces a verified
reference table committed into `profiles/README.md`; later tasks consume it.

**Files:**
- Modify: `packages/terrain/profiles/README.md`

**Interfaces:**
- Produces: a confirmed mapping `method → { endpointId, imageParamName, strengthParamName, extras }` that Task 3 (matrix.json) and Task 4 (`buildCandidateInput`) rely on.

- [ ] **Step 1: Fetch and confirm each endpoint's docs**

Use WebFetch on the fal model pages (search fal.ai/models if a URL 404s) and record, for
each, the exact endpoint id and the input field that takes the source image + the
strength/conditioning field:

- Flux dev image-to-image — start from `https://fal.ai/models/fal-ai/flux/dev/image-to-image` (baseline; already in use, confirm unchanged: `image_url`, `strength`, `image_size`).
- Flux ControlNet **canny** — find the current canny endpoint (candidates: `fal-ai/flux-control-lora-canny`, `fal-ai/flux-controlnet-canny`). Confirm the control-image field name (`control_image_url` vs a `controlnets` array) and the conditioning field (`controlnet_conditioning_scale`).
- Recraft V3 image-to-image — find the i2i endpoint (candidate: `fal-ai/recraft-v3/image-to-image`). Confirm `image_url`/`strength` and whether it takes a `style` field.
- Fast-SDXL image-to-image with LoRA — `fal-ai/fast-sdxl/image-to-image`. Confirm the `loras` array shape (`[{ path, scale }]`) and pick **one** antique-cartography / fantasy-map LoRA URL that loads on fal (search civitai/HuggingFace; record the chosen URL).
- SD 3.5 Large image-to-image — find the i2i endpoint (candidate: `fal-ai/stable-diffusion-v35-large/image-to-image`). Confirm `image_url`/`strength`.

- [ ] **Step 2: Write the verified table into the README**

Add a `## Verified fal endpoints (matrix)` section to `packages/terrain/profiles/README.md`
with one row per method: method tag, endpoint id, image-param name, strength/conditioning
param name, any extras (e.g. chosen LoRA URL). Note the date verified.

- [ ] **Step 3: Commit**

```bash
git add packages/terrain/profiles/README.md
git commit -m "docs(terrain): verified fal endpoints for the comparison matrix"
```

> If any confirmed field name differs from the assumptions coded in Task 3/Task 4 below,
> update those tasks' values (and their tests) to the verified name as you implement them.

---

## Task 2: Matrix config schema + loader

**Files:**
- Create: `packages/terrain/src/matrixProfile.ts`
- Test: `packages/terrain/test/matrixProfile.test.ts`

**Interfaces:**
- Produces:
  - `Method` = `"flux-img2img" | "flux-controlnet-canny" | "recraft-v3" | "sdxl-map-lora" | "sd35-large"`
  - `type Candidate = { label: string; method: Method; model: string; prompt: string; seed: number; strength?: number; conditioningScale?: number; loraUrl?: string; guidanceScale: number; numInferenceSteps: number; enableSafetyChecker: boolean }`
  - `type MatrixConfig = { base: { landColor: string; seaColor: string; blurSigma: number; outputSize: { width: number; height: number } }; columns: number; candidates: Candidate[] }`
  - `loadMatrixConfig(path: string): MatrixConfig`

- [ ] **Step 1: Write the failing test**

```ts
// packages/terrain/test/matrixProfile.test.ts
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMatrixConfig } from "../src/matrixProfile.js";

function writeConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "matrix-"));
  const path = join(dir, "matrix.json");
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

const validCandidate = {
  label: "flux-i2i-parchment",
  method: "flux-img2img",
  model: "fal-ai/flux/dev/image-to-image",
  prompt: "antique map",
  seed: 1568,
  strength: 0.9
};

const validConfig = {
  base: { landColor: "#7e8c5a", seaColor: "#566f80", outputSize: { width: 1024, height: 1164 } },
  candidates: [validCandidate]
};

describe("loadMatrixConfig", () => {
  it("loads a valid config and applies defaults", () => {
    const cfg = loadMatrixConfig(writeConfig(validConfig));
    expect(cfg.columns).toBe(3); // default
    expect(cfg.base.blurSigma).toBe(4); // default
    expect(cfg.candidates[0]!.guidanceScale).toBe(3.5); // default
    expect(cfg.candidates[0]!.numInferenceSteps).toBe(34); // default
    expect(cfg.candidates[0]!.enableSafetyChecker).toBe(false); // default
  });

  it("rejects an invalid method", () => {
    const bad = { ...validConfig, candidates: [{ ...validCandidate, method: "midjourney" }] };
    expect(() => loadMatrixConfig(writeConfig(bad))).toThrow();
  });

  it("rejects a label with illegal characters", () => {
    const bad = { ...validConfig, candidates: [{ ...validCandidate, label: "Flux I2I" }] };
    expect(() => loadMatrixConfig(writeConfig(bad))).toThrow();
  });

  it("rejects duplicate labels", () => {
    const bad = { ...validConfig, candidates: [validCandidate, validCandidate] };
    expect(() => loadMatrixConfig(writeConfig(bad))).toThrow(/duplicate|unique/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test matrixProfile`
Expected: FAIL — cannot resolve `../src/matrixProfile.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/terrain/src/matrixProfile.ts
import { readFileSync } from "node:fs";
import { z } from "zod";

export const MethodSchema = z.enum([
  "flux-img2img",
  "flux-controlnet-canny",
  "recraft-v3",
  "sdxl-map-lora",
  "sd35-large"
]);
export type Method = z.infer<typeof MethodSchema>;

const CandidateSchema = z.object({
  /** Unique, filename-safe identifier; also the contact-sheet caption. */
  label: z.string().regex(/^[a-z0-9-]+$/, "label must be lowercase kebab-case"),
  method: MethodSchema,
  /** fal endpoint id for this candidate. */
  model: z.string().min(1),
  prompt: z.string().min(1),
  seed: z.number().int(),
  /** img2img / image-to-image denoise strength. */
  strength: z.number().min(0).max(1).optional(),
  /** ControlNet conditioning scale (how tightly the coastline is followed). */
  conditioningScale: z.number().min(0).max(2).optional(),
  /** LoRA weights URL (sdxl-map-lora). */
  loraUrl: z.string().url().optional(),
  guidanceScale: z.number().default(3.5),
  numInferenceSteps: z.number().int().default(34),
  enableSafetyChecker: z.boolean().default(false)
});
export type Candidate = z.infer<typeof CandidateSchema>;

const MatrixConfigSchema = z.object({
  /** Shared colour base + output dims fed to every candidate. */
  base: z.object({
    landColor: z.string(),
    seaColor: z.string(),
    blurSigma: z.number().min(0).default(4),
    outputSize: z.object({ width: z.number().int(), height: z.number().int() })
  }),
  /** Contact-sheet column count (rows group by method when ordered model-major). */
  columns: z.number().int().min(1).default(3),
  candidates: z
    .array(CandidateSchema)
    .min(1)
    .refine(
      (cs) => new Set(cs.map((c) => c.label)).size === cs.length,
      "candidate labels must be unique"
    )
});
export type MatrixConfig = z.infer<typeof MatrixConfigSchema>;

/** Read and validate a matrix config JSON file. Throws with a clear message on invalid input. */
export function loadMatrixConfig(path: string): MatrixConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = MatrixConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid matrix config at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test matrixProfile`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/matrixProfile.ts packages/terrain/test/matrixProfile.test.ts
git commit -m "feat(terrain): matrix candidate config schema + loader"
```

---

## Task 3: Author the committed matrix.json

**Files:**
- Create: `packages/terrain/profiles/matrix.json`
- Test: `packages/terrain/test/matrixProfile.test.ts` (add one case)

**Interfaces:**
- Consumes: `loadMatrixConfig` (Task 2).
- Produces: a committed `profiles/matrix.json` with 15 candidates (5 methods × 3 aesthetics), ordered model-major, `columns: 3`.

- [ ] **Step 1: Write the failing test (committed file loads)**

Add to `packages/terrain/test/matrixProfile.test.ts`:

```ts
import { fileURLToPath } from "node:url";

const COMMITTED = fileURLToPath(new URL("../profiles/matrix.json", import.meta.url));

describe("committed matrix.json", () => {
  it("loads, has 15 candidates and 3 columns", () => {
    const cfg = loadMatrixConfig(COMMITTED);
    expect(cfg.columns).toBe(3);
    expect(cfg.candidates).toHaveLength(15);
    // 5 distinct methods present.
    expect(new Set(cfg.candidates.map((c) => c.method)).size).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test matrixProfile`
Expected: FAIL — `matrix.json` does not exist (ENOENT).

- [ ] **Step 3: Write the committed matrix.json**

Use the endpoint ids and the chosen LoRA URL **verified in Task 1**. If a verified id
differs from the value below, use the verified one. The three prompts are reused across
methods; only `method`/`model`/`label`/params vary. Ordered model-major (each row of 3 =
one method across parchment / military / sumie).

```json
{
  "base": {
    "landColor": "#7e8c5a",
    "seaColor": "#566f80",
    "blurSigma": 4,
    "outputSize": { "width": 1024, "height": 1164 }
  },
  "columns": 3,
  "candidates": [
    { "label": "flux-i2i-parchment", "method": "flux-img2img", "model": "fal-ai/flux/dev/image-to-image", "seed": 1568, "strength": 0.9,
      "prompt": "antique hand-drawn map of feudal Japan, aged sepia parchment, top-down bird's-eye cartography, forested green land and faded blue sea, tiny Sengoku-era castles, torii gates and pagodas drawn as small pictograms not to scale, mountains as little drawn peaks, compass rose, weathered ink linework, vintage watercolour wash, no modern text, no grid, no horizon" },
    { "label": "flux-i2i-military", "method": "flux-img2img", "model": "fal-ai/flux/dev/image-to-image", "seed": 1568, "strength": 0.9,
      "prompt": "antique Japanese military campaign map (ezu) of the Sengoku period, top-down, muted earth tones on aged paper, drawn fortifications and castle glyphs not to scale, roads and domain boundaries, small town markers, forested land and calm sea, hand-inked, weathered, no modern text, no grid, no horizon" },
    { "label": "flux-i2i-sumie", "method": "flux-img2img", "model": "fal-ai/flux/dev/image-to-image", "seed": 1568, "strength": 0.9,
      "prompt": "sumi-e ink wash map on aged rice paper, top-down, sparse and elegant, black brush strokes, mountains and pine groves as ink strokes, small castle and pagoda ink pictograms not to scale, pale grey-blue sea, restrained colour, antique scroll, no modern text, no grid, no horizon" },

    { "label": "flux-cn-parchment", "method": "flux-controlnet-canny", "model": "fal-ai/flux-control-lora-canny", "seed": 1568, "conditioningScale": 0.5,
      "prompt": "antique hand-drawn map of feudal Japan, aged sepia parchment, top-down bird's-eye cartography, forested green land and faded blue sea, tiny Sengoku-era castles, torii gates and pagodas drawn as small pictograms not to scale, mountains as little drawn peaks, compass rose, weathered ink linework, vintage watercolour wash, no modern text, no grid, no horizon" },
    { "label": "flux-cn-military", "method": "flux-controlnet-canny", "model": "fal-ai/flux-control-lora-canny", "seed": 1568, "conditioningScale": 0.5,
      "prompt": "antique Japanese military campaign map (ezu) of the Sengoku period, top-down, muted earth tones on aged paper, drawn fortifications and castle glyphs not to scale, roads and domain boundaries, small town markers, forested land and calm sea, hand-inked, weathered, no modern text, no grid, no horizon" },
    { "label": "flux-cn-sumie", "method": "flux-controlnet-canny", "model": "fal-ai/flux-control-lora-canny", "seed": 1568, "conditioningScale": 0.5,
      "prompt": "sumi-e ink wash map on aged rice paper, top-down, sparse and elegant, black brush strokes, mountains and pine groves as ink strokes, small castle and pagoda ink pictograms not to scale, pale grey-blue sea, restrained colour, antique scroll, no modern text, no grid, no horizon" },

    { "label": "recraft-parchment", "method": "recraft-v3", "model": "fal-ai/recraft-v3/image-to-image", "seed": 1568, "strength": 0.6,
      "prompt": "antique hand-drawn map of feudal Japan, aged sepia parchment, top-down bird's-eye cartography, forested green land and faded blue sea, tiny Sengoku-era castles, torii gates and pagodas drawn as small pictograms not to scale, mountains as little drawn peaks, compass rose, weathered ink linework, vintage watercolour wash, no modern text, no grid, no horizon" },
    { "label": "recraft-military", "method": "recraft-v3", "model": "fal-ai/recraft-v3/image-to-image", "seed": 1568, "strength": 0.6,
      "prompt": "antique Japanese military campaign map (ezu) of the Sengoku period, top-down, muted earth tones on aged paper, drawn fortifications and castle glyphs not to scale, roads and domain boundaries, small town markers, forested land and calm sea, hand-inked, weathered, no modern text, no grid, no horizon" },
    { "label": "recraft-sumie", "method": "recraft-v3", "model": "fal-ai/recraft-v3/image-to-image", "seed": 1568, "strength": 0.6,
      "prompt": "sumi-e ink wash map on aged rice paper, top-down, sparse and elegant, black brush strokes, mountains and pine groves as ink strokes, small castle and pagoda ink pictograms not to scale, pale grey-blue sea, restrained colour, antique scroll, no modern text, no grid, no horizon" },

    { "label": "sdxl-parchment", "method": "sdxl-map-lora", "model": "fal-ai/fast-sdxl/image-to-image", "seed": 1568, "strength": 0.7, "loraUrl": "https://VERIFY-IN-TASK-1.example/antique-map-lora.safetensors",
      "prompt": "antique hand-drawn map of feudal Japan, aged sepia parchment, top-down bird's-eye cartography, forested green land and faded blue sea, tiny Sengoku-era castles, torii gates and pagodas drawn as small pictograms not to scale, mountains as little drawn peaks, compass rose, weathered ink linework, vintage watercolour wash, no modern text, no grid, no horizon" },
    { "label": "sdxl-military", "method": "sdxl-map-lora", "model": "fal-ai/fast-sdxl/image-to-image", "seed": 1568, "strength": 0.7, "loraUrl": "https://VERIFY-IN-TASK-1.example/antique-map-lora.safetensors",
      "prompt": "antique Japanese military campaign map (ezu) of the Sengoku period, top-down, muted earth tones on aged paper, drawn fortifications and castle glyphs not to scale, roads and domain boundaries, small town markers, forested land and calm sea, hand-inked, weathered, no modern text, no grid, no horizon" },
    { "label": "sdxl-sumie", "method": "sdxl-map-lora", "model": "fal-ai/fast-sdxl/image-to-image", "seed": 1568, "strength": 0.7, "loraUrl": "https://VERIFY-IN-TASK-1.example/antique-map-lora.safetensors",
      "prompt": "sumi-e ink wash map on aged rice paper, top-down, sparse and elegant, black brush strokes, mountains and pine groves as ink strokes, small castle and pagoda ink pictograms not to scale, pale grey-blue sea, restrained colour, antique scroll, no modern text, no grid, no horizon" },

    { "label": "sd35-parchment", "method": "sd35-large", "model": "fal-ai/stable-diffusion-v35-large/image-to-image", "seed": 1568, "strength": 0.7,
      "prompt": "antique hand-drawn map of feudal Japan, aged sepia parchment, top-down bird's-eye cartography, forested green land and faded blue sea, tiny Sengoku-era castles, torii gates and pagodas drawn as small pictograms not to scale, mountains as little drawn peaks, compass rose, weathered ink linework, vintage watercolour wash, no modern text, no grid, no horizon" },
    { "label": "sd35-military", "method": "sd35-large", "model": "fal-ai/stable-diffusion-v35-large/image-to-image", "seed": 1568, "strength": 0.7,
      "prompt": "antique Japanese military campaign map (ezu) of the Sengoku period, top-down, muted earth tones on aged paper, drawn fortifications and castle glyphs not to scale, roads and domain boundaries, small town markers, forested land and calm sea, hand-inked, weathered, no modern text, no grid, no horizon" },
    { "label": "sd35-sumie", "method": "sd35-large", "model": "fal-ai/stable-diffusion-v35-large/image-to-image", "seed": 1568, "strength": 0.7,
      "prompt": "sumi-e ink wash map on aged rice paper, top-down, sparse and elegant, black brush strokes, mountains and pine groves as ink strokes, small castle and pagoda ink pictograms not to scale, pale grey-blue sea, restrained colour, antique scroll, no modern text, no grid, no horizon" }
  ]
}
```

> Replace the `sdxl-*` `loraUrl` placeholder with the real LoRA URL chosen in Task 1.
> This is the one value the schema can't catch (any URL passes `z.string().url()`), so it
> must be filled before any live `gen:matrix` run.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test matrixProfile`
Expected: PASS (now 5 tests, including the committed-file case).

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/profiles/matrix.json packages/terrain/test/matrixProfile.test.ts
git commit -m "feat(terrain): committed 15-candidate matrix.json"
```

---

## Task 4: Per-method fal input builder + candidate generator

**Files:**
- Modify: `packages/terrain/src/backend.ts` (export `firstImageUrl`)
- Create: `packages/terrain/src/matrixBackend.ts`
- Test: `packages/terrain/test/matrixBackend.test.ts`

**Interfaces:**
- Consumes: `Candidate` (Task 2); `FalClient`, `FetchFn`, `firstImageUrl` from `backend.ts`.
- Produces:
  - `buildCandidateInput(c: Candidate, deps: { baseUrl: string; outputSize: { width: number; height: number } }): Record<string, unknown>`
  - `generateCandidate(deps: { fal: FalClient; fetch: FetchFn }, args: { candidate: Candidate; baseUrl: string; outputSize: { width: number; height: number } }): Promise<Buffer>`

- [ ] **Step 1: Export `firstImageUrl` from backend.ts**

In `packages/terrain/src/backend.ts`, change the helper's declaration from
`function firstImageUrl(` to `export function firstImageUrl(`. No other change.

- [ ] **Step 2: Write the failing test**

```ts
// packages/terrain/test/matrixBackend.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildCandidateInput, generateCandidate } from "../src/matrixBackend.js";
import type { Candidate } from "../src/matrixProfile.js";

const outputSize = { width: 1024, height: 1164 };
const baseUrl = "https://up/base.png";

function candidate(over: Partial<Candidate>): Candidate {
  return {
    label: "c",
    method: "flux-img2img",
    model: "fal-ai/x",
    prompt: "antique map",
    seed: 1568,
    guidanceScale: 3.5,
    numInferenceSteps: 34,
    enableSafetyChecker: false,
    ...over
  };
}

describe("buildCandidateInput", () => {
  it("img2img uses image_url + strength", () => {
    const input = buildCandidateInput(candidate({ method: "flux-img2img", strength: 0.9 }), {
      baseUrl,
      outputSize
    });
    expect(input).toMatchObject({
      prompt: "antique map",
      image_url: baseUrl,
      strength: 0.9,
      seed: 1568,
      image_size: outputSize
    });
  });

  it("controlnet uses the control image + conditioning scale, not strength", () => {
    const input = buildCandidateInput(
      candidate({ method: "flux-controlnet-canny", conditioningScale: 0.5 }),
      { baseUrl, outputSize }
    );
    expect(input).toMatchObject({ control_image_url: baseUrl, controlnet_conditioning_scale: 0.5 });
    expect(input).not.toHaveProperty("strength");
  });

  it("sdxl-map-lora passes a loras array", () => {
    const input = buildCandidateInput(
      candidate({ method: "sdxl-map-lora", strength: 0.7, loraUrl: "https://lora/x.safetensors" }),
      { baseUrl, outputSize }
    );
    expect(input).toMatchObject({
      image_url: baseUrl,
      loras: [{ path: "https://lora/x.safetensors", scale: 1 }]
    });
  });
});

describe("generateCandidate", () => {
  it("subscribes with the candidate model and returns fetched bytes", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/r.png" }] } }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("PNG").buffer
    }));
    const out = await generateCandidate(
      { fal, fetch },
      { candidate: candidate({ model: "fal-ai/test" }), baseUrl, outputSize }
    );
    expect(fal.subscribe.mock.calls[0]![0]).toBe("fal-ai/test");
    expect(out.toString()).toBe("PNG");
  });

  it("throws (labelled) when the result fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/r.png" }] } }))
    };
    const fetch = vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(
      generateCandidate({ fal, fetch }, { candidate: candidate({ label: "boom" }), baseUrl, outputSize })
    ).rejects.toThrow(/boom.*500|500.*boom/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test matrixBackend`
Expected: FAIL — cannot resolve `../src/matrixBackend.js`.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/terrain/src/matrixBackend.ts
import { firstImageUrl, type FalClient, type FetchFn } from "./backend.js";
import type { Candidate } from "./matrixProfile.js";

export interface CandidateInputDeps {
  baseUrl: string;
  outputSize: { width: number; height: number };
}

/**
 * Build the fal `input` for one candidate. Pure — no network. Each method maps the shared
 * uploaded base to the right param name and adds its own dials. Param names follow the
 * fal endpoints verified in the harness README; adjust here if an endpoint differs.
 */
export function buildCandidateInput(c: Candidate, deps: CandidateInputDeps): Record<string, unknown> {
  const image_size = { width: deps.outputSize.width, height: deps.outputSize.height };
  const common: Record<string, unknown> = {
    prompt: c.prompt,
    seed: c.seed,
    num_images: 1,
    guidance_scale: c.guidanceScale,
    num_inference_steps: c.numInferenceSteps,
    enable_safety_checker: c.enableSafetyChecker,
    image_size
  };
  switch (c.method) {
    case "flux-controlnet-canny":
      return {
        ...common,
        control_image_url: deps.baseUrl,
        controlnet_conditioning_scale: c.conditioningScale ?? 0.5
      };
    case "sdxl-map-lora":
      return {
        ...common,
        image_url: deps.baseUrl,
        strength: c.strength ?? 0.7,
        loras: c.loraUrl ? [{ path: c.loraUrl, scale: 1 }] : []
      };
    case "flux-img2img":
    case "recraft-v3":
    case "sd35-large":
      return { ...common, image_url: deps.baseUrl, strength: c.strength ?? 0.8 };
  }
}

export interface FalDeps {
  fal: FalClient;
  fetch: FetchFn;
}

/** Run one candidate: subscribe to its model with the built input, fetch the result bytes. */
export async function generateCandidate(
  deps: FalDeps,
  args: { candidate: Candidate; baseUrl: string; outputSize: { width: number; height: number } }
): Promise<Buffer> {
  const input = buildCandidateInput(args.candidate, {
    baseUrl: args.baseUrl,
    outputSize: args.outputSize
  });
  const result = await deps.fal.subscribe(args.candidate.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`candidate "${args.candidate.label}" fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/terrain test matrixBackend`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/backend.ts packages/terrain/src/matrixBackend.ts packages/terrain/test/matrixBackend.test.ts
git commit -m "feat(terrain): per-method fal input builder + candidate generator"
```

---

## Task 5: Contact-sheet builder

**Files:**
- Create: `packages/terrain/src/contactSheet.ts`
- Test: `packages/terrain/test/contactSheet.test.ts`

**Interfaces:**
- Produces:
  - `gridLayout(count: number, opts: { columns: number; cellWidth: number; cellHeight: number; captionHeight: number }): { canvasWidth: number; canvasHeight: number; cells: { x: number; y: number }[] }`
  - `buildContactSheet(cells: { label: string; image: Buffer | null }[], opts: { columns: number; cellWidth: number; cellHeight: number; captionHeight: number }): Promise<Buffer>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/terrain/test/contactSheet.test.ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { gridLayout, buildContactSheet } from "../src/contactSheet.js";

const opts = { columns: 3, cellWidth: 100, cellHeight: 120, captionHeight: 20 };

describe("gridLayout", () => {
  it("computes canvas size and cell offsets for a full row plus a partial row", () => {
    const g = gridLayout(4, opts);
    // 3 columns used → width = 300; 2 rows → height = 2 * (120 + 20) = 280
    expect(g.canvasWidth).toBe(300);
    expect(g.canvasHeight).toBe(280);
    expect(g.cells[0]).toEqual({ x: 0, y: 0 });
    expect(g.cells[2]).toEqual({ x: 200, y: 0 });
    expect(g.cells[3]).toEqual({ x: 0, y: 140 }); // wraps to row 2
  });

  it("narrows the canvas when there are fewer items than columns", () => {
    const g = gridLayout(2, opts);
    expect(g.canvasWidth).toBe(200); // only 2 columns used
    expect(g.canvasHeight).toBe(140); // 1 row
  });
});

describe("buildContactSheet", () => {
  it("produces a PNG of the laid-out size, tolerating a null (failed) cell", async () => {
    const red = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } }
    })
      .png()
      .toBuffer();
    const out = await buildContactSheet(
      [
        { label: "ok-1", image: red },
        { label: "failed", image: null },
        { label: "ok-2", image: red }
      ],
      opts
    );
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(300); // 3 columns
    expect(meta.height).toBe(140); // 1 row
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test contactSheet`
Expected: FAIL — cannot resolve `../src/contactSheet.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/terrain/src/contactSheet.ts
import sharp from "sharp";

export interface SheetOpts {
  columns: number;
  cellWidth: number;
  cellHeight: number;
  captionHeight: number;
}

export interface GridLayout {
  canvasWidth: number;
  canvasHeight: number;
  cells: { x: number; y: number }[];
}

/** Pure grid math: where each cell sits and how big the canvas is. */
export function gridLayout(count: number, opts: SheetOpts): GridLayout {
  const usedCols = Math.min(opts.columns, Math.max(count, 1));
  const rows = Math.ceil(count / opts.columns);
  const rowHeight = opts.cellHeight + opts.captionHeight;
  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % opts.columns;
    const row = Math.floor(i / opts.columns);
    cells.push({ x: col * opts.cellWidth, y: row * rowHeight });
  }
  return {
    canvasWidth: usedCols * opts.cellWidth,
    canvasHeight: rows * rowHeight,
    cells
  };
}

/** Escape text for embedding in the caption SVG. */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A dark caption strip with the candidate label. */
function captionSvg(label: string, width: number, height: number): Buffer {
  const fontSize = Math.max(10, Math.round(height * 0.5));
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#111111"/>
    <text x="6" y="${Math.round(height * 0.7)}" font-family="sans-serif" font-size="${fontSize}" fill="#eeeeee">${escapeXml(label)}</text>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Composite candidates into one labelled grid PNG. A null image (a failed candidate)
 * renders as a dark placeholder cell so the grid stays aligned.
 */
export async function buildContactSheet(
  cells: { label: string; image: Buffer | null }[],
  opts: SheetOpts
): Promise<Buffer> {
  const layout = gridLayout(cells.length, opts);
  const overlays: sharp.OverlayOptions[] = [];

  for (let i = 0; i < cells.length; i++) {
    const { x, y } = layout.cells[i]!;
    const cell = cells[i]!;
    const thumb = cell.image
      ? await sharp(cell.image).resize(opts.cellWidth, opts.cellHeight, { fit: "fill" }).png().toBuffer()
      : await sharp({
          create: {
            width: opts.cellWidth,
            height: opts.cellHeight,
            channels: 3,
            background: { r: 50, g: 50, b: 50 }
          }
        })
          .png()
          .toBuffer();
    overlays.push({ input: thumb, left: x, top: y });
    overlays.push({
      input: captionSvg(cell.label, opts.cellWidth, opts.captionHeight),
      left: x,
      top: y + opts.cellHeight
    });
  }

  return await sharp({
    create: {
      width: layout.canvasWidth,
      height: layout.canvasHeight,
      channels: 3,
      background: { r: 17, g: 17, b: 17 }
    }
  })
    .composite(overlays)
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/terrain test contactSheet`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/contactSheet.ts packages/terrain/test/contactSheet.test.ts
git commit -m "feat(terrain): labelled contact-sheet builder"
```

---

## Task 6: Pipeline helpers — narrow `renderMapBase`, add `candidatesDir`

**Files:**
- Modify: `packages/terrain/src/pipeline.ts`

**Interfaces:**
- Consumes: `StyleProfile` (existing).
- Produces:
  - `renderMapBase(mapId: string, opts: Pick<StyleProfile, "landColor" | "seaColor" | "blurSigma" | "outputSize">): Promise<Buffer>` (narrowed param — full `StyleProfile` still satisfies it, so `cli.ts` is unaffected).
  - `candidatesDir(mapId: string): string` → `<artifactDir>/candidates`.

- [ ] **Step 1: Narrow `renderMapBase`'s parameter type**

In `packages/terrain/src/pipeline.ts`, change the signature:

```ts
export async function renderMapBase(
  mapId: string,
  opts: Pick<StyleProfile, "landColor" | "seaColor" | "blurSigma" | "outputSize">
): Promise<Buffer> {
```

and update the body to read from `opts` instead of `profile` (rename the three uses:
`opts.landColor`, `opts.seaColor`, `opts.outputSize.width/height`, `opts.blurSigma`).
The existing `cli.ts` caller passes a full `StyleProfile`, which still satisfies `Pick`.

- [ ] **Step 2: Add `candidatesDir`**

Append to `packages/terrain/src/pipeline.ts`:

```ts
/** Output directory for a map's matrix candidates (per-candidate PNGs + contact-sheet.png). */
export function candidatesDir(mapId: string): string {
  return `${artifactDir(mapId)}/candidates`;
}
```

- [ ] **Step 3: Verify typecheck + existing tests still pass**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck && pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS — no breakage in `cli.ts` or existing terrain tests.

- [ ] **Step 4: Commit**

```bash
git add packages/terrain/src/pipeline.ts
git commit -m "refactor(terrain): narrow renderMapBase opts + add candidatesDir"
```

---

## Task 7: `gen:matrix` CLI + script + README

**Files:**
- Create: `packages/terrain/src/matrixCli.ts`
- Modify: `packages/terrain/package.json` (add `gen:matrix` script)
- Modify: `packages/terrain/profiles/README.md` (harness usage + manual promotion)

**Interfaces:**
- Consumes: `loadMatrixConfig`, `renderMapBase`, `candidatesDir`, `generateCandidate`, `buildContactSheet`.
- Produces: a runnable `pnpm --filter @sengoku-jidai/terrain gen:matrix <mapId>` that writes `terrain/<mapId>/candidates/{_base.png, <label>.png…, contact-sheet.png}`.

- [ ] **Step 1: Write the CLI**

```ts
// packages/terrain/src/matrixCli.ts
import { fal } from "@fal-ai/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderMapBase, candidatesDir } from "./pipeline.js";
import { loadMatrixConfig } from "./matrixProfile.js";
import { generateCandidate } from "./matrixBackend.js";
import { buildContactSheet } from "./contactSheet.js";

async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen:matrix <mapId>");
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set (see .env.example)");
  }

  const config = loadMatrixConfig(
    fileURLToPath(new URL("../profiles/matrix.json", import.meta.url))
  );
  const outDir = candidatesDir(mapId);
  mkdirSync(outDir, { recursive: true });

  console.log(`[matrix] rendering colour base for "${mapId}"…`);
  const base = await renderMapBase(mapId, config.base);
  writeFileSync(`${outDir}/_base.png`, base);

  fal.config({ credentials: key });
  const baseUrl = await fal.storage.upload(
    new Blob([new Uint8Array(base)], { type: "image/png" })
  );

  const cells: { label: string; image: Buffer | null }[] = [];
  for (const candidate of config.candidates) {
    try {
      console.log(`[matrix] ${candidate.label} — ${candidate.method} via ${candidate.model}…`);
      const png = await generateCandidate(
        { fal, fetch },
        { candidate, baseUrl, outputSize: config.base.outputSize }
      );
      writeFileSync(`${outDir}/${candidate.label}.png`, png);
      cells.push({ label: candidate.label, image: png });
    } catch (err) {
      console.error(
        `[matrix] ${candidate.label} FAILED: ${err instanceof Error ? err.message : String(err)}`
      );
      cells.push({ label: `${candidate.label} (failed)`, image: null });
    }
  }

  const cellWidth = 320;
  const cellHeight = Math.round(
    cellWidth * (config.base.outputSize.height / config.base.outputSize.width)
  );
  const sheet = await buildContactSheet(cells, {
    columns: config.columns,
    cellWidth,
    cellHeight,
    captionHeight: 28
  });
  writeFileSync(`${outDir}/contact-sheet.png`, sheet);

  const ok = cells.filter((c) => c.image).length;
  console.log(
    `[matrix] done: ${ok}/${cells.length} candidates ok\n  sheet: ${outDir}/contact-sheet.png`
  );
}

main().catch((err) => {
  console.error(`[matrix] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the package script**

In `packages/terrain/package.json`, add to `"scripts"` (after `"gen:base"`):

```json
    "gen:matrix": "tsx src/matrixCli.ts",
```

- [ ] **Step 3: Verify it wires up (no FAL_KEY → clear error; bad map → clear error)**

Run: `FAL_KEY= pnpm --filter @sengoku-jidai/terrain gen:matrix rivers`
Expected: exits non-zero with `[matrix] FAL_KEY is not set (see .env.example)`.

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: PASS.

- [ ] **Step 4: Document usage + promotion in the README**

Append a `## Comparison harness (gen:matrix)` section to
`packages/terrain/profiles/README.md` covering:
- What it does: `pnpm --filter @sengoku-jidai/terrain gen:matrix <mapId>` reads
  `profiles/matrix.json`, renders the shared base once, runs every candidate, and writes
  `terrain/<mapId>/candidates/contact-sheet.png` (plus per-candidate PNGs). It does **not**
  touch the committed `.webp` or `antique.json`.
- How to explore: edit `matrix.json` (add/trim candidates, change prompts/strengths) and
  re-run. Failed candidates appear as dark cells, so one bad model doesn't sink the sheet.
- **Manual promotion:** once you pick a winner from the sheet, copy its `model`/`prompt`/
  `strength` (and seed) into `antique.json`, then run
  `pnpm --filter @sengoku-jidai/terrain gen <mapId>` to emit the committed `<mapId>.webp`.

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/matrixCli.ts packages/terrain/package.json packages/terrain/profiles/README.md
git commit -m "feat(terrain): gen:matrix CLI + contact sheet, with harness docs"
```

---

## Task 8: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full terrain gate**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck && pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS — all suites (matrixProfile, matrixBackend, contactSheet, plus existing backend/styleProfile/postprocess/controlImage/mapSources).

- [ ] **Step 2: Run the repo-wide gate (lint/format if configured)**

Run: `pnpm -w lint 2>/dev/null || echo "no root lint"` and `pnpm -w format:check 2>/dev/null || echo "no root format check"`
Expected: PASS or "no root …".

- [ ] **Step 3: First live smoke (manual, requires FAL_KEY + verified matrix.json)**

> Only after Task 1's endpoints/LoRA are filled into `matrix.json`. Costs ~15 fal calls.

Run: `pnpm --filter @sengoku-jidai/terrain gen:matrix rivers`
Expected: `terrain/rivers/candidates/contact-sheet.png` exists with 15 labelled cells.
Open it and confirm cells render (failed cells will be dark with a "(failed)" caption —
if a whole method failed, reconcile its endpoint id/params against Task 1's findings).

---

## Self-Review

**Spec coverage:**
- Matrix candidate config → Task 2 (schema) + Task 3 (committed file). ✓
- Backend dispatch per method → Task 4. ✓
- `gen-matrix` CLI → Task 7. ✓
- Contact-sheet builder → Task 5. ✓
- Manual promotion → Task 7 Step 4 (README). ✓
- Verification of fal endpoints before paid runs → Task 1. ✓
- Loose-alignment ControlNet approach → Task 3 (`flux-controlnet-canny` candidates) + Task 4 (input builder). ✓
- 5 methods × 3 aesthetics = 15 → Task 3. ✓
- Don't touch committed webp / antique.json → Global Constraints + Task 7 README. ✓
- Tests offline, mirror existing patterns → Tasks 2/4/5. ✓

**Type consistency:** `Candidate`, `MatrixConfig`, `Method`, `loadMatrixConfig`,
`buildCandidateInput`, `generateCandidate`, `gridLayout`, `buildContactSheet`,
`candidatesDir`, `renderMapBase(opts)`, `firstImageUrl` (now exported) — names and
signatures match across Tasks 2–7. ✓

**Placeholder scan:** The only intentional fill-in is the `sdxl-map-lora` `loraUrl`,
flagged in Task 1 and Task 3 as a required Task-1 deliverable (no real LoRA URL can be
invented at plan time). All code steps contain complete code. ✓
