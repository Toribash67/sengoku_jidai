# Server Map Library (SP4) — Design

**Date:** 2026-07-03
**Status:** Approved (decisions confirmed by Martin: end-to-end scope, immutable-once-played, unauthenticated endpoints)
**Initiative:** Custom map editor, sub-project 4 of 6 (after SP1 hex data model, SP2 procedural renderer, SP3 Rivers migration; before SP5 editor UI, SP6 terrain)

## Goal

Custom maps become first-class server data: uploaded via an HTTP API, stored in sqlite,
registered into the engine's map registry, and fully playable online in the browser —
before the SP5 editor UI exists. A map uploaded with `curl` can host a complete game.

## Scope decisions (locked)

1. **End-to-end playable**, delivered as two PRs:
   - **PR 1 (server):** sqlite storage, maps API, dynamic registry, `POST /api/games` accepts `mapId`.
   - **PR 2 (web):** `MapBoard` renders the game's map fetched by id instead of hardcoding Rivers.
2. **Immutable once played:** editing or deleting a map that any game references returns
   409 `mapInUse`. Iteration = upload a copy (the SP5 editor will offer "save as copy").
   Full version history (maps pinned at `id@vN`) is a possible later upgrade layered on top;
   nothing in this design blocks it.
3. **Unauthenticated map endpoints**, matching the trust level of `POST /api/games`
   (self-hosted deployment). Fastify's default 1 MiB body limit is ample for any
   realistic `HexMapSource` and stays as the size guard.

## What is stored

The **authoring format** (`HexMapSource` from `packages/engine/src/maps/hex/source.ts`),
not the compiled `MapDefinition`. The source is canonical: it carries the hex layout the
renderer and future editor need, and the compiled form is a pure function of it
(`compileHexMap`). Compilation happens at load/serve time.

### Migration `002_maps.sql`

