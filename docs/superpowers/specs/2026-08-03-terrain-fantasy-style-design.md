# Fantasy terrain style — design

**Date:** 2026-08-03
**Status:** approved
**Branch:** `feat/terrain-fantasy-style`

## Goal

Add a third selectable terrain generation style, **"Fantasy (colour)"** — a playful,
colourful illustrated fantasy-cartography look (source template:
`/mnt/ssd_pool/ssd_set/terrain-gen/new_fantasy_terrain.PNG`) — alongside the existing
`antique` and `ink` styles. Then generate this style for the Small Testmap
(`fc5161b0-f889-41e6-ab32-9106276c86c7`) and insert it as a live terrain so it appears in
the in-game terrain picker.

Non-goals: no engine / GameState / realtime changes (terrain is purely a client-side
per-viewer preference); no changes to the antique or ink styles; no new built-in map assets.

## Style intent

The reference is icon-rich: cream/parchment land dotted with clustered little pine and
round trees, small rounded green hills, orange/tan ridge mountains; bright teal-blue sea
with fine concentric depth/wave lines; crisp inked "cliff/shelf" coastlines. We want that
**playful illustrated character**, but land/sea **placement comes 100% from our control
map** — never from the reference's composition (the drift-safe approach; see
`multiple-terrains-initiative` memory: never hand the edit model a full-map reference).

Coastline choice: aim for a **crisp inked coastline** (closer to the reference's hard
shelf edges) rather than antique's soft blended shore.

## Changes

### 1. Register the style — `packages/shared/src/api.ts`

Append to `TERRAIN_STYLES`:

```ts
{ id: "fantasy", label: "Fantasy (colour)" }
```

`TERRAIN_STYLES` is the single source of truth: this auto-surfaces the style in the
editor style dropdown (PR-B `TerrainsPanel`), the generate API validation
(`isTerrainStyleId`), and the `TerrainStyleId` union. `DEFAULT_TERRAIN_STYLE` stays
`antique`. No other app-side wiring.

### 2. Map id → profile — `packages/terrain/src/mapProfile.ts`

Add to `STYLE_PROFILE_FILES`:

```ts
fantasy: "fantasy.json"
```

### 3. Profile — `packages/terrain/profiles/fantasy.json`

Mirror ink/antique's `base` block: `landColor #2e7d32`, `seaColor #1565c0`,
`outputSize.width 1024`, `organicSigma 20`, `background "sea"`,
`coastWarp { amplitude 45, scale 0.006, seed 7 }`.

`edit`: `model fal-ai/gpt-image-1.5/edit`, `styleRef "assets/fantasy-texture-ref.png"`,
`quality "high"`, `inputFidelity "high"`. Prompt follows the proven two-image contract:

- FIRST image = control map (solid GREEN = land, solid BLUE = sea). Placement comes
  entirely from it; keep the same islands/landmasses in the same positions, sizes, shapes.
- SECOND image = a **texture legend** (top half = land drawing style, bottom half = sea
  drawing style), explicitly NOT a map to copy composition from.
- Redraw as one bright playful illustrated fantasy map: cream/parchment land with
  scattered clustered little trees, small rounded green hills, orange ridge mountains,
  denser inland / sparser near shore; bright teal-blue sea with a few crisp concentric
  depth-contour lines echoing each shore. Flat overhead, fills the entire frame edge to
  edge, no horizon/sky/perspective/margin, no labels/text/border.
- CRITICAL MAPPING reminder: green → land, blue → sea, do not swap; do not copy shapes
  from the legend.

`fortPass`: `inpaintPrompt` tuned to a small colourful fantasy castle keep (stone walls,
coloured tiered roofs / pennants) that blends into the playful illustrated palette —
mirroring how ink.json overrides the sepia default. `method` stays the default `inpaint`
(FLUX Fill). `webpQuality 82`.

### 4. Texture-ref swatch — `packages/terrain/assets/fantasy-texture-ref.png`

A two-band legend cropped from `new_fantasy_terrain.PNG`: top band = a green forested land
patch (trees + hills), bottom band = a blue sea patch (water + wave lines), stacked with
ImageMagick. Same role as the committed `ink-texture-ref.png` — supplies drawing style
only, never composition.

### 5. Generate + insert into the live test map

Small Testmap `fc5161b0-f889-41e6-ab32-9106276c86c7`.

1. **Offline-verify the control** (fal-free) via `gen:map-control` / the board-render
   composite path before spending.
2. **One real generation** (~$0.17 gpt-image-1.5) using the reusable terrain-validation
   recipe (`multiple-terrains-initiative` memory): FAL_KEY from the running sengoku
   container; throwaway vitest in `packages/terrain/test/` that compiles the map source,
   builds the scene, and calls `generateTerrainWebp(loadStyleProfile("fantasy"))`. Fetch
   the map source from `http://127.0.0.1:18081/api/maps/:id`.
3. **Eyeball** the composite on the board (`terrain-shot.ts` + `svgshot.mjs` → PNG) before
   any further spend. Reroll only if clearly wrong; cap at 1–2 real gens total.
4. **Insert a new `map_terrains` row** into the container's `/data/sengoku.sqlite` mirroring
   `TerrainStore.create` (new uuid, `map_id` = testmap, `name "Fantasy"`,
   `style_id "fantasy"`, `status "ready"`, `webp` = generated blob, timestamps). Back up
   the affected DB rows to scratchpad for rollback. The in-game picker labels terrains by
   their row `name`, so it renders as "Fantasy" on current prod even before the code
   deploys.

### 6. Delivery

TDD: a small test asserting `loadStyleProfile("fantasy")` loads and validates (mirrors any
existing profile test). Full gate — `pnpm typecheck && test && build && lint` +
`prettier --check .` — green before push. One focused PR off fresh `main`; watch CI to
green; ask before merging (squash + delete branch). Merging + deploy is what teaches the
editor/generate API the new style going forward; the live testmap row is inserted directly
and needs no deploy.

## Risks / notes

- gpt-image land-drift is a known failure mode for built-in maps; custom maps (incl. the
  testmap) derive their control from board-render and align well — this path is the good
  one. Still, eyeball before inserting into the DB.
- Delete the throwaway vitest after generation.
- Fal credits are limited: offline-verify first, cap real gens at 1–2.
