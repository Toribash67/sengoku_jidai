# SP6: Terrain for custom maps — design

**Date:** 2026-07-08
**Status:** Approved
**Initiative:** Custom map editor, sub-project 6 of 6 (final). See `memory/custom-map-editor-initiative.md`.

## Goal

Give every user-authored custom map its own AI-generated terrain background — the same
antique hand-drawn look Rivers has — instead of flat authored tile fills. Custom maps exist
only at runtime (sqlite `HexMapSource` rows under random UUIDs), so this requires generating
terrain on demand rather than committing a static asset.

## The design reversal (approved)

The existing terrain pipeline (`packages/terrain`) is **dev-only and offline**: a CLI reads a
committed `board.svg`, builds a domain-warped land/sea mask, sends it plus a style reference to
fal.ai's edit model, and writes `background.webp`, which is **committed** to
`packages/web/src/assets/<mapId>/` and picked up by a build-time Vite glob. Its README states
"the running app never calls an image API."

This model cannot serve maps a user creates at runtime. SP6 relaxes that rule in one controlled
way: **the server generates terrain on demand, only when the author explicitly triggers it,
using the server's own `FAL_KEY`.** An explicit trigger keeps cost under the operator's control
(not every visitor's), and is the only model that delivers terrain for runtime DB maps.

Built-in Rivers keeps its committed asset and offline workflow unchanged.

## Architecture

Generation reuses the existing pipeline core, refactored to run from an in-memory source rather
than committed files. The board's procedural renderer (`packages/board-render`) already produces
both inputs the pipeline needs — an SVG with `.tile` paths and a `MapDefinition` — from any
`HexMapSource`, so nothing about mask generation is Rivers-specific.

```
author clicks "Generate terrain"
  → POST /api/maps/:id/terrain
     → server loads HexMapSource from MapLibrary
     → svgMarkup = assembleBoardSvg(buildScene(compileHexMap(source)))
     → map      = compileHexMap(source).definition
     → generateTerrainWebp(deps, { svgMarkup, map, profile })   // terrain pkg, fal injected
         → renderLandMask → renderControl → editMapPass (fal.ai) → toWebp
     → store webp + status in map_terrain table
  → GET /api/maps/:id/terrain.webp streams the blob
  → web board swaps flat fills for the terrain image once status = ready
```

### Component 1: terrain pipeline core (refactor)

`packages/terrain/src/mapPipeline.ts` currently has `runMapPipeline` doing filesystem I/O for
both inputs (`getMap`, `mapSvgPath`) and every intermediate. Extract a caller-agnostic core:

```ts
// packages/terrain/src/mapPipeline.ts (exported from index.ts)
export async function generateTerrainWebp(
  deps: EditDeps,
  args: { svgMarkup: string; map: MapDefinition; profile: MapProfile }
): Promise<Buffer>;
```

It runs mask → control → edit → webp with **no filesystem reads or writes** (the style
reference is read from the terrain package via `import.meta.url`, as today; `outputHeightForViewBox`
reads the viewBox from `svgMarkup`). `runMapPipeline` (the dev CLI path for Rivers) becomes a
thin wrapper that resolves `getMap`/`mapSvgPath`, calls `generateTerrainWebp`, and writes the
intermediates to disk for inspection. The terrain package gains **no** dependency on
board-render — the caller supplies `svgMarkup`.

`packages/terrain/src/index.ts` exports `generateTerrainWebp`, `type EditDeps`, `loadMapProfile`,
and `type MapProfile` so the server can consume them.

### Component 2: storage (sqlite blob)

New table, added to the server schema and migrations:

```sql
CREATE TABLE map_terrain (
  map_id     TEXT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,          -- 'pending' | 'ready' | 'failed'
  webp       BLOB,                   -- present when status = 'ready'
  error      TEXT,                   -- present when status = 'failed'
  updated_at TEXT NOT NULL
);
```

The blob lives out of the hot `maps` row and in the same persisted sqlite file (already a
mounted volume on the deploy), so it survives redeploys with no new asset directory to manage.
`ON DELETE CASCADE` ties terrain to its map; deleting a map drops its terrain. A `TerrainStore`
class (new, `packages/server/src/maps/terrainStore.ts`) owns this table with methods
`status(mapId)`, `markPending(mapId)`, `saveReady(mapId, webp)`, `markFailed(mapId, error)`,
`webp(mapId)`.

### Component 3: server generation service

`packages/server/src/maps/terrainService.ts` (new) wires the pieces:

- Holds an in-flight `Set<mapId>` guard so a map generates at most once at a time.
- `available()` — true iff `FAL_KEY` is set (endpoints and the UI use this to disable cleanly).
- `generate(mapId)` — loads the source from `MapLibrary`, builds `svgMarkup`/`map` via
  board-render + engine, marks pending, calls `generateTerrainWebp` with real `EditDeps` (a fal
  client built from `FAL_KEY` + global `fetch`), and on completion calls
  `saveReady`/`markFailed`. Errors are caught and recorded, never thrown to the request.

The server package gains dependencies on `@sengoku-jidai/terrain` and
`@sengoku-jidai/board-render`.

### Component 4: server endpoints

Added to `packages/server/src/api/routes.ts`:

- `POST /api/maps/:id/terrain` — starts generation for a **non-builtin** map.
  - `503` if `!terrainService.available()` (no `FAL_KEY`).
  - `404` if the map does not exist; `400`/appropriate error for a built-in (Rivers uses its
    committed asset).
  - `409` if generation is already in flight for that map.
  - Otherwise marks pending, kicks off generation **without awaiting** (fire-and-forget within
    the process), and returns `202 Accepted`.
- `GET /api/maps/:id/terrain.webp` — streams the `ready` blob with
  `Content-Type: image/webp`, an `ETag`/`Cache-Control` keyed on `updated_at`; `404` until ready.
- `GET /api/maps/:id` (existing `MapDetail`) gains a `terrain` field:
  `"none" | "pending" | "ready" | "failed"`, read from `TerrainStore.status`. Built-ins report
  `"none"` (they never use this path). The shared `MapDetail` DTO in `packages/shared` gains the
  field; the wire/engine drift guard in `library.ts` is unaffected (terrain is server-only state,
  not part of `HexMapSource`).

### Component 5: web wiring

- **Trigger UI:** a **Generate terrain** button for saved custom maps. Primary placement: the
  editor's save-success area / header (a map must be saved — have a real id — before it can
  generate). It is disabled while `terrain === "pending"`, and disabled with an explanatory hint
  when the server reports the feature unavailable (no `FAL_KEY`). On click it POSTs, then polls
  `GET /api/maps/:id` until `terrain` becomes `ready` or `failed`, then updates the UI.
