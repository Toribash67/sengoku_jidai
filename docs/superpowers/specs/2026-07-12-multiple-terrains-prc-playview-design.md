# PR-C — In-game play-view terrain picker (design)

_Date: 2026-07-12 · Initiative: multiple terrains per map · The **last** PR (D, 1, 2, A, B merged)._

## Goal

Let each player, **while playing**, choose which terrain the board shows: the clean **Flat**
shaded look (the new default), any of the map's **ready** generated terrains, or — for a built-in
that ships a committed background — its **Original**. The choice is a **per-viewer, per-map**
preference persisted in `localStorage`. No engine, session, realtime, or multiplayer changes:
terrain is already purely client-side (`terrainUrl → MapBoard`).

This PR also retires the now-dead legacy terrain surface (`MapDetail.terrain`,
`GET /terrain.webp`, `POST /terrain`) that PR-A kept alive only for the pre-picker play view.

## Behaviour

- The board **defaults to Flat** for every map (a deliberate change: today built-ins and
  ready custom maps auto-show their terrain). The player opts into a terrain.
- A compact picker offers, in order:
  1. **Flat** (key `flat`, no background) — always present, the default.
  2. **Original** (key `original`) — only for a built-in with a committed background asset
     (today only `rivers`). Custom maps never have an "Original".
  3. One entry per **ready** terrain in `MapDetail.terrains` (oldest first), labelled by the
     terrain's `name` ("Terrain 1", …), keyed by its terrain id. Pending/failed terrains are
     omitted.
- If there is nothing to choose between (only Flat — a built-in with no committed asset, or a
  custom map with no ready terrain), the picker **renders nothing**.
- Selecting an option repaints the board immediately and writes the choice to `localStorage`.
- On load, the persisted key is honoured **only if it still maps to a live option**; otherwise
  it silently falls back to Flat (covers a terrain deleted/renamed/regenerated since, or a
  key from a different app version).

## Placement (flagged decision — Martin was AFK on the UX fork)

A **slim strip above the board** in the board column: a small labelled `<select>`
(`Terrain: [ Flat ▾ ]`), left-aligned, above `MapBoard`. Rationale: it sits next to the thing
it changes, costs only a few px of height, and never occludes tiles (unlike a board-corner
overlay) or bloats the already-tall side panel. Easy to move to a board corner or the side
panel later if preferred — the picker is a self-contained component.

## Architecture

Terrain selection stays entirely in the web package, split into pure helpers (unit-tested),
one hook (fetch + state + persistence), and one presentational component.

### 1. Pure option/selection helpers — `components/board/terrainImages.ts`

```ts
export interface TerrainOption {
  key: string;          // "flat" | "original" | <terrainId>
  label: string;        // "Flat" | "Original" | terrain.name
  url: string | null;   // background URL; null for Flat
}

/** Build the play-view option list: Flat first, then Original (built-in committed asset only),
 *  then each READY terrain (oldest first), cache-busted by updatedAt. */
export function buildTerrainOptions(args: {
  mapId: string;
  committed: string | null;      // terrainImage(mapId) — the built-in "Original", else null
  terrains: TerrainInfo[];       // MapDetail.terrains ([] on fetch failure / built-ins)
}): TerrainOption[];

/** The option a persisted key selects, or the Flat option if the key is absent/stale. */
export function resolveTerrainOption(options: TerrainOption[], key: string | null): TerrainOption;
```

- `FLAT_TERRAIN_KEY = "flat"`, `ORIGINAL_TERRAIN_KEY = "original"` exported constants.
- Terrain-id options reuse `terrainByIdApiUrl` + the existing `?v=<updatedAt>` cache-bust. That
  cache-bust is currently inline in `previewTerrainUrl`; factor it into a tiny shared
  `terrainByIdCacheBustedUrl(mapId, terrain)` and have both `previewTerrainUrl` (editor) and
  `buildTerrainOptions` (play) call it — one code path, no duplication.
- `resolveTerrainOption` returns `options[0]` (always Flat) when `key` is null or unmatched.

### 2. Persistence — `state/localGame.ts`

Follow the existing namespaced-key + try/catch pattern (`readSeatStore`/`loadPanelWidth`).

```ts
// key "sengoku-jidai.terrainChoice" → JSON Record<mapId, optionKey>
export function loadTerrainChoice(mapId: string): string | null;
export function saveTerrainChoice(mapId: string, key: string): void;
```

Bad JSON clears the key and returns `{}` (same as `readSeatStore`). Per-map isolation via the
record.

### 3. Hook — `components/board/useTerrainPicker.ts` (replaces `useTerrainUrl.ts`)

```ts
interface TerrainPicker {
  options: TerrainOption[];       // [] length ≤ 1 ⇒ component hides
  selectedKey: string;            // resolved (never a stale key)
  terrainUrl: string | null;      // options → resolveTerrainOption(...).url, fed to MapBoard
  select: (key: string) => void;  // setState + saveTerrainChoice
}

export function useTerrainPicker(mapId: string): TerrainPicker;
```

