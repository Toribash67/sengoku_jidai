# PR-B — Editor Terrains panel

Date: 2026-07-12
Part of the [multiple-terrains initiative](2026-07-12-multiple-terrains-design.md). Follows
PR-D (render tool), PR-1 (gpt-image), PR-2 (ink style) and PR-A (backend many-terrains, PR #86) —
all merged. Precedes PR-C (play-view picker).

## Goal

Replace the editor's single "Generate terrain" button with a **Terrains panel** that lets a map
author manage the up-to-six terrains a map can now hold: list them, rename them, delete them,
generate new ones in a chosen style, retry failed ones, and preview any ready one on the editor
board. This is the first web-facing PR of the initiative; the backend (endpoints and
`MapDetail.terrains[]`) is fully in place from PR-A.

## Background: what already exists

- **Backend (PR-A, merged).** `MapDetail.terrains: TerrainInfo[]`
  (`{ id, name, styleId, status: pending | ready | failed, updatedAt }`, oldest-first). Endpoints:
  - `POST /api/maps/:mapId/terrains` body `{ styleId? }` → `202 { id }`. Errors: `503`
    terrainUnavailable (no `FAL_KEY`), `403` builtinMap, `409` terrainInProgress (generation is
    **one-at-a-time per map**), `422` terrainCap (≥ `MAX_TERRAINS_PER_MAP` = 6), `400`
    invalidStyle / invalidRequest, `404` mapNotFound.
  - `PATCH /api/maps/:mapId/terrains/:terrainId` body `{ name }` (trimmed, 1–40 chars) → `200`;
    `404` terrainNotFound.
  - `DELETE /api/maps/:mapId/terrains/:terrainId` → `204`; `404` terrainNotFound.
  - `GET /api/maps/:mapId/terrains/:terrainId.webp` → `image/webp` (ETag keyed by `updatedAt`);
    `404` terrainNotFound.
  - There is **no per-terrain regenerate endpoint** — a terrain is created once; a failed one is
    replaced by delete + create.
- **Shared constants.** `TERRAIN_STYLES` (`[{id:"antique",label:"Antique (colour)"},
  {id:"ink",label:"Ink (greyscale)"}]`), `DEFAULT_TERRAIN_STYLE = "antique"`,
  `MAX_TERRAINS_PER_MAP = 6`, `isTerrainStyleId`.
- **Style selection is already wired end-to-end.** `POST /terrains {styleId}` →
  `terrainService.generate(mapId, styleId)` → `loadStyleProfile(styleId)`, which swaps **both** the
  gpt-image style-reference image (`antique` → `texture-ref.jpeg`, `ink` → `ink-texture-ref.png`)
  **and** the prompt (each profile's prompt narrates that style-ref's specific features). PR-B only
  plumbs `styleId` from a dropdown into the POST; no terrain-package changes.
- **Editor Preview (existing).** `EditorScreen` renders a board SVG through
  `injectTerrainBackground(svg, url)` when Preview is toggled on. Today the URL comes from
  `resolveTerrainUrl` using the single legacy `terrain` status; `TerrainButton` owns generation and
  polls `fetchMap` while pending, cache-busting the webp with a `terrainVersion` counter.

## Scope

**In:** the Terrains panel component, its wiring into `EditorScreen`, the per-terrain preview
selection, new API-client functions, retirement of the legacy `POST /terrain` web usage, and pure
unit tests.

**Out (non-goals):**
- Play-view terrain picker — **PR-C**.
- Retiring legacy `GET /terrain.webp` and `MapDetail.terrain` — **PR-C** (they stay live so the
  running play view keeps working across the auto-deploy on merge).
- Shared/synced terrain, engine/GameState changes, a per-terrain regenerate endpoint, terrain-package
  or prompt/style changes.

## Design

### Component structure

- **`TerrainsPanel.tsx`** (new) replaces **`TerrainButton.tsx`** (deleted). It renders as a
  full-width collapsible strip in the same slot `TerrainButton` occupies today
  (`EditorScreen`, between the save toast and `.editor-body`), under the **same visibility guard**
  used today: a saved custom map (`state.doc.id` set and not the built-in rivers id). Built-in maps
  never show it (and the backend `403`s them anyway).
- **State ownership.** `EditorScreen` owns two pieces of state, because the Preview overlay needs
  them:
  - `terrains: TerrainInfo[]` — seeded from `detail.terrains` on map load.
  - `selectedTerrainId: string | null` — which terrain the Preview shows; `null` = Flat.
  `TerrainsPanel` is given `{ mapId, terrains, selectedTerrainId, onSelect, onTerrainsChange }`. It
  performs all mutations and polling, and reports fresh lists back up through
  `onTerrainsChange(next)`. `EditorScreen` no longer reads `detail.terrain` (legacy) or keeps a
  `terrainStatus` / `terrainVersion`; those are removed.
- **Row layout** (one per terrain, oldest-first) plus a leading **Flat** row:
  - preview-select radio (◉ / ○) — enabled only for the Flat row and `ready` terrains; `pending`
    and `failed` rows are not selectable for preview.
  - name — inline-editable text.
  - style label (from `TERRAIN_STYLES`, matched on `styleId`).
  - status badge — ready / pending / failed.
  - actions — ✎ rename, 🗑 delete; **Retry** additionally on `failed` rows.

### Data flow and the Preview overlay

- **On map load** (`EditorScreen` load effect): `setTerrains(detail.terrains)` and set
  `selectedTerrainId = defaultSelection(detail.terrains)` — the first `ready` terrain's id, else
  `null` (Flat).
- **Preview URL** — pure function `previewTerrainUrl({ terrains, selectedTerrainId, mapId })`:
  - `null` when `selectedTerrainId` is `null` (Flat) or the selected terrain is absent / not
    `ready`;
  - else `/api/maps/:mapId/terrains/:selectedTerrainId.webp?v=<updatedAt>`.
  The `updatedAt` of the selected `TerrainInfo` is the cache-bust key. **This removes the
  `terrainVersion` counter**: a regenerated terrain changes `updatedAt`, which changes the URL and
  matches the server ETag.
- **Generate → auto-select.** Clicking Generate `POST`s, then refetches the map; the new `pending`
  row is auto-selected (`onSelect(newId)`). Because a `pending` terrain isn't previewable, the
  Preview stays Flat until the terrain flips to `ready`, at which point it appears automatically.
- **Polling.** While `terrains.some(t => t.status === "pending")`, poll `fetchMap(mapId)` every
  1500 ms and call `onTerrainsChange(detail.terrains)`. Reuse `TerrainButton`'s
  lifecycle-cancellation-token pattern (a per-mount `{ cancelled }` ref invalidated on unmount /
  `mapId` change) so no `setState` fires after teardown. Polling stops when no terrain is `pending`.

### Generate control

Top-right of the panel strip: a style `<select>` built from `TERRAIN_STYLES` (default
`DEFAULT_TERRAIN_STYLE`) plus a **+ Generate** button. The button is disabled, with a short reason,
when:

- **at cap** — `terrains.length >= MAX_TERRAINS_PER_MAP` → "Max 6 terrains".
- **generating** — `terrains.some(pending)` → "Generating…".
- **unavailable** — a prior `POST` returned `503` → "Terrain generation isn't configured on the
  server."

Unavailability is discovered lazily on the first `POST` that returns `503` (there is no availability
probe endpoint), exactly as `TerrainButton` does today; once discovered it latches for the panel's
lifetime.

### API client (`packages/web/src/client/api.ts`)

- **Remove** `generateTerrain` (legacy `POST /terrain`).
- **Add:**
  - `createTerrain(mapId, styleId): Promise<{ id: string }>` → `POST …/terrains` body `{ styleId }`.
  - `renameTerrain(mapId, terrainId, name): Promise<void>` → `PATCH …/terrains/:terrainId`.
  - `deleteTerrain(mapId, terrainId): Promise<void>` → `DELETE …/terrains/:terrainId`.
- `fetchMap` is unchanged (already returns `MapDetail.terrains`).

### Row interactions

- **Rename.** Clicking the name (or ✎) turns it into a text input (`maxLength` 40). Commit on Enter
  or blur: optimistic local update, then `renameTerrain`; on error revert and show inline muted
  text. Esc cancels. Empty / whitespace-only input cancels (keeps the old name) — mirrors the
  server's `min(1)` rule.
- **Delete.** 🗑 switches the row to an inline two-step confirm ("Delete this terrain? [Delete]
  [Cancel]"). Confirm → `deleteTerrain` → refetch; if the deleted terrain was selected, selection
  falls back to `defaultSelection(next)`. A `404` (already gone) is treated as success (refetch).
- **Retry** (failed rows only). One action = `deleteTerrain(id)` then `createTerrain(mapId,
  styleOfFailedRow)`; the new terrain is auto-named server-side (new id) and auto-selected. A `404`
  on the delete still proceeds to create.

### Terrain image helper (`packages/web/src/components/board/terrainImages.ts`)

- **Add** `terrainByIdApiUrl(mapId, terrainId): string` → `/api/maps/:mapId/terrains/:terrainId.webp`
  (mirrors the existing `terrainApiUrl`).
- The editor's preview URL now comes from the new `previewTerrainUrl` selection helper (this file or
  a sibling), not `resolveTerrainUrl`. `resolveTerrainUrl` / `terrainApiUrl` / `terrainImage` remain
  for the play view (untouched, PR-C territory).

### Error handling summary

- `POST` (generate/retry): `503` → latch unavailable + disable; `422` → latch cap + disable; `409` →
  a generation is already running, resume polling; `403` → not reachable (panel hidden for
  built-ins); other → generic inline "Generation failed."
- `PATCH` / `DELETE` `404` → the terrain vanished; refetch and reconcile.
- Transient network errors during polling: stop polling, leave the panel in its current state (as
  `TerrainButton` does today).

## Testing

The web package has **no jsdom**, so tests are pure-logic only — no component render tests. Logic is
extracted into pure, exported functions:

- `defaultSelection(terrains)` → first `ready` id or `null`.
- `previewTerrainUrl({ terrains, selectedTerrainId, mapId })` → cache-busted url or `null`.
- `isGenerating(terrains)` → any `pending`.
- `canGenerate({ terrains, unavailable })` → `{ enabled, reason }` covering cap / generating /
  unavailable.
- style-option construction from `TERRAIN_STYLES`.
- `uiFromError(status)`-equivalent status→state mapping (carried over from `TerrainButton`).
- New client functions `createTerrain` / `renameTerrain` / `deleteTerrain` with a mocked `fetch`
  (URL, method, body, error propagation).

Revise `packages/web/test/client/terrainApi.test.ts` (drop `generateTerrain`, add the three new
client fns) and `packages/web/test/board/terrainImages.test.ts` (add `terrainByIdApiUrl` /
`previewTerrainUrl`). Rewrite `packages/web/test/editor/terrainButton.test.ts` into panel-logic
tests. No e2e specs reference terrain, so none change. Run the full gate (typecheck + lint +
`shared`/`engine` rebuild before filtered web tests, per the cross-package build order) and watch CI.

## Files touched

- `packages/web/src/components/editor/TerrainsPanel.tsx` — **new** (replaces `TerrainButton.tsx`).
- `packages/web/src/components/editor/TerrainButton.tsx` — **deleted**.
- `packages/web/src/components/editor/EditorScreen.tsx` — list-based terrain state + selection;
  preview URL via `previewTerrainUrl`; drop `terrainStatus` / `terrainVersion`.
- `packages/web/src/client/api.ts` — remove `generateTerrain`; add `createTerrain` /
  `renameTerrain` / `deleteTerrain`.
- `packages/web/src/components/board/terrainImages.ts` — add `terrainByIdApiUrl` and the
  `previewTerrainUrl` selection helper.
- Tests: `terrainApi.test.ts`, `terrainImages.test.ts`, `terrainButton.test.ts` (rewrite), plus new
  tests for the selection/disable helpers.
- CSS: extend the existing `.editor-terrain` styles into the panel/row layout.

## Backward compatibility

- Legacy `GET /terrain.webp` and `MapDetail.terrain` stay live and untouched — the deployed play
  view keeps working across the merge auto-deploy. Only the legacy `POST /terrain` **web usage** is
  retired here (the endpoint itself remains until PR-C).
- No engine, session, realtime, or backend changes.
