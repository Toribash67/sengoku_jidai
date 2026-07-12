# PR-A — Backend: many terrains per map

**Date:** 2026-07-12
**Status:** Draft (Martin asked to "spec and plan PR-A"; he was AFK on the compat fork — I took
the recommended path and **flagged every decision below for his spec review**). Relates to
[multiple-terrains umbrella](2026-07-12-multiple-terrains-design.md),
[terrain-styles](2026-07-12-terrain-styles-design.md), and [[multiple-terrains-initiative]].

## Goal

Replace the one-terrain-per-map backend with a **one-to-many** model: a map can carry several
named, styled terrains (auto-named, capped), each independently generated / renamed / deleted /
served. This is the data + API foundation for the editor Terrains panel (PR-B) and the in-game
picker (PR-C). Terrain generation itself (the terrain package) is unchanged.

## The compatibility constraint (why this PR is additive, not breaking)

The umbrella spec calls PR-A "backend only" and says to *retire* `GET /terrain.webp` +
`MapDetail.terrain`. But the live web app reads `MapDetail.terrain` (single status) and
`/terrain.webp` in **five** places (`useTerrainUrl`, `terrainImages.resolveTerrainUrl`,
`TerrainButton`, `EditorScreen`, `App`) and posts to `POST /terrain`, and **`main` auto-deploys
on every merge** (Watchtower). Retiring those in PR-A would ship a broken app between merges.

**Decision (flagged — recommended path, Martin AFK on the fork):** PR-A is **purely additive +
backward-compatible on the server, zero web changes.** It migrates the table and adds the new
`terrains[]` field + per-terrain endpoints, while keeping the legacy `terrain` field,
`GET /terrain.webp`, and `POST /terrain` working — re-backed by the new table against a
**"primary" terrain** (the oldest row). PR-B swaps the editor onto the new endpoints and removes
the legacy `POST`; PR-C swaps the play view and removes `GET /terrain.webp` + `MapDetail.terrain`.
Every intermediate merge leaves the deploy working.

> Alternative considered: make the breaking change in PR-A and minimally patch the 5 web consumers
> to read `terrains[0]`. Rejected — it drags PR-A into the web package with throwaway code that
> PR-B/PR-C immediately rewrite, for no lasting benefit. The additive adapter is smaller and
> keeps a clean package boundary.

## Decisions (all flagged for Martin's spec review)

1. **Additive + backward-compatible** (above) — the crux; revisit if you'd rather break now.
2. **`style_id` lands in PR-A** — now that `ink` shipped (PR-2), the column + `POST {styleId}` +
   `TerrainInfo.styleId` belong here so PR-B's style dropdown has a backend. Default `'antique'`,
   validated with `isTerrainStyleId` (from PR-2).
3. **Cap = 6 per map**, as a shared constant `MAX_TERRAINS_PER_MAP` so the editor (PR-B) can
   disable "generate" at the cap using the same number. Adjust freely.
4. **Primary terrain = the oldest row** (min `created_at`; for existing maps that's the migrated
   "Terrain 1"). Drives the legacy surfaces only, and only until PR-C retires them. Simple and
   stable; no "which one shows" ambiguity.
5. **Auto-name = "Terrain N"** where N = (max existing `Terrain <n>` number) + 1, else 1.
   Renameable; not unique-constrained.
6. **Generation stays one-at-a-time per map** (existing in-flight guard, keyed by map id).

## Data model — migration `004_map_terrains.sql`

```sql
CREATE TABLE map_terrains (
  id         TEXT PRIMARY KEY,            -- surrogate terrain id (opaque)
  map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  style_id   TEXT NOT NULL DEFAULT 'antique',
  status     TEXT NOT NULL,              -- pending | ready | failed
  webp       BLOB,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX map_terrains_map_id ON map_terrains(map_id);

-- Carry existing single terrains over as "Terrain 1" (antique). created_at is the best we have
-- (the old row's updated_at). ids minted in-DB so the migration needs no app code.
INSERT INTO map_terrains (id, map_id, name, style_id, status, webp, error, created_at, updated_at)
SELECT lower(hex(randomblob(16))), map_id, 'Terrain 1', 'antique', status, webp, error,
       updated_at, updated_at
FROM map_terrain;

DROP TABLE map_terrain;
```