```sql
CREATE TABLE IF NOT EXISTS maps (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

- `id` is server-assigned (`randomUUID()`); the server rewrites `source.id` to match
  before storing, so `state.mapId`, `MapDefinition.id`, and the row id always agree.
- `name` duplicates `source.name` for SQL-level convenience; listing parses
  `source_json` anyway (for `tileCount`), which is fine at map-library scale.
- No FK from `games.map_id` to `maps.id` — Rivers (and future built-ins) live in code,
  not in this table. "In use" checks are `SELECT 1 FROM games WHERE map_id = ?`.

## Components

### `MapLibrary` (`packages/server/src/maps/library.ts`)

Owns the maps table and the engine-registry lifecycle. Constructed in `buildApp`
right after `runMigrations`, before any route is registered.

- **`loadAll()`** (boot): reads every row, `compileHexMap(source)`, `registerMap(definition)`.
  A row that fails to parse/compile (e.g. engine schema drift) is **logged loudly and
  skipped** — one bad map must not take down the server or the Rivers games on it.
  Games referencing a skipped map will 500 on access until the map is fixed; acceptable
  for an edge case that upload validation makes rare.
- **`create(source)`**: validate (see pipeline below) → assign id → insert → `registerMap`.
- **`update(id, source)`**: 403 for built-ins, 404 if unknown, 409 `mapInUse` if any game
  references it, else validate → replace row (keeping the id) → `registerMap` (replaces).
- **`delete(id)`**: 404 if unknown, 409 `mapInUse` if referenced, else delete the row.
  The in-memory registry entry is left behind until restart — harmless, because
  create-game existence checks go through the library (DB + built-ins), never the
  raw registry, and UUID ids cannot collide with a future upload.
- **`get(id)` / `list()`**: merge built-ins with DB rows. Built-ins (Rivers via
  `riversSource`) are flagged `builtin: true`, cannot be updated or deleted, and are
  served through the same GET endpoints so the web renders every map uniformly.

### Upload validation pipeline (create and update)

1. **zod shape** — `hexMapSourceSchema` (see Shared below); malformed JSON → 400.
2. **`validateHexMap(source)`** — engine structural rules (connectivity, disjoint hexes,
   HQ/port/bonus-slot referential integrity); throws descriptive errors → 400 with the
   engine's message.
3. **`compileHexMap(source)`** — must succeed.
4. **Dry-run `createInitialState`** — register the compiled definition under a
   **fixed throwaway id** (`map-library-dry-run`, compiled from a copy of the source
   with that id) and attempt a game setup with a fixed seed. This catches playability
   failures the structural validator deliberately doesn't enforce — notably
   `bonusSlots.length > rules.bonusSet.length` and any future setup-time invariant —
   as 400s at upload instead of 500s at game creation. The real id is registered only
   after the whole pipeline passes; this matters on **update**, where registering the
   new definition before the dry run would corrupt live games under the existing id
   if validation then failed. Because every validation reuses the same fixed id,
   `registerMap` simply replaces the previous dry-run entry — the registry holds at
   most one dry-run entry at a time, and it's unreachable from the outside the same
   way the leftover entries from `delete()` are (create-game existence checks go
   through the library, never the raw registry).

### API routes (`packages/server/src/api/routes.ts`)

| Route | Behavior |
| --- | --- |
| `GET /api/maps` | `{ maps: [{ id, name, tileCount, builtin, updatedAt }] }` (built-ins first, then by `updated_at` desc) |
| `GET /api/maps/:id` | `{ id, name, builtin, updatedAt, source: HexMapSource }`; 404 `mapNotFound` |
| `POST /api/maps` | body = `HexMapSource` (client-sent `id` ignored/overwritten); 201 with the stored map; 400 `invalidMap` with the validation message |
| `PUT /api/maps/:id` | replace source; 404 / 400 as above; 409 `mapInUse` if any game references it; 403 `builtinMap` for built-ins |
| `DELETE /api/maps/:id` | 204; 404 / 409 / 403 as above |
| `POST /api/games` | gains optional `mapId`; 404 `mapNotFound` if not in the library; passed through to `createInitialState({ mapId })` |

Error envelope matches the existing `sendError` shape (`{ error: { code, message, requestId } }`).

### Shared (`packages/shared/src/schemas.ts`)

- `hexMapSourceSchema`: zod mirror of `HexMapSource` — `id`, `name`, `layout {size, originX, originY}`,
  `tiles[] {id, kind: "land"|"sea", hexes[] {q, r}, features {hq?, valueStars?, harbor?, shellable?}, ports?}`,
  `startingDeployment: Record<tileId, {seat, troop?, ship?}>`, `bonusSlots[]`.
  Per the cross-package convention, this mirrors the engine type; a compile-time
  `satisfies`-style assertion in the server (assigning `z.infer<typeof hexMapSourceSchema>`
  to `HexMapSource`) keeps them from drifting.
- `createGameRequestSchema` gains `mapId: z.string().min(1).optional()`.
- Map route request/param schemas (`mapParamsSchema`, etc.).

### Engine

**No changes.** `registerMap`, `getMap`, `createInitialState({mapId})`, `compileHexMap`,
`validateHexMap`, and `riversSource` are all already exported from the engine root.

### Web (PR 2)

- `MapBoard` resolves its SVG from the game's `view.mapId` (already present in
  `PlayerView`): Rivers keeps the current bundled fast path (module-level constant);
  any other id fetches `GET /api/maps/:id` once, runs
  `assembleBoardSvg(buildScene(compileHexMap(source)))` client-side, and caches the
  result per map id (module-level `Map`). Loading state = the existing board container
  empty; fetch failure renders a visible error message in the board area.
- **`slotIdForSpace` guard relaxed:** drop the `rest.startsWith("tile")` check in
  `packages/web/src/components/board/slotMapping.ts`. The `SLOT_PREFIX` lookup already
  restricts mapping to the four on-map actions, whose space ids are always
  `<action>-<tileId>`; requiring the literal prefix `tile` would break order-slot
  occupancy dots on custom maps with arbitrary tile ids. (Engine emits ids like
  `advance-<tileId>` with `<tileId>` possibly containing dashes; the existing
  first-dash split already handles that.)
- Terrain: `terrainImages` stays keyed by map id; custom maps have no entry and render
  with plain authored fills (no background) until SP6 generates terrain per map.
- The lobby/create-game UI is **not** part of SP4 — no map picker yet (that arrives
  with SP5). PR 2 is only about rendering whatever map the game already has.

## Data flow (custom map, end to end)

1. `POST /api/maps` with a `HexMapSource` → validated → stored → registered → returns `{ id }`.
2. `POST /api/games { mapId }` → library existence check → `createInitialState({ mapId })`
   (engine `getMap` hits the registered definition) → game rows + snapshot as today.
3. Browser opens the seat link → `GET /api/games/:gameId` → `view.mapId` →
   `GET /api/maps/:id` → client compiles + assembles the board SVG → play proceeds
   through the existing command/event flow, which needs nothing map-specific.
4. Server restart → `loadAll()` re-registers every stored map before routes come up,
   so snapshot rehydration (`deserializeState` + `getMap(state.mapId)` in views and
   command resolution) keeps working.

## Error handling summary

- Upload/update: 400 `invalidMap` (with the engine's own validation message), 409
  `mapInUse`, 403 `builtinMap`, 404 `mapNotFound`.
- Create game: 404 `mapNotFound` before touching the games table.
- Boot: bad stored map → error log + skip (server stays up).
- Web fetch failure: visible error in the board area, no crash.

## Testing

**PR 1 (server):**
- `MapLibrary` unit tests (in-memory sqlite, as existing repository tests do):
  boot registration; create/get/list round-trip including built-in merge; each
  validation-pipeline rejection (zod, structural, dry-run playability e.g. too many
  bonus slots); update/delete 409 once a game references the map; builtin 403;
  corrupt-row skip on `loadAll`.
- Route tests: the new endpoints' status codes + error envelopes; `POST /api/games`
  with valid/unknown `mapId`.
- Integration: upload a small fixture map (reuse/adapt the SP1 hex fixtures), create a
  game on it, submit a command, fetch views/events — proving the full loop.
- Determinism anchor (`game.test.ts`) untouched — Rivers path is unchanged.

**PR 2 (web):**
- Component test: MapBoard fetches and renders a non-Rivers map (mock fetch), caches
  per id, shows the error state on fetch failure.
- `slotIdForSpace` unit test updated for arbitrary tile ids.
- Existing e2e stays green (Rivers keeps the bundled path — no behavior change for
  the default game).

## Out of scope (later sub-projects)

- Editor UI, lobby map picker, "save as copy" flow → SP5.
- Terrain generation for custom maps → SP6.
- Map version history → only if the 409-forces-copy flow proves annoying in practice.
