# PR-1: Terrain generation → gpt-image-1.5 (model switch + pad-then-crop)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the terrain edit model from `fal-ai/nano-banana-pro/edit` to `fal-ai/gpt-image-1.5/edit`, handling gpt-image's fixed output sizes with a pad-then-crop round-trip so the board aspect is preserved.

**Architecture:** gpt-image-1.5 edit takes `image_urls[]` + `prompt` + `image_size`/`quality`/`input_fidelity` (no `resolution`/`seed`). A pure `planGptImageAspect` picks the least-padding fixed size and letterbox margins; `generateTerrainWebp` pads the control into that size (sea colour in the margins), runs the edit, and crops the padding back off. Validated by a de-risk spike: gpt-image-1.5 with `input_fidelity:"high"` follows our control faithfully.

**Tech Stack:** TypeScript, `@sengoku-jidai/terrain` (sharp, `@fal-ai/client`), Vitest with an injected fake fal client, `zod` profile schema.

## Global Constraints

- No new third-party deps (still `@fal-ai/client`, different model id).
- `corepack pnpm`; rebuild libs before filtered tests; `prettier --check` changed paths as part of each task's gate.
- The model call must send exactly: `{ prompt, image_urls, num_images:1, image_size, quality, input_fidelity, output_format:"png" }` — no `seed`, no `resolution`.
- Aspect via **pad-then-crop** (validated); `image_size` is derived per-board, not a profile constant.
- Stage files individually; never commit `.claude/`/`.superpowers/` or scratch render artifacts.
- This PR keeps the antique style (its `texture-ref.jpeg` swatch); no ink style, no style catalog here.

---

### Task 1: `planGptImageAspect` pure function

Pick the fixed gpt-image output size that contains the board aspect with the least padding, and the letterbox margins to pad into it.

**Files:**
- Create: `packages/terrain/src/gptImageAspect.ts`
- Modify: `packages/terrain/src/index.ts` (export it)
- Test: `packages/terrain/test/gptImageAspect.test.ts`

**Interfaces:**
- Produces: `planGptImageAspect(boardW: number, boardH: number): AspectPlan` where
  `AspectPlan = { imageSize: "1024x1024"|"1536x1024"|"1024x1536"; targetW: number; targetH: number; contentW: number; contentH: number; padLeft: number; padTop: number; padRight: number; padBottom: number }`.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/gptImageAspect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planGptImageAspect } from "../src/gptImageAspect.js";

