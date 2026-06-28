# Terrain map composite pipeline — design

Date: 2026-06-28
Status: superseded during implementation — see "Update: final architecture" below

## Update: final architecture (edit-model pipeline)

The mask-composite approach below was built and live-tested, but iterating on the visual
result showed that **clipping two separately-generated textures to a mask always reads as
"two textures on one canvas," never as one cohesive island/river map**. The pipeline pivoted
to a single multi-image **instruction-edit** model, keeping the deterministic structural work
as its control input:

1. **`renderLandMask`** — from the board SVG, a binary land/sea mask, **domain-warped** through
   a smooth noise vector field so the hex boundary bends into natural, connected coastlines
   (deliberately no longer pixel-perfect to the tiles).
2. **`renderControl`** — paints the warped mask as a flat **green-land / blue-sea** control
   image (bold distinct colours read most reliably to the edit model; the control colour never
   appears in the output).
3. **`editMapPass`** — `fal-ai/nano-banana-pro/edit` redraws the control's land/sea layout in
   the style of a committed reference image (`assets/style-ref.jpeg`), producing one cohesive
   antique map with a natural drawn coastline. The style ref is cover-cropped to the board
   aspect so the output keeps the board's proportions (aligns with the UI; tiles undistorted).
4. **`toWebp`** — final asset at the board's exact viewBox aspect.

The texture / composite / img2img modules from the design below were removed. The sections
that survived: SVG prep (`prepBoardSvgMarkup`), the domain warp, the `TERRAIN_OUT_DIR` CLI,
and the test/profile patterns. The original design is retained below for the record.

---

Date: 2026-06-28
Status: approved (brainstorm)
Branch: `feat/terrain-comparison-harness` (work continues here or a follow-up branch)

## Problem

We want a faded, antique-stylized map image rendered behind the vector board UI. The
existing pipeline (`gen` / `gen:matrix`) rasterizes the board SVG into a flat two-colour
control (land `#7e8c5a` / sea `#566f80`), blurs it, and runs it through img2img /
ControlNet-canny candidates. Every candidate lands on one of two failure modes:

- **High denoise strength** → the model invents a completely different coastline.
- **Low denoise strength** → the output is essentially the blurred control with a filter.

ControlNet-canny was meant to decouple structure from texture, but it cannot find strong
edges in a deliberately-blurred two-colour image, so it is also weak. The only good result
so far came from pasting the control into ChatGPT and asking it to "fill in the details" —
which is an *inpainting/edit* operation (keep structure, add texture), not a denoise blend.

### Root cause

Coastline fidelity and detail richness are governed by a single dial (denoise strength)
because the coastline only ever enters the model **as image content** (a blurry colour
blob). To a diffusion model a blurry colour blob is a suggestion, not a boundary.

We already own a pixel-perfect coastline: the vector board SVG. The fix is to stop asking
the model to reproduce structure at all.

## Principle

**The model only ever produces texture. All structure (the coastline) comes from the
vector SVG via deterministic `sharp` compositing.** Strength can go high *inside* each
region for rich detail without ever corrupting the coast, because the coast is a vector
mask, not a model output.

## Deliverable

A scriptable, re-runnable pipeline (a few manual prompt/seed/param tweaks per run are
acceptable) that turns a board SVG into a styled antique background webp. Decorative
buildings/castles/pagodas ("flair") are explicitly **deferred** to a later iteration.

## Architecture

```
board SVG ──► [1] renderMasks ──► landMask.png   (crisp binary, organicized)
                               └► coastStroke.png (inked outline along the boundary)

profile ──► [2] generateTexture("sea")  ──► sea.png   (full-frame t2i, unclipped)
        └─► [2] generateTexture("land") ──► land.png  (full-frame t2i, unclipped)

{masks, textures} ──► [3] compositeMap ──► [4] harmonize ──► background.webp
```

The two texture calls are independent and may run in parallel. Everything after generation
is deterministic `sharp` compositing — no model involvement in structure.

## Components

### 1. `masks.ts` — `renderMasks(svgMarkup, opts) -> { landMask, coastStroke }`

From the board SVG, emit at output resolution:

- **`landMask`** — a *crisp, unblurred* binary mask: white over land tiles + the
  outside-the-tiles background (which reads as land), black over sea tiles. Reuses the
  shared SVG-prep currently inside `controlImage.ts` (`renderBaseImage`): hide every `#g1`
  child except `#tile-land` / `#tile-sea`, neutralize the `TILE_GEOMETRY_DEFS`, fill each
  tile by land/sea class. The only difference from `renderBaseImage` is colours (pure
  white/black) and **no blur**.
- A small **blur-then-threshold** (`organicSigma`, default ≈2px) rounds the hex facets into
  organic curves while keeping the mask strictly binary.
