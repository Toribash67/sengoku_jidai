# Terrain comparison harness — design

**Date:** 2026-06-28
**Status:** Approved (brainstorm), pending spec review

## Problem

The terrain background pipeline (`packages/terrain`) produces a `generated.png` that
looks almost identical to its flat two-colour control base: a faint watercolour wash
and a few tree dots, no buildings, mountains, or antique-map character. We want a
**rich, antique-style map** — hand-drawn feel, Sengoku-era buildings (castles, torii,
pagodas) drawn *not to scale* as glyphs — explicitly **not** a photorealistic aerial.

### Root cause

The pipeline runs Flux **img2img** at `strength: 0.92` on a flat two-colour base.
img2img *preserves* the base it is handed; a flat base has nothing for the model to
elaborate into terrain or buildings, and the prompt ("no text, no grid") actively
suppresses detail. So the output is a smoothed control image. This is structural —
not fixable by prompt tweaks alone within the img2img-on-flat-base approach.

### Alignment constraint (relaxed)

In `MapBoard.tsx`, unowned/sea hexes are made **transparent so the terrain shows
through them**, with the hex outline grid drawn on top. So the image's land/sea layout
needs *some* correspondence with the hex geometry. Decision: **loose / evocative
alignment is acceptable** — the hex outlines carry the true geometry, so we only need
rough land-vs-sea correspondence. This frees us from faithful img2img preservation and
lets us use stronger generation (ControlNet / txt2img) for much richer output.

## Goal

Replace guess-and-check on a single recipe with a **comparison harness**: generate a
labelled contact sheet of candidates across models × aesthetics × approaches in one
run, eyeball it, and promote the winner. Exploration is the deliverable; a final
locked recipe is the *outcome* of using it, not part of this work.

## Non-goals (YAGNI for v1)

- Auto-promotion of a winner (promotion is a manual step in v1).
- Multi-seed sweeps (one fixed seed per candidate, for fair comparison).
- Any web/UI change. The board already consumes `<mapId>.webp`.
- Ukiyo-e and Ideogram directions (deliberately dropped during brainstorming).

## Approach

### The matrix

A curated **candidate list** (not a rigid cross product) — each candidate is a
self-contained config so models/approaches with different input shapes coexist and
cost is controlled by list length, not multiplied.

First contact sheet: **5 methods × 3 aesthetics = 15 candidates**, ordered model-major,
laid out in a **3-column** sheet (columns = aesthetics, rows = methods).

**Methods (model + approach):**
1. `flux-img2img` — Flux dev image-to-image, the current recipe, kept as **baseline**.
2. `flux-controlnet-canny` — Flux dev ControlNet on the control image's canny edges;
   rich txt2img prompt fills the interior, `controlnet_conditioning_scale` dials how
   tightly coastlines are followed. **Primary new bet.**
3. `recraft-v3` — best-in-class stylised illustration on fal; loose coastline guidance
   via its image-to-image variant. Strongest bet for hand-drawn antique character.
4. `sdxl-map-lora` — SDXL with an antique-cartography / fantasy-map LoRA; cheap, very
   controllable. Requires choosing a specific LoRA (see verification).
5. `sd35-large` — SD 3.5 Large, structural conditioning (img2img/ControlNet); a solid
   non-Flux painterly/parchment alternative.

**Aesthetics (prompt axis):**
- `parchment-japan` — Western antique cartography (sepia parchment, compass rose,
  hand-lettered feel) drawn with Sengoku castles / torii / pagodas as the buildings.
- `sengoku-military` — period war map / e-zu: muted tones, drawn fortifications, roads
  and domains, small castle/town glyphs not to scale.
- `sumi-e` — black ink brush on aged paper, sparse and elegant; mountains and pine as
  ink strokes, castles as small ink pictograms.

### Components

Each unit is small and unit-testable offline, following the existing
`backend.test.ts` / `controlImage.test.ts` patterns (inject `fal`/`fetch`, no live API).

