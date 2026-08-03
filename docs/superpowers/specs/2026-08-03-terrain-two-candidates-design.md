# Two-candidate terrain generation — design

**Date:** 2026-08-03
**Status:** approved
**Branch:** `feat/terrain-generate-two-candidates`

## Goal

In the map editor, every terrain **Generate** produces **two candidate images**; the author
picks which one to keep. This mitigates the occasional strange gpt-image result. To save
FLUX credits, candidates are **base-only** (no fort castles); the fort inpaint runs **once**,
on the chosen winner, when the author keeps it.

Non-goals: no change to the in-game play-view picker (it already shows only `ready`
terrains); no change to antique/ink/fantasy *profiles*; no engine/GameState/realtime changes;
not generalising beyond exactly two candidates (YAGNI).

## User-visible flow

1. Author clicks **Generate** (with a style) in the editor Terrains panel.
2. The terrain row shows a generating spinner while **two base-only** terrains render
   (gpt-image has no seed → the two differ naturally).
3. The row enters a **`choosing`** state: the panel shows the **two candidate previews**
   side by side, each with a **Keep** button. (Previews are base terrain only — no castles.)
4. Author clicks **Keep** on one. The server runs the **fort inpaint** on that base (a no-op
   if the map has no forts), commits it as the terrain's final image, and the row becomes
   **`ready`**. A short spinner covers the inpaint.
5. While `choosing`, **Regenerate** (discard both, render two fresh) and **Delete** (existing)
   are available. A base-generation failure → existing `failed` state (author retries).

The in-game picker is unaffected: `buildTerrainOptions` already lists only `ready` terrains,
so `choosing`/`pending`/`failed` terrains never reach players.

## Status model (minimal surface change)

Add one value to `TerrainStatus`: **`choosing`**. The lifecycle of a terrain row:

| Phase | status | candidates present | webp |
|---|---|---|---|
| Rendering the 2 base candidates | `pending` | 0 | NULL |
| Waiting for the author to pick | `choosing` | 2 | NULL |
| Finalising (fort inpaint on winner) | `pending` | 2 (until success) | NULL |
| Kept | `ready` | 0 | final webp |
| Base gen or finalise failed | `failed` | 0 | NULL |

Only `choosing` is new. Both "rendering" and "finalising" reuse `pending` → the panel shows a
generic spinner for `pending`; it shows the two-candidate chooser for `choosing`. The client
never needs to distinguish the two `pending` sub-phases.

## Data model

New table (migration `006_terrain_candidates.sql`), registered in `database.ts`'s migration
array:

```sql
CREATE TABLE map_terrain_candidates (
  id         TEXT PRIMARY KEY,
  terrain_id TEXT NOT NULL REFERENCES map_terrains(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  webp       BLOB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(terrain_id, idx)
);
CREATE INDEX map_terrain_candidates_terrain_id ON map_terrain_candidates(terrain_id);
```

`foreign_keys = ON` is already set (`database.ts`), so deleting a terrain cascades its
candidates. The store also clears candidates explicitly on regenerate/markReady/markFailed
(idempotent — never depend solely on cascade). Keeping candidates in a side-table (rather
than blob columns on `map_terrains`) keeps `SELECT *` list queries — which build every
`TerrainInfo` — from dragging two extra blobs.

## Pipeline (terrain package)

The pipeline already separates base and fort work:
- **Base-only candidate** = `generateTerrainWebp(deps, { svgMarkup, map, profile })` **without
  `scene`** → the fort pass is skipped (existing behaviour: `hasForts` is false when no scene),
  returning a complete base webp.
- **Finalise (fort inpaint on a chosen base)** — new exported helper:
  `inpaintFortsOnWebp(deps, { webp, profile, scene }): Promise<Buffer>`. It decodes the base
  webp to derive width/height, and — when the scene has forts — runs the existing
  `applyInpaintFortPass` (FLUX, per-disc) / `applyFortPass` branch keyed by
  `profile.fortPass.method`, then re-encodes to webp at `profile.webpQuality`. No forts →
  returns the input bytes unchanged. This is the same mechanism the fort-mask work used to add
  castles onto existing base art, packaged as a reusable function.

## Server: service + store + routes

**`TerrainStore`** gains candidate operations (kept in the terrain aggregate so state
transitions stay consistent):
- `markChoosing(terrainId)` — set status `choosing`, bump `updated_at`.
- `addCandidate(terrainId, idx, webp)` / `clearCandidates(terrainId)`.
- `candidateWebp(terrainId, idx): Buffer | null` (only while the row is `choosing`).
- `candidateCount(terrainId): number`.
- `markReadyById` / `markFailedById` / `markPendingById` (on regenerate) also
  `clearCandidates` for consumed/abandoned candidates.