- **`coastStroke`** — the inked coastline: derive the boundary from the mask
  (dilate XOR erode → 1–N px outline), then tint it an antique ink colour. Transparent
  elsewhere.

To avoid duplication, factor the shared SVG-prep (layer hiding + geometry-def
neutralizing + per-tile fill) out of `controlImage.ts` into a helper that both
`renderBaseImage` and `renderMasks` call.

### 2. `texture.ts` — `generateTexture(deps, args) -> Buffer`

One fal **text-to-image** call per region, each producing a *full-frame, unconstrained*
texture at composite resolution. The model never sees the coastline, so there are no edge
artifacts; we clip afterward. Thin wrapper over `backend.ts`'s fal client (`fal`/`fetch`
injected for offline tests). Prompts + seeds come from the profile.

- **sea** — antique water: wave linework, colour washes, optional sea-monster flair.
- **land** — antique parchment landmass: forests, mountain ranges, roads, faded washes.

### 3. `composite.ts` — `compositeMap(args) -> Buffer`

Pure `sharp`. `land` painted through `landMask` as alpha, over `sea`; then `coastStroke`
composited on top. Output coast is exactly the board's coast.

### 4. `composite.ts` — `harmonize(buffer, opts) -> Buffer`

Pure `sharp` by default: desaturate, multiply an aged-paper/parchment texture, add grain +
vignette so the separately-generated land and sea read as **one antique sheet**.

Optional final **low-strength img2img** (`harmonize.i2iStrength`, default off / ~0.2–0.3
when on) marries the seam. Here low strength is *correct*: the coast is already right, so a
gentle pass harmonizes without restructuring — the inverse of the dial that failed before.

### 5. `mapPipeline.ts` — orchestration

Runs stages 1–4 and writes the webp. Distinct from the existing `pipeline.ts` (left intact
for the matrix harness). Writes every intermediate (`landMask.png`, `coastStroke.png`,
`sea.png`, `land.png`, `composite.png`, final `background.webp`) to the output dir for
inspection.

### 6. `mapPipelineCli.ts` + `gen:map` script

CLI entry: flags for map id, profile path, seeds, output dir. Reads `FAL_KEY` from env
(via the git-ignored `.env`). Mirrors the existing `gen` / `gen:matrix` CLIs.

### 7. `profiles/map.json`

```jsonc
{
  "base": { "landColor": "...", "seaColor": "...",
            "outputSize": { "width": 1024, "height": 1164 },
            "organicSigma": 2 },
  "sea":  { "prompt": "...", "seed": 1568 },
  "land": { "prompt": "...", "seed": 1568 },
  "harmonize": { "desaturate": 0.4, "vignette": true, "i2iStrength": 0 }
}
```

## Output location

Intermediates + final image are written to **`/mnt/ssd_pool/ssd_set/terrain-gen/<mapId>/`**
so they can be viewed outside the repo. The committed web asset path is unchanged
(`packages/web/src/assets/terrain/<mapId>.webp`) and is only updated once a result is
chosen.

## Data flow & error handling

- Linear pipeline; the two texture calls fan out and rejoin before compositing.
- Validate the SVG has `#g1` + tile groups (already enforced by the shared prep).
- Validate each fal call returned an image url (`firstImageUrl` already throws otherwise).
- Resize textures to the mask dimensions (`fit: fill`) before compositing so dims always
  match.

## Testing (Vitest, fal mocked — same pattern as the matrix harness)

- **`renderMasks`**: feed a tiny synthetic SVG with one land + one sea tile; assert mask
  pixels are white over land, black over sea, and `coastStroke` is non-empty only at the
  boundary.
- **`compositeMap`**: feed a known mask + two *solid-colour* textures; assert output pixels
  equal the land colour in land regions and the sea colour in sea regions — deterministic
  pixel checks, no network.
- **`harmonize`**: sample pixels before/after; assert it desaturates / dims. Deterministic.
- All fal calls mocked; no live generation in tests.

## Verification

Local browser/image preview is unavailable in this environment. Loop: build pipeline +
tests, user runs `gen:map` with `FAL_KEY` set and eyeballs the output plus the intermediate
PNGs written alongside.

## Defaults baked in (override in profile)

1. **`organicSigma`** ≈ 2px — soften hex facets; tunable.
2. **`harmonize.i2iStrength`** = 0 (off) — pure-`sharp` harmonize is deterministic and
   cheap; enable to let the model marry the seam.

## Out of scope (later iterations)

- Decorative flair (castles/towns/pagodas) — whether generated-via-inpaint-masked-to-land
  or deterministic SVG glyphs at known positions. Deferred.
- Multi-map support beyond what `mapSources.ts` already registers.
```