1. **`profiles/matrix.json`** — zod-validated array of named candidates. Each candidate
   = a label + a method tag (`flux-img2img | flux-controlnet-canny | recraft-v3 |
   sdxl-map-lora | sd35-large`) + model id + prompt + per-method params (strength,
   conditioning scale, lora url, etc.) + seed. The committed file ships the 15 above;
   the user edits it to drive future sweeps.

2. **Backend dispatch** (`backend.ts`) — keep `createFalBackend`'s img2img path. Add
   sibling paths keyed by method tag, each constructing the right fal `input` (img2img:
   `image_url` + `strength`; controlnet: control image + `controlnet_conditioning_scale`;
   recraft i2i / sdxl+lora / sd35 their respective inputs). Same injected `fal`/`fetch`.
   The dispatch picks a builder by the candidate's method tag. Output extraction
   (`firstImageUrl`) is shared.

3. **`gen-matrix <mapId>` CLI** (`matrixCli.ts`) — render the colour base once
   (reused as both the img2img source and the ControlNet/canny source), loop the
   candidates, write `terrain/<mapId>/candidates/<label>.png` for each. On a per-candidate
   failure (e.g. a model 404 or safety reject), log and continue so one bad cell doesn't
   sink the whole sheet. Does **not** touch the committed `.webp` or `antique.json`.

4. **Contact-sheet builder** (`contactSheet.ts`) — pure grid-math function that takes
   `[{label, image}]` + a column count and composites a labelled grid PNG via `sharp`
   (already a dep): each cell = the candidate image scaled to a thumb + a caption strip
   (label + key params) rendered as an SVG text overlay. Writes
   `terrain/<mapId>/candidates/contact-sheet.png`. Grid math (rows/cols, cell offsets,
   canvas size) is unit-tested with tiny fake buffers; missing cells (failed candidates)
   render as a labelled blank.

5. **Promotion (manual, v1)** — once a winner is chosen, copy its config fields into
   `antique.json` and run the existing `gen <mapId>` to emit the committed `.webp`.
   No new code; documented in `profiles/README.md`.

### Verification during build (before any paid run)

Confirm exact fal endpoint ids and input param names from fal's current docs, so we do
not burn paid calls on 404s / wrong params:
- Flux ControlNet-canny endpoint + conditioning param name.
- Recraft V3 image-to-image endpoint + style/strength params.
- SDXL endpoint + `loras` shape; **choose a specific antique-map LoRA** and confirm it
  loads on fal.
- SD 3.5 Large img2img/ControlNet endpoint + params.

Capture verified ids/params in `matrix.json` and note them in `profiles/README.md`.

## Data flow

```
getMap + board SVG ──► renderMapBase (existing) ──► base.png (colour base)
                                                     │
                          ┌──────────────────────────┤ (source / canny input)
                          ▼                           ▼
              matrix.json candidates ──► backend dispatch ──► fal ──► candidate PNGs
                                                                         │
                                                       contactSheet.ts ──► contact-sheet.png
                                                                         │
                                              (manual pick) ──► antique.json ──► gen ──► <mapId>.webp
```

## Testing

- `matrix.json` schema validation (valid + invalid fixtures), mirroring
  `styleProfile.test.ts`.
- Backend dispatch: for each method tag, assert the constructed fal `input` has the
  expected keys/values, with an injected fake `fal`/`fetch` (offline), extending
  `backend.test.ts`.
- Contact-sheet grid math: rows/cols/canvas-size for N candidates and a given column
  count; failed/missing cell renders a labelled blank. Tiny fake image buffers.
- No live fal in tests. The matrix CLI itself is thin glue (covered by component tests).

## Cost

~15 fal Flux/Recraft/SDXL/SD3.5 calls per sheet (a few cents to ~$1). Trimming
`matrix.json` reduces it linearly.

## Rollout

Single focused PR: harness + `matrix.json` + tests + README note. No change to the
committed terrain asset or the default profile in this PR — the winner is promoted in a
follow-up once the sheet has been reviewed.
