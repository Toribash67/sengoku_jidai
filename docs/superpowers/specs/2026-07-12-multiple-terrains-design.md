# Multiple selectable terrains — umbrella design

**Date:** 2026-07-12
**Status:** Draft (foundational decisions made with Martin AFK on the go-ahead; per-viewer model
confirmed *by implication* from his answers — see Open questions)

The north-star design for letting a map carry several named terrain textures that a player can
switch between while playing (including the clean flat-shaded look), and that the author can
manage in the editor. Split into four focused PRs, each with its own spec → plan → PR.

## Problem

Terrain today is one image per map: generating replaces it, the play view auto-shows it, and
there is no way to keep several, name them, delete them, or choose between them (or turn it off)
while playing. Martin wants a small library of terrains per map, selectable in-game — flat
included.

## Key decisions

- **Per-viewer local preference (foundational).** Terrain is already a purely client-side visual
  concern (`useTerrainUrl(mapId)` → `MapBoard`; nothing terrain-related is in the engine or game
  state). The in-game terrain choice is therefore a **local, per-viewer preference** persisted in
  `localStorage` — it does not affect the game, opponents, determinism, or the multiplayer sync
  path. This keeps the whole feature out of the engine/session/realtime layers.
- **Auto-named, capped.** New terrains are auto-named "Terrain 1", "Terrain 2", … (renameable);
  capped at **6 per map** to bound fal cost and DB blob storage.
- **Flat by default in-game.** When a game opens, the picker starts on **Flat** (clean shaded);
  the player opts into a terrain. (This changes today's behavior, where terrain auto-shows.)
- **Render tool = local dev script.** A `map id + terrain → PNG` script for local visual
  verification (the check that would have caught the terrain-hidden bug). Not a CI gate — headless
  Chromium only runs on Martin's box via the `LD_LIBRARY_PATH` userland-libs shim.

## Non-goals

- No shared/synced terrain (one choice the whole game sees). Explicitly out until requested.
- No engine, `GameState`, session, or realtime changes.
- No terrain generation quality/pipeline changes (the terrain package is untouched except its
  build already ships to dist).

## Data model (introduced in PR-A)

Replace the one-row-per-map `map_terrain` table with a one-to-many `map_terrains`:

```sql
CREATE TABLE map_terrains (
  id         TEXT PRIMARY KEY,           -- surrogate terrain id
  map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL,              -- pending | ready | failed
  webp       BLOB,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX map_terrains_map_id ON map_terrains(map_id);
```

Migration 004 copies each existing `map_terrain` row into `map_terrains` (name "Terrain 1"),
then drops `map_terrain`. Generation stays **one-at-a-time per map** (the existing in-flight
guard, keyed by map id).

## API surface (introduced in PR-A)

- `MapDetail.terrain: TerrainStatus` (single) → `MapDetail.terrains: TerrainInfo[]`
  where `TerrainInfo = { id: string; name: string; status: TerrainStatus; updatedAt: string }`.
- `POST   /api/maps/:id/terrains`            → start a new generation (auto-named, cap-checked);
  202 `{ id }`. 409 if a generation is already running for the map; 422 if at the cap; 503 if no
  FAL_KEY; 403 for built-ins.
- `PATCH  /api/maps/:id/terrains/:tid`  `{ name }` → rename; 200.
- `DELETE /api/maps/:id/terrains/:tid`             → delete; 204.
- `GET    /api/maps/:id/terrains/:tid.webp`        → serve that terrain's webp (ETag; 404 before
  ready). Retire the single `GET /api/maps/:id/terrain.webp`.

## Decomposition (build order D → A → B → C)

**PR-D — Chromium terrain render dev tool** (this repo's first sub-project; own spec
`2026-07-12-terrain-render-tool-design.md`). Standalone, no dependency on A. Relocates the pure
SVG composite helpers into `board-render` so the tool and the app share one code path.

**PR-A — Backend: many terrains per map.** The data model + API above. Reworks `TerrainStore`
(surrogate ids, list/rename/delete), `TerrainService` (generate → new row), routes, and
`MapDetail`. Foundation for B and C.

**PR-B — Editor: manage terrains.** Replaces the single "Generate terrain" button with a
Terrains panel: list (inline-rename, status badge, delete-with-confirm), "Generate new terrain"
(auto-named, disabled at cap / while generating / without FAL_KEY), and a selector that drives
the existing Preview overlay per terrain.

**PR-C — In-game: pick a terrain.** A terrain selector in the play view: **Flat** + the map's
ready terrains (built-ins also expose their committed "Original" asset). Choice persisted in
`localStorage` per map; default **Flat**.

## Testing strategy

- Pure logic (web has no jsdom): terrain-list resolution, picker option-building, url selection,
  cap/name logic — unit-tested.
- Server: store/service/route tests with a fake fal client (as today).
- Visual: the PR-D render tool for local before/after checks on B and C.
- E2e: editor + play specs stay green; no generation-dependent e2e (CI has no FAL_KEY).

## Open questions (flagged for Martin)

1. **Per-viewer vs shared** terrain choice — proceeding per-viewer (implied by his "Flat default"
   + "a player picks" answers). Revisit here if he wants a shared/synced choice.
2. **Cap = 6** — a guess to bound cost; adjust freely.