- `committed = terrainImage(mapId)` (synchronous glob lookup; built-in "Original" or null).
- Fetch `MapDetail` **once per mapId** via `fetchMap` to get `terrains`; any error → `terrains = []`
  (board still offers Flat + Original, degrades gracefully). Built-ins that 404 the maps API land
  here harmlessly. Cancel-on-unmount guard as today.
- `options = buildTerrainOptions({ mapId, committed, terrains })`.
- `selectedKey` seeds from `loadTerrainChoice(mapId)`, always run through `resolveTerrainOption`
  so a stale persisted key resolves to Flat without being re-persisted.
- `terrainUrl = resolveTerrainOption(options, selectedKey).url`.
- `select(key)` sets state and persists.

The old `useTerrainUrl` / `fetchTerrainUrl` / `resolveTerrainUrl` / `terrainApiUrl` path is
deleted (see Retirement).

### 4. Component — `components/board/TerrainPicker.tsx`

Presentational: given `{ options, selectedKey, onSelect }`, render `null` when
`options.length <= 1`, else a labelled `<select>` (`aria-label="Terrain"`). No fetching or
storage in the component. Styled to match existing compact controls; a `.terrain-picker` block
in the board/App CSS.

### 5. Wiring — `App.tsx`

```ts
const { options, selectedKey, terrainUrl, select } = useTerrainPicker(game?.view.mapId ?? "");
```

In the board column, above `<MapBoard>`:

```tsx
<TerrainPicker options={options} selectedKey={selectedKey} onSelect={select} />
<MapBoard … terrainUrl={terrainUrl} />
```

`terrainUrl` still flows into `MapBoard` unchanged — the only board contract is the URL.

## Retirement (legacy terrain surface, now fully dead)

After the play view uses `terrains[]`, nothing consumes the pre-picker legacy surface. Remove:

- **Shared** (`packages/shared/src/api.ts`): delete `MapDetail.terrain: TerrainStatus` and its
  comment. `TerrainStatus` itself stays (used by `TerrainInfo.status`).
- **Web**: delete `useTerrainUrl.ts` (`useTerrainUrl`, `fetchTerrainUrl`) and, in
  `terrainImages.ts`, `terrainApiUrl` + `resolveTerrainUrl` (the legacy single-URL resolvers).
  `terrainImage` / `resolveTerrain` (committed-asset glob) **stay** — they power "Original".
- **Server** (`packages/server/src`): remove `GET /api/maps/:mapId/terrain.webp` and
  `POST /api/maps/:mapId/terrain` (both legacy; web stopped calling POST in PR-B) from
  `api/routes.ts`; stop populating the `terrain` field in the `MapDetail` builder
  (`maps/library.ts`); drop the now-unused primary-status adapters in `terrainStore`
  (`status`/`webp`/`updatedAt` and, if orphaned, `terrainService.regeneratePrimary`) — verify
  each has no other caller before deleting. Keep all `…/terrains` and `…/terrains/:id.webp`
  routes and the surrogate-id store API.

The many-terrains generation pipeline, styles, editor panel, and per-id endpoints are untouched.

## Testing

Web has **no jsdom** → pure-logic unit tests only (matches PR-A/PR-B):

- `buildTerrainOptions`: built-in with committed → `[Flat, Original]`; custom with mixed
  statuses → `[Flat, …ready-only, oldest-first]`; none → `[Flat]`; terrain urls carry
  `?v=<updatedAt>`; Original present only when `committed` non-null.
- `resolveTerrainOption`: matching key → that option; null / stale / deleted key → Flat.
- `loadTerrainChoice`/`saveTerrainChoice`: round-trip, per-map isolation, bad JSON → cleared.
- Server: update/remove tests asserting the deleted routes / `terrain` field; keep the
  `…/terrains` suite green. `pnpm typecheck` catches the shared-field removal across packages.

No e2e changes: a repo grep found **no** e2e spec referencing terrain. CI's Browser Smoke Test
still runs.

## Manual browser check (for Martin, post-merge or on branch)

Web components are unverified in-browser locally (no jsdom). Eyeball:

1. Load a game on a built-in with a committed background (`rivers`): board starts **Flat**;
   picker offers Flat + Original; picking Original paints it; reload keeps the choice.
2. Load a game on a custom map with ≥1 ready terrain: picker lists Flat + each ready terrain by
   name; switching repaints; the choice persists per map and is independent of the built-in's.
3. A map with no committed asset and no ready terrain: **no picker** shown, board Flat.
4. Delete a terrain in the editor, then reload a game that had it selected → falls back to Flat.

## Non-goals

Shared/synced terrain choice, engine/session/realtime changes, terrain generation from the play
view, live terrain updates mid-game (editor-only), a preview thumbnail in the picker.