- **Board consumption:** `MapBoard` already accepts a `terrainUrl` prop and paints it as the
  bottom layer (`applyTerrain`). Extend `terrainImage(mapId)` (in
  `packages/web/src/components/board/terrainImages.ts`): built-in Rivers keeps its committed
  Vite-glob asset; a custom map whose detail reports `terrain: "ready"` resolves to
  `/api/maps/:id/terrain.webp`. Flat authored fills remain the fallback everywhere else —
  behavior is unchanged for any map without ready terrain.
- **Regeneration:** the same button regenerates when terrain already exists; each run varies the
  fal `seed` (derived per-attempt) so the author can reroll for a different look.

## Data flow for status

`none` (no row) → author triggers → `pending` → fal round-trip → `ready` (blob stored) or
`failed` (error stored). Re-triggering from `ready`/`failed` returns to `pending`. The board
shows flat fills for every state except `ready`. Generation is a background, cosmetic operation:
it is allowed even for maps referenced by live games (unlike source edits, which 409), because
it never changes `HexMapSource` or game state.

## Error handling

- No `FAL_KEY`: `available()` is false; `POST` returns `503`; the button is disabled with a hint.
  CI and local dev without a key never call fal.
- fal failure / network error: caught in `terrainService.generate`, recorded as `failed` with the
  message; the map stays playable on flat fills; the author can retry.
- A stored map that fails to compile: generation surfaces the compile error as `failed` (same
  path as any other generation error).
- Serving before ready: `GET …/terrain.webp` returns `404`.
- **Server restart mid-generation:** generation runs in-process (fire-and-forget), so a restart
  orphans any `pending` row — no worker is actually running it. On boot, `TerrainStore` resets
  every `pending` row to `failed` (message: interrupted), so the author can re-trigger rather
  than seeing a spinner that never resolves.

## Testing

- **Terrain core:** `generateTerrainWebp` unit-tested with an injected fake `EditDeps` returning
  deterministic bytes — asserts it runs mask→control→edit→webp and returns a valid webp buffer,
  with no filesystem writes. `runMapPipeline` keeps its existing test (Rivers, fs wrapper).
- **Mask from procedural SVG:** a test proving an assembled board-render SVG for a small
  `HexMapSource` produces a valid land mask (the recolor path keys on `.tile` elements, which
  board-render emits — this test guards that contract).
- **TerrainStore:** status transitions, blob round-trip, cascade delete with its map.
- **Endpoints:** `202`/`503`/`404`/`409` paths on `POST`; `GET …/terrain.webp` streams the blob
  with correct content-type and 404s before ready; `MapDetail.terrain` reflects store status —
  all with a fake fal client, never the network.
- **Web:** `terrainImage` resolver (Rivers→committed, ready custom→API url, else null); the
  generate/poll flow. Existing editor/board e2e stays green.

## Deployment / ops notes

- The deployed **server** container needs `FAL_KEY` in its environment for the button to work;
  without it the feature disables cleanly (no crash, button off).
- The server runtime image must include the terrain package's runtime assets — `profiles/map.json`
  and `assets/style-ref.jpeg` — since `generateTerrainWebp` reads them via `import.meta.url`.
  Verify these ship (they are part of the `@sengoku-jidai/terrain` workspace dependency); the
  Dockerfile asset rules in `memory/cross-package-gotchas.md` apply.
- fal.ai spend is bounded by explicit author triggers and the per-map in-flight guard.

## Out of scope (v1, YAGNI)

- Per-map style/prompt controls — one shared profile (`profiles/map.json`) for all maps. Reroll
  varies only the seed.
- Automatic generation on map save — always author-triggered.
- Terrain in the in-editor **live preview** — the editor preview keeps flat fills; terrain
  appears in play and the map library once generated. (Can be added later if desired.)
- Any change to Rivers' committed-asset workflow.

## Suggested delivery

Likely two PRs (a planning detail; the spec is one): **(1) backend** — pipeline core refactor,
`TerrainStore` + migration, `terrainService`, endpoints, `MapDetail.terrain`; **(2) web** —
generate button, status polling, board terrain resolution. Each is independently testable and
leaves the app working (backend PR adds capability with no UI; web PR lights it up).