describe("planGptImageAspect", () => {
  it("picks 1024x1024 for a near-square board (least padding) and letterboxes it", () => {
    const p = planGptImageAspect(1024, 1102); // aspect 0.929 (the real Small Testmap control)
    expect(p.imageSize).toBe("1024x1024");
    expect(p.targetW).toBe(1024);
    expect(p.targetH).toBe(1024);
    // board is taller than square → content is scaled to fit height, padded on width
    expect(p.contentH).toBe(1024);
    expect(p.contentW).toBe(952);
    expect(p.padLeft + p.contentW + p.padRight).toBe(1024);
    expect(p.padTop + p.contentH + p.padBottom).toBe(1024);
  });

  it("picks the exact landscape size with no padding for a 3:2 board", () => {
    const p = planGptImageAspect(1536, 1024);
    expect(p.imageSize).toBe("1536x1024");
    expect(p.padLeft).toBe(0);
    expect(p.padTop).toBe(0);
  });

  it("picks the portrait size for a tall board", () => {
    const p = planGptImageAspect(1024, 1536);
    expect(p.imageSize).toBe("1024x1536");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/gptImageAspect.test.ts`
Expected: FAIL — cannot resolve `../src/gptImageAspect.js`.

- [ ] **Step 3: Implement**

Create `packages/terrain/src/gptImageAspect.ts`:

```ts
/** gpt-image only outputs these fixed sizes; we letterbox the board into the least-padding one. */
const GPT_IMAGE_SIZES = [
  { id: "1024x1024", w: 1024, h: 1024 },
  { id: "1536x1024", w: 1536, h: 1024 },
  { id: "1024x1536", w: 1024, h: 1536 }
] as const;

export interface AspectPlan {
  imageSize: "1024x1024" | "1536x1024" | "1024x1536";
  targetW: number;
  targetH: number;
  contentW: number;
  contentH: number;
  padLeft: number;
  padTop: number;
  padRight: number;
  padBottom: number;
}

/** Pick the fixed gpt-image output size that contains the board aspect with the least padding,
 *  and the symmetric letterbox margins to pad the control into it. The padding is filled with the
 *  sea colour at generation time and cropped off after. */
export function planGptImageAspect(boardW: number, boardH: number): AspectPlan {
  let best: AspectPlan | undefined;
  let bestPad = Number.POSITIVE_INFINITY;
  for (const size of GPT_IMAGE_SIZES) {
    const scale = Math.min(size.w / boardW, size.h / boardH);
    const contentW = Math.round(boardW * scale);
    const contentH = Math.round(boardH * scale);
    const padArea = size.w * size.h - contentW * contentH;
    if (padArea < bestPad) {
      bestPad = padArea;
      const padLeft = Math.floor((size.w - contentW) / 2);
      const padTop = Math.floor((size.h - contentH) / 2);
      best = {
        imageSize: size.id,
        targetW: size.w,
        targetH: size.h,
        contentW,
        contentH,
        padLeft,
        padTop,
        padRight: size.w - contentW - padLeft,
        padBottom: size.h - contentH - padTop
      };
    }
  }
  // GPT_IMAGE_SIZES is non-empty, so best is always assigned.
  return best as AspectPlan;
}
```

- [ ] **Step 4: Export from the terrain index**

In `packages/terrain/src/index.ts`, add:

```ts
export { planGptImageAspect, type AspectPlan } from "./gptImageAspect.js";
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/gptImageAspect.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/gptImageAspect.ts packages/terrain/src/index.ts packages/terrain/test/gptImageAspect.test.ts
git commit -m "feat(terrain): planGptImageAspect for gpt-image fixed sizes"
```

---

### Task 2: Profile schema + editPass → gpt-image request shape

Switch the profile fields and the fal request from nano-banana's shape to gpt-image-1.5's.

**Files:**
- Modify: `packages/terrain/src/mapProfile.ts` (the `edit` object)
- Modify: `packages/terrain/profiles/map.json` (antique profile)
- Modify: `packages/terrain/src/editPass.ts`
- Modify: `packages/terrain/test/` — the existing editPass/pipeline test that asserts the request shape (find it in Step 1)

**Interfaces:**
- Produces: `editMapPass(deps, { controlImage: Buffer; styleImage: Buffer | null; model: string; prompt: string; imageSize: string; quality: string; inputFidelity: string }): Promise<Buffer>`.
- Produces: `MapProfile.edit = { model: string; styleRef?: string; quality: "low"|"medium"|"high"; inputFidelity: "low"|"high"; prompt: string }` (no `resolution`, no `seed`).

- [ ] **Step 1: Find and update the editPass request-shape test**

Locate the test asserting the current input: `grep -rn "image_urls\|resolution\|num_images" packages/terrain/test`. In that test, change the expected `input` to the gpt-image shape and the call args to the new signature. The asserted `input` must be:

```ts
{
  prompt: expect.any(String),
  image_urls: [expect.any(String), expect.any(String)],
  num_images: 1,
  image_size: "1024x1024",
  quality: "high",
  input_fidelity: "high",
  output_format: "png"
}
```

and it must NOT contain `resolution` or `seed`. Update the `editMapPass` call in that test to pass `{ controlImage, styleImage, model, prompt, imageSize: "1024x1024", quality: "high", inputFidelity: "high" }`. Add a case asserting that when `styleImage` is `null`, `image_urls` has length 1.

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run` (the editPass test)
Expected: FAIL (editPass still emits the old shape / old signature).

- [ ] **Step 3: Rewrite `editMapPass`**

Replace the body of `packages/terrain/src/editPass.ts`'s `editMapPass` with:

```ts
export async function editMapPass(
  deps: EditDeps,
  args: {
    controlImage: Buffer;
    styleImage: Buffer | null;
    model: string;
    prompt: string;
    imageSize: string;
    quality: string;
    inputFidelity: string;
  }
): Promise<Buffer> {
  const controlUrl = await deps.fal.storage.upload(
    new Blob([new Uint8Array(args.controlImage)], { type: "image/png" })
  );
  const image_urls = [controlUrl];
  if (args.styleImage) {
    const styleUrl = await deps.fal.storage.upload(
      new Blob([new Uint8Array(args.styleImage)], { type: "image/jpeg" })
    );
    image_urls.push(styleUrl);
  }
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    image_urls,
    num_images: 1,
    image_size: args.imageSize,
    quality: args.quality,
    input_fidelity: args.inputFidelity,
    output_format: "png"
  };
  const result = await deps.fal.subscribe(args.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`edit pass fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
```

Update the doc comment above it to describe gpt-image-1.5 (control [+ optional style], `image_urls` ordered [control, style]).

- [ ] **Step 4: Update the profile schema**

In `packages/terrain/src/mapProfile.ts`, replace the `edit` object with:

```ts
  edit: z.object({
    model: z.string().default("fal-ai/gpt-image-1.5/edit"),
    /** Optional style-reference image (relative to the terrain package root). Absent = prompt-only. */
    styleRef: z.string().optional(),
    /** gpt-image cost/quality tier. */
    quality: z.enum(["low", "medium", "high"]).default("high"),
    /** How strongly gpt-image preserves the control's structure. "high" keeps island placement. */
    inputFidelity: z.enum(["low", "high"]).default("high"),
    prompt: z.string().min(1)
  }),
```

- [ ] **Step 5: Update the antique profile `map.json`**

In `packages/terrain/profiles/map.json`, change the `edit` object: set `"model": "fal-ai/gpt-image-1.5/edit"`, remove `"resolution"` and `"seed"`, add `"quality": "high"` and `"inputFidelity": "high"`, keep `"styleRef": "assets/texture-ref.jpeg"` and the existing `prompt` unchanged.

- [ ] **Step 6: Run the terrain suite — expect PASS**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run`
Expected: all pass (editPass emits the gpt-image shape; profile parses).

- [ ] **Step 7: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/terrain/src/mapProfile.ts packages/terrain/profiles/map.json packages/terrain/src/editPass.ts packages/terrain/test/
git commit -m "feat(terrain): gpt-image-1.5 profile schema + edit request shape"
```

---

### Task 3: Pad-then-crop in the pipeline + drop seed reroll

Wire `planGptImageAspect` into `generateTerrainWebp` (pad the control, crop the result) and remove the now-defunct seed reroll from `TerrainService`.

**Files:**
- Modify: `packages/terrain/src/mapPipeline.ts` (`generateTerrainWebp`)
- Modify: `packages/server/src/maps/terrainService.ts` (remove seed reroll)
- Modify: `packages/terrain/test/` and `packages/server/test/` — update any fake-fal test that constructs a profile with `resolution`/`seed`

**Interfaces:**
- Consumes: `planGptImageAspect` (Task 1), `editMapPass` new signature (Task 2).

- [ ] **Step 1: Rewrite the edit/encode tail of `generateTerrainWebp`**

In `packages/terrain/src/mapPipeline.ts`, replace everything from the `const styleImage = ...` line through the final `return toWebp(...)` with:

```ts
  const plan = planGptImageAspect(width, height);
  // Letterbox the control into the fixed gpt-image size; margins are sea (discarded after crop).
  const paddedControl = await sharp(control)
    .resize(plan.contentW, plan.contentH, { fit: "fill" })
    .extend({
      top: plan.padTop,
      bottom: plan.padBottom,
      left: plan.padLeft,
      right: plan.padRight,
      background: base.seaColor
    })
    .png()
    .toBuffer();

  let styleImage: Buffer | null = null;
  if (profile.edit.styleRef) {
    styleImage = await sharp(
      readFileSync(fileURLToPath(new URL(`../${profile.edit.styleRef}`, import.meta.url)))
    )
      .resize(plan.contentW, plan.contentH, { fit: "cover" })
      .jpeg()
      .toBuffer();
  }

  const edited = await editMapPass(deps, {
    controlImage: paddedControl,
    styleImage,
    model: profile.edit.model,
    prompt: profile.edit.prompt,
    imageSize: plan.imageSize,
    quality: profile.edit.quality,
    inputFidelity: profile.edit.inputFidelity
  });

  // Crop the padding back off (model returns targetW×targetH), then size to the board.
  const cropped = await sharp(edited)
    .resize(plan.targetW, plan.targetH, { fit: "fill" })
    .extract({ left: plan.padLeft, top: plan.padTop, width: plan.contentW, height: plan.contentH })
    .png()
    .toBuffer();
  return toWebp(cropped, { width, height, quality: profile.webpQuality });
```

Add the import at the top of the file: `import { planGptImageAspect } from "./gptImageAspect.js";`

- [ ] **Step 2: Remove the seed reroll in `TerrainService`**

In `packages/server/src/maps/terrainService.ts`, delete the seed-reroll block (the comment "Reroll the seed each run…" and the `const profile: MapProfile = { ...this.profile, edit: { ...this.profile.edit, seed: … } }`), and pass `this.profile` directly to `generateTerrainWebp`. gpt-image has no seed and varies naturally between runs, so regenerate-for-variety still works.

- [ ] **Step 3: Fix any fake-fal tests that build a profile with `resolution`/`seed`**

Run `grep -rn "resolution\|seed" packages/terrain/test packages/server/test`. In any test profile object, remove `resolution`/`seed` and add `quality: "high"`, `inputFidelity: "high"` (styleRef optional). Fake fal clients that assert the request `input` must expect the gpt-image shape (image_size/quality/input_fidelity, no seed/resolution).

- [ ] **Step 4: Build libs, run terrain + server suites — expect PASS**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/terrain exec vitest run && corepack pnpm --filter @sengoku-jidai/server exec vitest run`
Expected: all pass with the fake fal client (no network).

- [ ] **Step 5: Typecheck both packages + lint**

Run: `corepack pnpm --filter @sengoku-jidai/terrain typecheck && corepack pnpm --filter @sengoku-jidai/server typecheck && corepack pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/src/mapPipeline.ts packages/server/src/maps/terrainService.ts packages/terrain/test/ packages/server/test/
git commit -m "feat(terrain): pad-then-crop pipeline for gpt-image; drop seed reroll"
```

---

### Task 4: Validate the antique look through the real pad-then-crop pipeline (controller, ~1 fal credit)

Confirm the refactored pipeline (pad → gpt-image-1.5 → crop) produces a correctly-aligned antique terrain end-to-end. This is a controller-run validation, not a subagent task (needs the deploy `FAL_KEY` and spends a credit Martin approved).

- [ ] **Step 1: Run a real generation through `generateTerrainWebp`**

With `FAL_KEY` from the running container, run `generateTerrainWebp` on the Small Testmap source (fetched from `http://127.0.0.1:18081/api/maps/fc5161b0-f889-41e6-ab32-9106276c86c7`) using the updated antique profile, via a throwaway vitest in `packages/terrain/test` (deleted after). Save the webp to the scratchpad.

- [ ] **Step 2: Eyeball on the board with the `terrain-shot` tool**

Overlay the generated webp on the board (`terrain-shot --map fc5161b0-… --terrain-url <file> --out …`, then svgshot to PNG) and confirm: the five islands sit under the board's five land tiles (aspect preserved — no vertical squish), and the antique style rendered. Record the outcome in the task report; delete the throwaway test.
Expected: land/sea aligns with the board; antique style present. If aspect is off, the pad/crop margins need revisiting before merge.

---

## Self-Review

**Spec coverage:**
- Model switch (editPass request → gpt-image; profile `model`/`quality`/`inputFidelity`, drop `resolution`/`seed`) → Tasks 2 & 3. ✓
- Pad-then-crop aspect handling (least-padding fixed size, pad with sea, crop back) → Tasks 1 & 3. ✓
- Seed reroll no-op → Task 3. ✓
- Optional style image (forward-compat for ink prompt-only) → Task 2 (`styleRef?`) + Task 3. ✓
- Antique re-validation on the new model → Task 4. ✓
- Ink style / catalog → deliberately deferred to PR-2 (out of scope here). ✓

**Placeholder scan:** No TBD/TODO; full code in every code step; commands have expected output. Task 4 is inherently a controller validation (documented as such). ✓

**Type consistency:** `AspectPlan` fields used by Task 3 match Task 1's definition; `editMapPass`'s new signature (`imageSize`/`quality`/`inputFidelity`, `styleImage: Buffer|null`) is identical across Tasks 2 & 3; profile `edit` shape matches between `mapProfile.ts`, `map.json`, and its consumers. ✓
