# Terrain generation on gpt-image-1.5 + selectable styles

**Date:** 2026-07-12
**Status:** Draft (revised after Martin chose to switch the generation model). Relates to
[multiple-terrains](2026-07-12-multiple-terrains-design.md) and [[terrain-generation-quality]].

Two changes, together: **switch the terrain edit model** from Google's
`fal-ai/nano-banana-pro/edit` to OpenAI's **`fal-ai/gpt-image-1.5/edit`** (Martin prefers its
results), and **add a second selectable style** — a black-and-white pen-and-ink look from
`Alternate_terrain.png` — alongside the current colored antique look.

## Why

Martin tested OpenAI's image model (the one behind ChatGPT) and was much happier with the output
than nano-banana. gpt-image is strong at instruction-following, which should also help it *follow
the land/sea control* faithfully — the weakness that caused the earlier "model ignores the control"
bug. Both styles benefit from the better model.

## Model switch: what changes in the pipeline

`editMapPass` (`packages/terrain/src/editPass.ts`) currently sends the nano-banana schema:
`{ prompt, image_urls:[control,style], num_images, resolution:"2K", output_format:"png", seed }`.

gpt-image-1.5 edit (`fal-ai/gpt-image-1.5/edit`) uses a different input schema. New request:

```
{
  prompt,
  image_urls: [controlUrl, styleUrl],   // same two-image approach; prompt names each by role
  num_images: 1,
  image_size: "auto",                    // auto | 1024x1024 | 1536x1024 | 1024x1536
  quality: "high",                       // low | medium | high  (cost driver)
  input_fidelity: "high",                // preserve the control's structure
  output_format: "png"
  // NO seed, NO resolution
}
```

- **Profile schema (`MapProfile.edit`)** changes: drop `resolution` (a nano-banana "2K"/"4K"
  enum) and `seed`; add `imageSize` (enum above, default `"auto"`), `quality` (enum, default
  `"high"`), `inputFidelity` (enum, default `"high"`). `model` becomes `"fal-ai/gpt-image-1.5/edit"`.
- **Seed reroll** (`TerrainService`) becomes a no-op — gpt-image has no seed and varies naturally
  between runs, so "regenerate for a different look" still works. Remove the seed override.
- **Downstream** (mask/control build, sharp→webp, output-height-from-viewBox) is unchanged.

### Aspect-ratio handling: pad-then-crop (Martin's approach)

Our board viewBox aspect is variable; gpt-image only outputs `auto` + three fixed sizes
(1024², 1536×1024, 1024×1536). Rather than stretch/distort, **letterbox the control to a fixed
aspect, generate, then crop the padding back off** — distortion-free and deterministic:

1. From the board aspect `r = width/height`, pick the fixed `image_size` that contains it with the
   **least padding** (min added area), and compute symmetric margins to pad the control to exactly
   that aspect.
2. Pad the control image with the **sea control colour** (blue) so the model renders continuous
   ocean in the margin (custom maps already read empty space as sea) — it will be discarded.
3. Send the padded control (+ style swatch) with that `image_size` and `input_fidelity:"high"`
   (the model preserves the control's spatial layout — the same faithfulness the whole pipeline
   relies on).
4. Crop the returned image back to the un-padded board rectangle (same proportional margins) →
   terrain at the exact board aspect, then the existing downstream sizing/webp applies.

This lives in the terrain package's control/edit path (padding on the way in, cropping on the way
out; both via `sharp`). **Validation confirms** land/sea still aligns after the round-trip. Fallback
if a model reframes despite `input_fidelity:"high"`: `image_size:"auto"` + the existing
`preserveAspectRatio="none"` stretch (terrain is a background, so mild stretch is tolerable).

## The two styles

- **`antique`** — the current colored look, re-validated on gpt-image (its prompt may need light
  tuning for the new model). Keeps `profiles/map.json`.
- **`ink`** — new B&W pen-and-ink: white paper LAND with delicate black line-art (tiny-tree
  forests, hatched mountain ridges, grass tufts), every coast a crisp black line echoed by 3–5
  concentric hand-drawn bathymetric contour rings, on a flat light-grey mottled-parchment SEA. New
  `profiles/ink.json`.

### Ink assets & parameters

- **Texture swatch** `packages/terrain/assets/ink-texture-ref.png`: a two-band legend cropped from
  `Alternate_terrain.png` (TOP = inked land patch, BOTTOM = grey sea patch). Not the whole map
  (full-map ref → composition plagiarism; see [[terrain-generation-quality]]). gpt-image's stronger
  prompt-adherence *may* let us drop the swatch and go prompt-only later — validation will tell; we
  start with the two-image approach for parity.
