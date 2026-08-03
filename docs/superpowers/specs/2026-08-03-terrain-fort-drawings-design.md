# Terrain fort drawings — design

**Date:** 2026-08-03
**Branch:** `feat/terrain-fort-drawings`

## Goal

Extend terrain generation so that every tile carrying a fort (`map.areas[x].fort === true`)
also shows a drawn fort in the generated terrain background art — a Sengoku-era Japanese castle
(tenshukaku with tiered roofs), medium size, sitting inside the tile without dominating it.

This is purely about the AI-generated terrain background (the `background.webp` per terrain).
Forts already exist in the data model (land-only) and are already drawn on the *board* as a white
nested tile border (board-render, shipped in PR #106/#108). That on-board border is untouched here.

## Approach

A **second gpt-image edit pass** runs after the base terrain is generated:

1. Generate the base terrain exactly as today (`renderLandMask → renderControl → pad → edit → crop`).
2. If the map has one or more fort tiles:
   a. Derive each fort tile's centroid + size from the board `BoardScene` (viewBox coords) and
      scale to output-image pixels (uniform scale = `outputWidth / viewBox.width`).
   b. Overlay a bright, distinct signal-color marker (a ring) at each fort location on the base
      terrain, producing the second pass's control image.
   c. Pad → run a second `editMapPass` (`input_fidelity: high`) prompting the model to draw one
      Japanese castle at each marker in the same hand-drawn style, remove the marker, and leave
      everything else unchanged → crop back to board size.
3. `toWebp`.

If the map has **no** fort tiles, the second pass is skipped entirely: no extra fal generation,
byte-for-byte the same result as today (no regression for existing maps/terrains).

Rationale for two-pass over baking forts into the flat control: it preserves the good base
terrain, lets each fort auto-match whatever style was generated, is far easier to tune (re-run
only the fort pass), and avoids the model misreading a small marker in the flat control as an
island. Cost: two generations instead of one for fort-bearing maps — accepted by the user for
better results.

## Data flow

```
buildScene(compiled)  ──►  fort tiles: { centroid, hexSize }  (viewBox coords)
        │
generateTerrainWebp(deps, { svgMarkup, map, profile, scene }):
  base = renderLandMask → renderControl → padEditCrop(control)          [unchanged]
  markers = fortMarkers(scene, outWidth, outHeight, profile.fortPass)   [pure]
  if markers.length:
     overlaid = fortMarkerOverlay(base, markers, profile.fortPass)      [pure, sharp]
     base = padEditCrop(overlaid, fortPrompt)                           [2nd edit pass]
  return toWebp(base)
```

Both existing call sites already compute `buildScene(compiled)` immediately before calling
`generateTerrainWebp`, so the scene is passed in with no extra work:
- server custom-map path: `packages/server/src/maps/terrainService.ts`
- dev CLI path: `runMapPipeline` in `mapPipeline.ts` (via `mapStructureSvg`, which builds the scene)

## Components

New files under `packages/terrain/src/`:

- **`fortMarkers.ts`** — pure. `BoardScene` + output width/height + fort-pass config →
  `FortMarker[]` = `{ x, y, radius }` in output pixels. Filters `features.fort === true`,
  scales `centroid` by `outputWidth / viewBox.width`, `radius = hexSize * markerRadiusFactor * scale`.
  No I/O. Unit-tested.

- **`fortMarkerOverlay.ts`** — takes the base terrain buffer + markers + config, builds a small
  SVG drawing one ring per marker in the signal color, composites it over the base terrain with
  sharp, returns a PNG. Deterministic. Unit-tested (marker pixels present at expected coords).

Changed files:

- **`mapPipeline.ts`** — extract the existing pad→edit→crop of pass 1 into a private helper
  (`padEditCrop`) taking the control buffer + prompt, so the fort pass reuses identical
  letterbox/crop geometry. Add the conditional second pass. `generateTerrainWebp` gains a
  `scene: BoardScene` field in its args object.

- **`mapProfile.ts`** — add an optional `fortPass` block to the schema:
  - `prompt: string` (default: draw one Japanese tenshukaku castle at each bright marker, same
    hand-drawn style, remove the marker, leave everything else unchanged)
  - `markerRadiusFactor: number` (default ~0.45 of hexSize; tuned during verification)
  - `markerColor: string` (a bright signal color absent from terrain palettes, e.g. magenta)

- **`profiles/map.json` / `profiles/ink.json`** — inherit the default fort prompt; `ink.json` may
  override the prompt to suit the B&W pen-and-ink style.

- **Call sites** (`terrainService.ts`, `runMapPipeline`) — pass the already-built `scene`.

## Key risk & mitigation

The one non-deterministic step is whether gpt-image draws a clean castle at each marker while
preserving the rest of the image. Mitigations:
- bright, distinct marker color not present in the terrain palettes,
- explicit "leave every other area completely unchanged" in the prompt,
- `input_fidelity: high`.

Verified with **capped real generations** (≤2) using the terrain-validation recipe (a throwaway
vitest that pulls the live FAL_KEY from the running container), on a test map that has a fort,
eyeballing the composite via `terrain-shot` + svgshot. Fal spend is limited — offline-verify the
deterministic marker overlay first, then run at most 1–2 real generations.

## Testing

- **Offline unit tests** (no fal):
  - `fortMarkers`: correct count, positions, and scaling for single- and multi-hex fort tiles;
    empty when no forts.
  - `fortMarkerOverlay`: composited marker pixels appear at the expected output coordinates.
  - Two-pass orchestration: with a fake `EditDeps`, a map **with** a fort invokes the edit fn
    **twice** and the second call's control image differs from the first (markers present); a map
    **without** forts invokes it **once** and the output equals the base.
- **Manual capped real-gen** verification per the recipe above.

## Out of scope

- The on-board fort border (board-render) — already shipped, unchanged.
- Engine / GameState / realtime — forts already exist in the data model; no changes.
- Regenerating existing built-in terrains (Rivers ships with no forts).