Append `"004_map_terrains.sql"` to the migrations array in
`packages/server/src/persistence/database.ts` (raw-SQL runner, applied once, recorded in
`schema_migrations`).

## Shared API types (`packages/shared/src/api.ts`)

```ts
export interface TerrainInfo {
  id: string;
  name: string;
  styleId: TerrainStyleId;         // from PR-2's catalog
  status: Exclude<TerrainStatus, "none">;  // a row is always pending|ready|failed
  updatedAt: string;
}

export interface MapDetail {
  // …existing fields…
  terrain: TerrainStatus;   // LEGACY: primary terrain status ("none" if the map has no terrains).
                            // Kept working through PR-B/PR-C; PR-C removes it.
  terrains: TerrainInfo[];  // NEW: all terrains for the map, oldest first. [] for built-ins.
  source: HexMapSourceDto;
}

export const MAX_TERRAINS_PER_MAP = 6;
```

## `TerrainStore` rework (`packages/server/src/maps/terrainStore.ts`)

Owns `map_terrains`. New surrogate-id API + legacy per-map adapters:

```ts
create(mapId, name, styleId): string        // insert a pending row, return new id
list(mapId): TerrainInfo[]                   // oldest-first (ORDER BY created_at, id)
countForMap(mapId): number                   // cap check
styleIdOf(terrainId): string | null          // service picks the profile
rename(terrainId, name): boolean             // false if id unknown
remove(terrainId): boolean                   // delete row + blob; false if unknown
markReadyById(terrainId, webp): void
markFailedById(terrainId, error): void
webpById(terrainId): Buffer | null           // ready + has blob
updatedAtById(terrainId): string | null
resetInterrupted(): void                     // pending → failed at boot (unchanged intent)

// Legacy adapters (primary = oldest row), used only by the retained legacy routes/field:
primaryId(mapId): string | null
status(mapId): TerrainStatus                 // primary status, "none" if no rows
updatedAt(mapId): string | null              // primary updatedAt
webp(mapId): Buffer | null                   // primary ready webp
```

`create`/`markReadyById`/`markFailedById` stamp `updated_at` (and `create` sets `created_at`).
Deleting a terrain frees its blob (row delete).

## `TerrainService` rework (`packages/server/src/maps/terrainService.ts`)

The in-flight guard stays keyed by **map id** (one generation per map at a time). Two entry
points share one private worker:

```ts
// NEW — create a fresh terrain and generate it. Cap/guard checked by the route first.
generate(mapId, styleId): string             // returns new terrain id
// LEGACY adapter — regenerate the primary terrain in place, or create "Terrain 1" if none.
regeneratePrimary(mapId): void

// private: compile → assembleBoardSvg → generateTerrainWebp(loadStyleProfile(styleId))
//          → markReadyById / markFailedById; inflight add/delete keyed by mapId.
private run(mapId, terrainId, styleId): Promise<void>
```

`generate` calls `store.create(mapId, autoName(store.list(mapId)), styleId)` then `run`.
`regeneratePrimary` reuses `store.primaryId(mapId)` (re-pending same id) or creates "Terrain 1"
(antique) — this exactly preserves today's single-terrain editor/play behavior.

`autoName(existing: TerrainInfo[]): string` is a pure helper (unit-tested): `"Terrain " +
(max n in names matching /^Terrain (\d+)$/, else 0) + 1`.

## API routes (`packages/server/src/api/routes.ts`)

**New (additive):**

- `POST /api/maps/:id/terrains`  body `{ styleId? }` → **202 `{ id }`**. Guards, in order:
  400 bad id · 503 no FAL_KEY · 404 unknown map · 403 built-in · 409 already generating ·
  **422 at cap** (`terrainStore.countForMap ≥ MAX_TERRAINS_PER_MAP`) · 400 invalid `styleId`
  (`!isTerrainStyleId`). On success `const id = terrainService.generate(mapId, styleId ?? "antique")`.