- **Control colors: keep green/blue** (`landColor #2e7d32`, `seaColor #1565c0`) — internal region
  markers, never shown; the white/grey look comes from the swatch + prompt. (Answers Martin's
  "match white/grey?" — no.)
- **Coast params:** reuse `coastWarp {amplitude:45, scale:0.006, seed:7}`, `organicSigma:20`,
  `background:"sea"` for organic islands; the ring/line look comes from the prompt.
- **Prompt (draft, tuned during validation):**
  > You are given two images. The FIRST image is a control map: solid GREEN regions are LAND, solid
  > BLUE regions are SEA water. The SECOND image is a TEXTURE LEGEND, not a map — its TOP HALF shows
  > the LAND drawing style (hand-drawn black pen-and-ink fantasy cartography on white paper: fine
  > line-art forests as clusters of tiny trees, small mountain ridges as hatched peaks, grass tufts
  > and hills, delicate and sparse) and its BOTTOM HALF shows the SEA drawing style (flat light grey
  > mottled parchment). Redraw the FIRST image as one black-and-white hand-drawn fantasy ink map:
  > place LAND in every GREEN region and SEA in every BLUE region, keeping the same islands and
  > landmasses in the SAME positions, sizes and overall shapes as the control. This is a flat
  > overhead map filling the ENTIRE frame edge to edge — no horizon, no sky, no perspective, no
  > empty margin. Draw every COASTLINE as a crisp black hand-drawn ink line, and echo each coastline
  > with three to five concentric hand-drawn depth-contour lines rippling out into the grey sea
  > (antique bathymetric lines), following the shore's shape. Fill LAND (white paper) with delicate
  > black line-art — scattered tiny tree symbols, small hatched mountain ridges, grass tufts, gentle
  > hill lines — denser inland, sparser near the coast. Keep SEA a flat light grey mottled parchment
  > with only the contour ripples, no waves. IMPORTANT: do NOT copy any shapes, islands, coastlines,
  > or composition from the texture legend — it supplies ONLY the two drawing styles; ALL land and
  > sea placement comes from the control map. CRITICAL MAPPING: green control region becomes white
  > inked LAND, blue control region becomes grey SEA. Do not swap them. Flat top-down 2D map, no
  > labels, no text, no border.

## Style catalog

- Single source of truth in **shared**: `packages/shared/src/api.ts` →
  `export const TERRAIN_STYLES = [{ id: "antique", label: "Antique (colour)" }, { id: "ink", label:
  "Ink (greyscale)" }] as const;` + `export type TerrainStyleId = ...` (default `"antique"`).
- Terrain package: keep `profiles/map.json` as `antique`, add `profiles/ink.json`; export
  `loadStyleProfile(styleId): MapProfile` (antique→map.json, ink→ink.json; validates id). Server
  `defaultProfile()` → `loadStyleProfile("antique")`; `TerrainService` picks by requested style id.

## Integration with the multi-terrain work (PR-A/PR-B)

- **PR-A:** `map_terrains` gains `style_id TEXT NOT NULL DEFAULT 'antique'`; `POST …/terrains`
  accepts `{ styleId }` (validated against `TERRAIN_STYLES`); `TerrainInfo` gains `styleId`.
- **PR-B:** style dropdown on the generate control.
- **PR-C:** unaffected.

## Sequencing (this feature, as its own PR)

1. **Model switch:** adapt `editPass` + `MapProfile` schema + `map.json` (antique) to
   gpt-image-1.5; drop seed reroll. **Validate the antique look with one real gpt-image gen**
   (confirms the pipeline + aspect handling on the new model).
2. **Ink style:** crop `ink-texture-ref.png`, add `ink.json` + `TERRAIN_STYLES` + `loadStyleProfile`.
   **Validate the ink look with one real gen.**
3. styleId threading rides PR-A/PR-B.

Cost: gpt-image edit ≈ $0.04 (medium) / $0.17 (high) per 1024² image + input tokens. Validation
uses `quality:"high"` (2 gens ≈ ≤$0.5); routine generation can drop to `medium`. Martin approved
the validation spend.

## Non-goals / testing / constraints

- No pipeline/model change beyond the edit call; mask/control code unchanged.
- Unit: `MapProfile` parses both profiles under the new schema; `loadStyleProfile` maps ids +
  rejects unknown; `editPass` builds the gpt-image input shape (no seed/resolution; has
  image_size/quality/input_fidelity); fake-fal service tests updated for the new input.
- Visual: the 1–2 fal gens + the `terrain-shot` tool (PR-D) to eyeball on the board.
- Limited fal credits — build/verify offline first, ≤2 validation gens. No new third-party deps
  (still `@fal-ai/client`, just a different model id). `corepack pnpm`; rebuild libs before
  filtered tests; prettier-check changed paths.
