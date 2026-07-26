# HQ / harbor tile outlines + commanders-per-round — design

**Date:** 2026-07-26
**Status:** Approved (design), pending implementation plan

## Summary

Three related pieces of work:

1. **Home base (HQ) outline** — render the HQ marker as a seat-colored stroke of the
   tile's real (fused) outline instead of a fixed hexagon floating at the tile centroid.
2. **Harbor outline** — likewise render the harbor marker as a solid + hugging-dashed
   stroke of the tile's real outline instead of a centered concentric-hex glyph. Piers
   are unchanged.
3. **Commanders-per-round** — make the per-round commander count an editable per-map
   setting, and surface each player's "commanders remaining to place" in the in-game HUD.

The first two are rendering-only fixes in `board-render`. The third spans `engine`,
`shared`, and `web` (editor + HUD).

---

## Problem 1 & 2: markers don't fit multi-hex tiles

Both the HQ and harbor markers are single-native-hex-sized glyphs drawn **centered on the
tile centroid**:

- HQ: `hqBaseArt(seat)` (`packages/board-render/src/assets.ts`) draws a regular hexagon
  outline; placed via `placeNative(hqBaseArt(tile.features.hq), tile.centroid, hexSize)` in
  `packages/board-render/src/assemble.ts` (~line 81-83).
- Harbor: `harborArt()` (`assets.ts`, ~line 401) draws two concentric hexes (solid outer
  `HARBOR_OUTER_D` + dashed inner `HARBOR_INNER_D`, from `board.svg` group `g46`); placed
  via `placeNative(harborArt(), tile.centroid, hexSize)` in `assemble.ts` (~line 85).

On a tile that spans multiple hexes, the glyph floats a single hex-sized shape in the
middle and does not match the tile. The Rivers map's HQ/harbor tiles are single-hex today,
so the bug is only visible on multi-hex tiles (e.g. custom maps).

The real per-tile outline already exists: `fuseTile(hexes, layout)` produces `tile.rings`
(`packages/board-render/src/outline.ts`, `scene.ts`), the same geometry used to draw the
tile border.

### Solution 1 — HQ

- In `assemble.ts`, when `tile.features.hq` is set, emit a `<path>` following the tile's
  `rings` with `fill:none` and a **bold solid stroke in the seat color** (`#e02d2d` red /
  `#000000` black — the existing HQ stroke colors).
- Draw it inside the existing `features` group (`pointer-events:none`, above tile fills) so
  it stays visible even when the HQ tile is captured/recolored at runtime.
- Retire `hqBaseArt`, `HQ_BLACK_D`, `HQ_RED_D`, `HQ_ART_CENTER`, and the `glyph-hq-black` /
  `glyph-hq-red` symbols (nothing else consumes them — the web package renders the
  pre-assembled SVG). Confirm no other references before deleting.
- Applies uniformly to single- and multi-hex HQ tiles.

### Solution 2 — Harbor

- In `assemble.ts`, when `tile.features.harbor` is set, emit **two `<path>`s** following the
  tile outline:
  1. thin **solid** stroke on `tile.rings` (the tile edge), black;
  2. thick **dashed** stroke on a copy of `rings` **offset outward by ~2.5 units**, so the
     dashes hug just outside the solid line with no visible gap. Dash pattern echoes the
     artwork (~`4, 1.6`); stroke width echoes the original inner hex (~8 in native units,
     scaled to `hexSize`).
- Add a small polygon-offset helper in `board-render` (offset each edge along its outward
  normal by `d`, intersect consecutive offset edges for the new vertices). The tile rings
  come from `fuseTile`; interior/convex 120° corners are the norm, and a small `d` keeps
  concave corners well-behaved. Offset direction is "outward" relative to the ring centroid.
- **Piers are unchanged.** They remain derived per sea-facing hex edge (PR #101,
  `scene.ts` second pass + `placePier` in `assemble.ts`) and are drawn as before; the harbor
  outline sits alongside them.
- Retire `harborArt`, `HARBOR_OUTER_D`, `HARBOR_INNER_D`, `HARBOR_ART_CENTER`, and the
  `glyph-harbor` symbol once nothing references them.
