# Map Editor UI (SP5) — Design

**Date:** 2026-07-03
**Status:** Approved (decisions confirmed by Martin: full-loop scope, hex-per-tile
default with merge, select+inspector, schematic canvas + real preview, explicit
save + localStorage draft, all inside the existing web app)
**Initiative:** Custom map editor, sub-project 5 of 6 (after SP1 hex data model,
SP2 procedural renderer, SP3 Rivers migration, SP4 server map library; before
SP6 terrain)

## Goal

Author, manage, and play custom maps entirely in the browser: a map library
screen, a hex editor that saves through the SP4 maps API, and a map picker on
the create-game screen. No server or engine changes — SP5 is web-only, built on
what SP1–SP4 already export.

## Scope decisions (locked)

1. **Full loop:** editor + `/maps` library screen + create-game map picker +
   save-as-copy for maps locked by games. Custom maps become fully usable
   without curl.
2. **Hex-per-tile default:** each painted hex becomes its own single-hex tile
   (most tiles are single-hex — Rivers is 17 of 22); multi-hex tiles are made
   by selecting tiles and merging. Adjacency stays auto-derived from shared
   edges by `compileHexMap`; the editor never authors adjacency.
3. **Select + inspector:** tile attributes (HQ, stars, harbor, shellable,
   ports, deployment, bonus slot) edited in an inspector panel for the
   selected tile; no per-attribute stamp tools.
4. **Schematic canvas + real preview:** the editing canvas is the editor's own
   simple SVG (visible grid, flat fills, tile-boundary strokes, badges); a
   preview toggle runs the real board-render pipeline.
5. **Explicit save + local draft:** edits live in memory, autosaved (debounced)
   to localStorage; a Save button POSTs/PUTs. The server only ever holds valid,
   complete maps (its validation pipeline stays the gate). 409 `mapInUse`
   offers "Save as copy".
6. **One app:** new client routes in `packages/web`; no separate editor
   package, no new deploy artifact.

## Screens and routes

`state/route.ts` union gains:

```ts
| { kind: "maps" }                            // /maps
| { kind: "editor"; mapId: string | null }    // /maps/new, /maps/:id/edit
```

### Map library (`/maps`)

Lists `GET /api/maps` (name, tile count, built-in badge, updated date).
Per row:

- **Edit** (custom maps) → `/maps/:id/edit`.
- **Edit copy** (built-ins) → editor loaded with the fetched source but
  `id: null`, name "<Name> (copy)" — saving creates a new map. This is the same
  rebind-to-null mechanism as save-as-copy and makes Rivers the natural
  starting template.
- **Delete** (custom only): confirm dialog; 409 → inline "in use by existing
  games" explanation.
- **New game** → `/` with `?map=<id>` preselect.

