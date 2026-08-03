# Terrain fort mask variant + testmap update — design

**Date:** 2026-08-03
**Branch:** `feat/terrain-fort-mask`

## Goal

Two connected pieces:

1. **Mask variant of the fort pass.** In the fort second edit pass, additionally send gpt-image a
   *mask* so edits are constrained to the fort tile regions, on top of the magenta marker we
   already draw. This is a prototype variant of the shipped marker-only fort pass (PR #111,
   `main`); it lives on this branch and is not merged until evaluated.
2. **Update the Small Testmap terrains** (`fc5161b0-f889-41e6-ab32-9106276c86c7`, forts t31/t32).
   Its two existing terrains — Terrain 1 (antique) and Terrain 2 (ink) — predate the fort feature
   and show no castles. Add castles onto the **existing base art** using the mask fort pass, and
   write the updated webp directly into the live DB.

## Part A — mask-based fort pass

fal `gpt-image-1.5/edit` accepts a `mask_image_url`. Convention (OpenAI gpt-image): the mask is an
RGBA image where **transparent (alpha 0) pixels are editable** and opaque pixels are kept. gpt-image
masking is *soft* (whole-image recreation guided by the mask), so this improves localization but
does not hard-lock the rest of the frame — `input_fidelity: high` still carries preservation.

**Mask polarity is verified empirically** (fal's schema page rate-limited during design). Build the
alpha-transparency convention first; keep polarity trivially flippable; confirm on the first real
generation before relying on it.

### Code (all in `packages/terrain/src/`)

- **`fortMaskImage.ts`** (new, pure) — `fortMaskImage({ width, height, discs, invert? }) → Buffer`
  (RGBA PNG). Fully opaque black everywhere, except a transparent disc at each `disc` (`{x,y,radius}`)
  — transparent = editable. `invert` swaps polarity for the empirical check. Unit-tested.
- **`editPass.ts`** — `editMapPass` args gain `maskImage: Buffer | null`. When non-null, upload it
  and add `mask_image_url` to the fal input. `image_urls` order unchanged. Base pass passes `null`.
- **`mapPipeline.ts`**:
  - `padEditCrop` args gain `mask?: Buffer | null`. A mask is letterboxed through the **same**
    `planGptImageAspect` geometry as the control (extend margins fully opaque = keep), and threaded
    to `editMapPass`. No mask → current behaviour exactly.
  - Extract the existing fort-pass body into an exported helper
    **`applyFortPass(deps, { base, width, height, profile, scene }) → Buffer`** (returns a
    width×height PNG). It builds the visible marker overlay (`fortMarkers` at `markerRadiusFactor`)
    **and** the mask (`fortMarkers` at `maskRadiusFactor` → `fortMaskImage`), runs one masked
    `padEditCrop`, returns the result. `generateTerrainWebp` calls it (behaviour-equivalent to today
    plus the mask); Part B calls it over an existing image.
- **`mapProfile.ts`** — `fortPass` gains `maskRadiusFactor` (default 0.7 — larger than the 0.45
  marker so the castle has room to grow inside the editable region).

### Testing (offline)

- `fortMaskImage`: transparent discs at expected fort coords; opaque elsewhere; `invert` flips.
- `editMapPass`: `mask_image_url` present iff a mask is passed; upload count reflects it.
- `applyFortPass` / `generateTerrainWebp`: fort map still runs exactly one fort edit pass and, with
  a mask, the fort pass upload count is control(+marker) + mask (style is null in the fort pass).
- No-fort path unchanged (still skips the pass).

## Part B — update the testmap terrains

Per-terrain, **add to existing base** (1 fal call each, 2 total):

1. Fetch the current terrain webp: `GET http://127.0.0.1:18081/api/maps/<map>/terrains/<tid>.webp`.
2. Decode → run `applyFortPass` over it with the terrain's own style profile
   (`loadStyleProfile('antique' | 'ink')`) and the testmap scene (`mapStructureScene`? no — the
   testmap is a DB map, so build the scene from its `source` via `compileHexMap` + `buildScene`,
   as `terrainService` does) → `toWebp`.
3. Write the bytes back into `/data/sengoku.sqlite` `map_terrains.webp WHERE id=<tid>` via a
   throwaway node script run **inside the container** using the server's `better-sqlite3`, with
   `PRAGMA busy_timeout` set (single-row update against a live DB; low risk on a testmap).

**Sequencing (controls fal spend + resolves polarity):** do Terrain 1 (antique) first, composite on
the board and eyeball — castle present at both forts, magenta gone, rest intact, mask polarity
correct. Only then do Terrain 2 (ink). If polarity is inverted on gen 1, flip and redo gen 1 before
proceeding. Real generations capped: ideally 2, at most 3 if a polarity reflip is needed.

**Write is direct** (no approval gate, per decision), but Terrain-1-first still gives a verification
point before the second spend.

## Out of scope

- The marker-only fort pass on `main` — untouched; this branch is the variant for comparison.
- Any web/editor UI — none needed; the fort pass and mask are internal to generation.
- Merging this branch — a later decision after evaluation.