- `PATCH /api/maps/:id/terrains/:tid`  body `{ name }` → **200**; 404 if the terrain id is
  unknown / not this map; 400 on empty/oversized name (trim, 1–40 chars).
- `DELETE /api/maps/:id/terrains/:tid` → **204**; 404 if unknown. (Deleting the primary just
  promotes the next-oldest to primary automatically — it's a query, not stored.)
- `GET /api/maps/:id/terrains/:tid.webp` → the terrain's webp (`Content-Type image/webp`,
  `Cache-Control`, `ETag "<tid>-<updatedAt>"`); 404 before ready / unknown.

**Legacy (kept, re-backed on the new table — removed later by PR-B/PR-C):**

- `POST /api/maps/:id/terrain` → `terrainService.regeneratePrimary`; same 202/409/503/403/404
  contract as today.
- `GET /api/maps/:id/terrain.webp` → `terrainStore.webp(mapId)` (primary); unchanged contract.

`mapLibrary.get(id, terrainStatusFn, terrainsFn?)` gains a second optional callback so the route
populates both `terrain` (primary status) and `terrains` (`terrainStore.list`). Built-ins:
`terrain: "none"`, `terrains: []`.

## Testing strategy

- **Store** (`terrainStore.test.ts`, extend): create/list ordering, count, rename/remove
  (+ unknown-id false), ready/failed by id, `webpById`, primary adapters (oldest, promotion after
  delete, "none" when empty), `resetInterrupted`.
- **autoName** — pure unit: empty → "Terrain 1"; [1,2] → "Terrain 3"; gap [1,3] → "Terrain 4";
  non-matching names ignored.
- **Service** (`terrainService.test.ts`, update fake-fal): `generate` creates a new ready row +
  returns id; second `generate` while one runs is blocked by the guard; `regeneratePrimary`
  updates the primary in place / creates Terrain 1 when none; failure path records `failed` on
  the right id; `generate` uses `loadStyleProfile(styleId)` (ink vs antique).
- **Routes** (`terrainApi.test.ts`, extend): POST returns 202+id and caps at 422; PATCH/DELETE
  happy + 404; GET `/terrains/:tid.webp` ready/404; legacy `POST /terrain` + `GET /terrain.webp`
  still pass their existing assertions; `MapDetail.terrains` shape + legacy `terrain` field both
  present.
- **Migration** (`database.test.ts` or a focused test): seed a pre-004 DB with a `map_terrain`
  row, run migrations, assert one `map_terrains` row named "Terrain 1", style `antique`, blob and
  status carried, and `map_terrain` gone.
- **Backward-compat regression:** existing `terrainStore.test.ts` / `terrainApi.test.ts` /
  `terrainService.test.ts` assertions that exercise the legacy surface must keep passing (adjust
  only where they poke table internals).

## Non-goals

- No web changes (PR-B/PR-C). No engine/GameState/session/realtime changes. No terrain-package
  changes. No shared/synced terrain choice. No per-terrain concurrent generation (still one per
  map). No auth/ownership model beyond today's built-in guard.

## Constraints / gotchas

- `corepack pnpm`; rebuild `shared` dist before server filtered tests (dist-consumption trap,
  [[cross-package-gotchas]]) since `MAX_TERRAINS_PER_MAP` / `TerrainInfo` are new shared exports.
- Migration is one-way (drops `map_terrain`) — fine, forward-only like 001–003; a fresh DB and an
  existing prod DB both converge. The prod DB has real generated terrains — the migration must
  carry their blobs (it does).
- Full gate before push; own branch off fresh `main` → one PR → watch CI → **ask before merging**
  (schema + API change). Squash + delete branch.

## Follow-ups (later PRs, not this one)

- **PR-B:** editor Terrains panel → new endpoints; remove `POST /terrain` + its web use.
- **PR-C:** play-view picker (Flat default) → `GET /terrains/:tid.webp`; remove `GET
  /terrain.webp` + `MapDetail.terrain`.