**`TerrainService`**:
- `generate(mapId, styleId)`: create the row (`pending`), then in the async worker render
  **two base-only** webps **concurrently** (`Promise.all`), `addCandidate(0/1)`, then
  `markChoosing`. Inflight guard stays keyed by map id (one generation at a time per map). Any
  base failure → `markFailedById` + `clearCandidates`.
- `choose(mapId, terrainId, index)`: guard the row is `choosing`, `index ∈ {0,1}`, map not
  inflight. Set `pending` (finalising), then async: take `candidateWebp(index)`, run
  `inpaintFortsOnWebp` (needs the map's `scene`/`svgMarkup`, built the same way `run` does),
  `markReadyById(final)` + `clearCandidates` on success. On failure → revert to `choosing`
  (candidates intact) so the pick can be retried; surface the error.

**Routes** (`packages/server/src/api/routes.ts`):
- `POST /api/maps/:mapId/terrains` — unchanged signature; now yields a `choosing` row + 2
  candidates. Existing availability/existence/built-in/inflight/cap guards stay.
- `GET /api/maps/:mapId/terrains/:terrainId/candidates/:idx.webp` — serve candidate `idx`
  (0/1) when the row is `choosing`; 404 otherwise. Same content-type/ETag(`updated_at`)
  handling as the existing `.webp` route.
- `POST /api/maps/:mapId/terrains/:terrainId/choose` — body `{ index: 0 | 1 }`; validates and
  calls `service.choose`. Guarded like the other mutations.
- `PATCH` (rename), `DELETE`, and `GET …/:terrainId.webp` (ready-only) unchanged. `DELETE`
  drops candidates via cascade.

## Client (web editor)

- `client/api.ts`: add `chooseTerrainCandidate(mapId, terrainId, index)` and a
  `candidatePreviewUrl(mapId, terrainId, idx, updatedAt)` helper (cache-busted by `updatedAt`).
- `TerrainsPanel.tsx`: when `terrain.status === 'choosing'`, render two candidate thumbnails
  (`idx` 0 and 1) each with a **Keep** button that calls `chooseTerrainCandidate`; show a
  spinner for `pending`; keep existing rename/delete/generate/regenerate affordances. Polling
  of terrain status (already how pending→ready refreshes) drives the transitions.
- `terrainImages.ts` `buildTerrainOptions` needs no change (already `status === 'ready'` only);
  add a test asserting a `choosing` terrain is excluded from play-view options.

## Testing

- **terrain**: `inpaintFortsOnWebp` adds forts to a base webp (fake deps) and is a no-op with
  no forts; base-only `generateTerrainWebp` (no scene) makes no fort model calls.
- **terrainStore**: candidate add/get/clear, `markChoosing`, and that `markReady`/`markFailed`
  clear candidates.
- **terrainService**: `generate` renders 2 candidates and lands in `choosing` (fake deps
  return 2 base webps; assert 2 base calls, 0 fort calls); `choose` finalises with one fort
  inpaint and clears candidates; base failure → `failed`; choose failure → back to `choosing`.
- **routes** (`terrainApi.test.ts` pattern): candidate webp serves while choosing / 404 when
  ready; `choose` finalises and the `.webp` then serves; invalid index rejected.
- **migration**: `006` creates the table (covered by the store tests running on a migrated DB).
- **web**: `buildTerrainOptions` excludes `choosing`; a `TerrainsPanel` test for the chooser
  (two Keep buttons, clicking calls the API).

## Cost

Per accepted terrain: **2× base** (~2×$0.17) + fort inpaint **once** on the winner
(~$0.05/fort). Testmap (2 forts): ~$0.44, vs ~$0.54 if both candidates were fully inpainted.

## Risks / notes

- Two concurrent gpt-image calls per generate — acceptable; still one generation at a time per
  map. Fal credits: this is an author-triggered action, and always-2 is the point (quality).
- Boot recovery (`resetInterrupted`) flips `pending`→`failed` as today; a row interrupted mid
  finalise becomes `failed` (its orphaned candidates are cleared on the failing transition or
  cascade on delete). A `choosing` row (no in-flight compute) survives a restart fine.
- `MAX_TERRAINS_PER_MAP` (6) counts terrain rows; a `choosing` terrain is one row, so the cap
  is unchanged.