- Edge case: if a tile is ever both HQ and harbor, both outlines are drawn on the same
  rings (seat-colored solid + black solid/dashed). Acceptable; no special handling.

### Testing (1 & 2)

- Update `board-render` snapshot tests that assert the old glyph markup (`-u`), after
  eyeballing the diff to confirm the new outline paths are correct.
- Add/extend a unit test that a multi-hex HQ tile and a multi-hex harbor tile produce an
  outline path matching the fused ring (not a centered hexagon) — assert the emitted path
  references the tile's boundary vertices rather than a fixed hex.

---

## Problem 3: commanders-per-round is hardcoded and not surfaced

Today `commandersPerPlayer` is fixed at **5** in `riversRuleset`
(`packages/engine/src/rules.ts`). It is applied at game creation
(`game.ts`: `commanders.total = rules.commandersPerPlayer`) and reset each round on recall.
Maps carry no ruleset fields, and `repository.createGame` never overrides `rules`.

"Remaining to place" is already computed by `available(state, seat)`
(`packages/engine/src/legality.ts`) = `commanders.total - occupied - standby -
counterattacks`, but it is **not** exposed in the client `PlayerGameView` nor shown in the HUD.

### Solution 3a — per-map setting

- **Schema (must stay in sync — server has a drift guard):**
  - `packages/engine/src/maps/hex/source.ts`: add optional `commandersPerRound?: number` to
    `HexMapSource`.
  - `packages/shared/src/schemas.ts`: add matching optional field to `hexMapSourceSchema`
    (with a 1–8 integer bound).
- **Compile + wiring:**
  - Thread `commandersPerRound` through `compileHexMap` so the compiled map carries it.
  - At game creation, override the ruleset:
    `commandersPerPlayer = map.commandersPerRound ?? riversRuleset.commandersPerPlayer`.
    Touch the path from `repository.createGame` → `createInitialState` (`game.ts`) so the
    per-map value reaches `rules`. Maps without the field keep 5 (Rivers unchanged).
- **Editor:**
  - `packages/web/src/editor/doc.ts`: add the field to `EditorDoc`, `emptyDoc`,
    `docFromSource`, `docToSource`.
  - `packages/web/src/editor/reducer.ts`: new `setCommandersPerRound` action + case,
    clamping to the 1–8 integer range.
  - `packages/web/src/components/editor/InspectorPanel.tsx` `SummaryBody` (the map-level
    panel shown when nothing is selected): a labeled number input (min 1, max 8, step 1)
    wired to the action. Default display 5 when unset.

### Solution 3b — HUD indicator (pips)

- **Expose in the view:** in `packages/engine/src/view.ts` `playerView`, add
  `commandersRemaining: Record<SeatId, number>` (from `available(state, seat)` for each
  seat) and the per-round total (for pip count — `players[seat].commanders.total`, which
  equals the effective commanders-per-round) to `PlayerGameView`. `available` is already
  imported in `view.ts`.
- **Render:** in `App.tsx` scoreboard (the `score-red` / `score-black` seat blocks), add a
  pip row per seat: `total` pips, filled = `commandersRemaining`, dim = the rest
  (placed/standby/counterattack), plus a small "N left" count. Use the existing dice/pip
  visual language; keep it compact and mobile-friendly (up to 8 pips).

### Testing (3)

- Engine unit test: a compiled map with `commandersPerRound: N` yields
  `players[seat].commanders.total === N` in the initial state; absent → 5.
- Engine unit test: `playerView` exposes `commandersRemaining` matching `available()` and
  the per-round total, across a deploy/standby scenario.
- Editor reducer test: `setCommandersPerRound` clamps to 1–8 and round-trips through
  `docFromSource`/`docToSource`.

---

## Delivery

- One focused branch → PR (per usual workflow), ask before merge, squash-merge.
- Run the full local gate; watch CI to green.
- Rebuild shared/engine/board-render before running filtered tests (dist-consumption trap).
- Snapshot updates reviewed by eye before `-u`.

## Out of scope

- No per-player asymmetric commander counts (single number applies to both seats).
- No change to pier derivation or placement.
- No change to `maxRounds` or other ruleset fields (only `commandersPerPlayer` is made
  per-map).