Plus **New map** → `/maps/new`. The create-game screen links here ("Map
editor") so the library is discoverable.

### Create-game screen (map picker)

`CreateGameScreen` fetches `GET /api/maps` on mount and renders a select
(name + tile count; built-ins first — API order). Default Rivers; `?map=<id>`
overrides. The chosen `mapId` is always sent to `POST /api/games`. If the list
fetch fails the screen still works with Rivers only plus a small warning —
game creation must never be blocked by the maps API.

### API client (`client/api.ts`)

Add `listMaps`, `createMap`, `updateMap`, `deleteMap` — thin wrappers over the
SP4 endpoints, reusing the existing `request`/`ApiError` plumbing and the
shared response types.

## Editor document and state

The working doc is `HexMapSource` with `id: string | null` (null = never
saved). `layout` is fixed: size 114, origin (0,0) — the native scale board.svg
art is authored at, so preview and play render 1:1.

State lives in a **pure reducer** (`editor/reducer.ts`); every action returns a
new doc, and an undo/redo stack keeps full snapshots (docs are tiny; Rivers is
22 tiles / ~40 hexes). Pure reducer = all the tricky semantics below are
unit-testable without DOM.

Actions: `paintHex(kind, axial)`, `eraseHex(axial)`, `selectTile` /
`toggleSelect`, `mergeTiles(ids)`, `unmergeTile(id)`,
`setFeature(tileId, patch)`, `addPort` / `removePort`,
`setDeployment(tileId, units | null)`, `toggleBonusSlot(tileId)`,
`setName`, `undo`, `redo`, plus draft restore/load.

### Painting semantics

Tools: select, paint-land, paint-sea, erase. A painted empty hex becomes a new
single-hex tile with a generated id (`t1`, `t2`, … from a doc-level counter).
Painting over an existing hex re-kinds it: the hex leaves its current tile and
becomes a fresh single-hex tile of the new kind. Erase removes the hex.
Consequences the reducer handles:

- **Split on disconnect:** removing a hex from a multi-hex tile re-derives
  connected components (engine `neighbors`/`axialKey` helpers); the largest
  component keeps the tile's id and features, the rest become fresh plain
  tiles. Ties broken deterministically (first hex in tile order).
- **Reference remapping:** tile ids are referenced by `ports`,
  `startingDeployment` keys, and `bonusSlots`. Every operation that removes or
  renames an id cleans all references (a deleted sea tile disappears from all
  `ports` arrays; a deleted tile's deployment/bonus entries go with it).

### Merge / unmerge

Select mode: click selects, shift-click multi-selects. **Merge** requires same
kind + edge-connected union; the first-selected tile survives with its id and
features. Absorbed tiles' references remap onto the survivor: deployment moves
over only if the survivor has none, bonus-slot membership and inbound ports
dedupe onto the survivor's id. **Unmerge** explodes a multi-hex tile into
single-hex tiles; the hex nearest the old centroid keeps the id and features
(deterministic; ties by tile hex order), the rest are fresh plain tiles.

## Canvas

One SVG element:

- Light hex-grid outlines covering the current viewport (computed from the
  visible rect, not per-cell event targets).
- Painted hexes as flat land/sea fills; **thick strokes only on edges between
  different tiles** so merged tiles read as one region.
- Per-tile badges at centroids: HQ R/B, ★/★★, ⚓, shell marker, troop/ship
  counts, bonus marker. Selected tile highlighted; a selected harbor draws
  lines to its port-linked sea tiles.
- Hit-testing is pure math via engine `pixelToAxial` — click/drag paints
  continuously.
- Wheel zooms about the cursor; drag on empty space in select mode (or
  middle-drag anywhere) pans.

## Inspector

Right panel, for the selected tile:

- HQ owner none/red/black — assigning a seat that already has an HQ elsewhere
  silently clears the other (one-per-seat is a hard rule).
- Value stars 0/1/2, shellable toggle, HQ — land tiles only. Harbor toggle.
- **Ports** (harbor tiles): list of linked sea tiles + "Add port" arming a
  click-the-target mode — clicking a sea tile adds the link; clicking anything
  else cancels.
- **Starting deployment:** seat picker + troop/ship steppers (troops on land,
  ships on sea).
- Bonus-slot checkbox.

Nothing selected → map-level fields: name, and a live tally (tiles, HQs
placed, bonus slots used of the 5 `riversRuleset.bonusSet` supports).

## Validation, save, draft, preview

- **Validation:** after every change run engine `validateHexMap` on the doc
  (fail-fast, cheap); a status strip shows "valid" or the engine's own message.
  Save stays enabled — the server re-runs the authoritative pipeline
  (structural → compile → dry-run setup) and a 400's message lands in the same
  strip. Client validation is UX; server validation is truth.
- **Save:** name required. `id === null` → `POST /api/maps` (placeholder body
  id — the server overwrites it; SP4 requires it non-empty); else `PUT`. On
  409 `mapInUse` a dialog offers **Save as copy** → POST with "… (copy)"
  appended and rebind to the new id via `navigateTo`. After success: toast +
  "Back to library" / "New game on this map".
- **Draft:** debounced autosave to localStorage key `editor-draft:<id|new>`.
  On open, a draft newer than the server's `updatedAt` (or any draft for
  `/maps/new`) prompts restore-or-discard. Cleared on successful save.
- **Preview:** toggle swaps/splits the canvas for
  `assembleBoardSvg(buildScene(compileHexMap(doc)))` in a try/catch — invalid
  mid-edit docs show "preview unavailable: <reason>". No terrain image,
  matching how custom maps render until SP6.

## Error handling

- All API errors surface the envelope message (`ApiError` body →
  `error.message`).
- Library list failure → error state with retry. Editor load 404 → message +
  link to `/maps`. Delete 409 → inline explanation. Save 400 → validation
  strip.
- Create-game picker fetch failure → Rivers-only fallback + warning.

## Testing

- **Reducer unit tests** carry the weight: paint/re-kind/erase, split on
  disconnect, merge/unmerge, reference remapping, undo/redo, id generation.
- **Component tests** (vitest, mocked fetch, as MapBoard's test does): library
  list + delete 409; editor save POST/PUT/409→copy; validation strip showing
  engine messages; picker default + `?map=` preselect + fetch-failure
  fallback.
- `route.test.ts` extended for the new routes.
- **New e2e:** open `/maps/new`, paint a minimal valid map (two HQ land tiles
  + deployment), save, create a game on it, assert the board renders and a
  move works — the SP5 acceptance test, and the first browser-verified
  custom-map loop.
- Existing e2e behavior unchanged: the create-screen default flow still lands
  on Rivers.

## Delivery (3 PRs)

1. **Library + picker:** routes, `/maps` screen, api client additions,
   create-screen picker (+ any e2e text-assertion tweaks).
2. **Editor core:** reducer + canvas + inspector + validation + save/draft
   (a 409 on save surfaces as a plain error here; the copy dialog lands in
   PR 3).
3. **Preview + polish + full-loop e2e:** preview pane, edit-copy for
   built-ins, save-as-copy dialog, the marquee e2e.

## Out of scope

- Terrain for custom maps → SP6.
- Map version history, server-side drafts, authentication → later, if ever.
- Rulesets other than Rivers' (the bonus tally assumes `riversRuleset`).
