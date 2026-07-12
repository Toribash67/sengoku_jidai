# Terrain styles — selectable generation style

**Date:** 2026-07-12
**Status:** Draft (Martin AFK on the scope question; proceeding with the selectable-style model
implied by his "optional style when generating" wording — flagged). Relates to
[multiple-terrains](2026-07-12-multiple-terrains-design.md).

Add a second terrain **style** — a black-and-white pen-and-ink fantasy-cartography look (from
Martin's `Alternate_terrain.png`) — alongside the current colored antique look, and let the author
choose the style when generating a terrain.

## What a "style" is

Terrain generation is driven by a `MapProfile` (`packages/terrain/profiles/map.json`) bundling:
control colors (`landColor`/`seaColor` — the green/blue region markers in the rasterized control),
a `styleRef` texture-legend image, a `prompt`, and coast params (`coastWarp`/`organicSigma`). A
**style** is one such bundle. Today there is one implicit style; this feature turns it into a small
named catalog.

## The two styles

- **`antique`** — "Antique (colour)". The current look: green→dense sepia-ink land, blue→scalloped
  waves on parchment, soft beach/shallows. Unchanged (this is the existing `map.json`).
- **`ink`** — "Ink (greyscale)". New: white paper LAND with delicate black line-art (tiny-tree
  forests, hatched mountain ridges, grass tufts), every coast a crisp black line echoed by 3–5
  concentric hand-drawn depth-contour rings, on a flat light-grey mottled-parchment SEA.

## Ink style — assets & parameters

- **Texture swatch** `packages/terrain/assets/ink-texture-ref.png`: a two-band legend cropped from
  `Alternate_terrain.png` — TOP = a patch of pure inked land (tree stipples + hill/hatch lines on
  white), BOTTOM = a patch of pure grey mottled sea. **Not** the whole map: feeding a full-map
  reference makes nano-banana plagiarize its composition (the exact bug fixed in
  [[terrain-generation-quality]]). The coastline contour rings are a *coast treatment* → they live
  in the prompt, not the swatch (which shows only pure land and pure sea).
- **Control colors: keep green/blue** (`landColor #2e7d32`, `seaColor #1565c0`). These are internal
  region markers, never shown; the prompt maps green→land, blue→sea. High-contrast hues give the
  model reliable region discrimination. The white/grey *output* palette comes from the swatch +
  prompt, not the control. (This answers Martin's "match white/grey?" — no; matching would lower
  control contrast for no gain.)
- **Coast params:** reuse the antique island geometry — `coastWarp {amplitude:45, scale:0.006,
  seed:7}`, `organicSigma:20`, `background:"sea"` — so islands are organic and match the map. The
  ring/line look comes from the prompt, not the mask.
- **Prompt (draft, to be tuned during validation):**
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

## Style catalog (terrain package)

- The style id/label list is the single source of truth in **shared** so the web picker and the
  server validation agree without an endpoint:
  `packages/shared/src/api.ts` → `export const TERRAIN_STYLES = [{ id: "antique", label: "Antique
  (colour)" }, { id: "ink", label: "Ink (greyscale)" }] as const;` and
  `export type TerrainStyleId = (typeof TERRAIN_STYLES)[number]["id"];` (default `"antique"`).
- The terrain package resolves a style id → profile file. To avoid churn, **keep**
  `profiles/map.json` as the `antique` profile (existing CLI/tests still reference it) and **add**
  `profiles/ink.json`. Export `loadStyleProfile(styleId): MapProfile` mapping `antique`→`map.json`,
  `ink`→`ink.json` (validates the id, reuses `loadMapProfile` internally). The server's
  `defaultProfile()` becomes `loadStyleProfile("antique")`; `TerrainService` picks the profile by
  the requested style id.

## Integration with the multi-terrain work

Threaded through the generation flow being built in PR-A/PR-B:
- **PR-A (backend):** `map_terrains` gains a `style_id TEXT NOT NULL DEFAULT 'antique'` column; the
  migrated legacy row is `antique`. `POST /api/maps/:id/terrains` accepts `{ styleId }` (validated
  against `TERRAIN_STYLES`, default `antique`); the terrain row records it and `TerrainService`
  loads that style's profile. `TerrainInfo` gains `styleId` (so the UI can label a terrain's style).
- **PR-B (editor):** the "Generate new terrain" control gets a style dropdown (from
  `TERRAIN_STYLES`).
- **PR-C (play):** unaffected — the picker just displays whichever terrain is chosen, regardless of
  its style.

## Sequencing

1. **This PR (terrain-styles foundation):** style catalog refactor + `ink` assets/prompt/profile +
   `TERRAIN_STYLES` in shared + `loadStyleProfile`. Self-contained: no server/web behavior change
   (generation still defaults to `antique`). **Validate the ink look with ONE real fal generation**
   (Small Testmap) — holds for Martin's OK to spend ~1 credit; tune the prompt/swatch if it drifts.
2. PR-A/PR-B pick up `styleId` per the section above when they are built.

## Non-goals

- No new fal model or pipeline change (same `nano-banana-pro/edit`, same control/mask code).
- No more than two styles for now.

## Testing

- Pure/unit: `loadStyleProfile` returns the right profile per id and rejects unknown ids;
  `TERRAIN_STYLES` shape; the `ink` profile parses against `MapProfileSchema`.
- The committed `ink-texture-ref.png` swatch exists and the `ink` profile points at it.
- Offline mask check unaffected (control colors unchanged). Visual validation = the 1 fal gen +
  the `terrain-shot` tool (PR-D) to eyeball on the board.

## Constraints

Limited fal credits — validate with ≤1 generation; build/verify offline first. No new third-party
deps. `TerrainStyleId`/`TERRAIN_STYLES` defined once in shared. The `ink-texture-ref.png` asset
must ship in the terrain package's committed assets (already copied into the Docker image with the
other terrain assets). `corepack pnpm`; rebuild libs before filtered tests; prettier-check changed
paths.
