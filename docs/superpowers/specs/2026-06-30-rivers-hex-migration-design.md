# Rivers → procedural hex renderer migration (custom map editor SP3)

**Date:** 2026-06-30
**Sub-project:** 3 of 6 in the custom map editor initiative (SP1 hex data model + SP2 board-render done/merged).
**Status:** design approved; ready for implementation plan.

## Goal

Re-express the base **Rivers** map as a `HexMapSource` and render it through the SP2
`board-render` pipeline (`compileHexMap → buildScene → assembleBoardSvg`) instead of injecting
the hand-drawn `assets/maps/rivers/board.svg`. This retires the bespoke single-SVG injection in
favour of the unified procedural renderer that custom maps will also use.

The original `board.svg` is **already an exact flat-top hex grid** with no hand-drawn flair: its
tiles, feature glyphs (HQ/star/harbor), bonus icons, and unit tokens are reusable components.
The migration **reuses those components but computes their placement in code** rather than
reading positions hardcoded in one SVG file.

### Non-goals

- No visual redesign. The procedural board should closely match the old board because it reuses
  the same extracted components.
- No terrain work. Rivers ships no `background.webp` today (`terrainUrl` is null), so terrain
  stays out of scope — it is SP6 (terrain for custom maps).
- No engine rules changes. Adjacency/feature legality stays derived from kind + features +
  ruleset.

## Exact-fidelity contract

`compileHexMap(riversSource).definition` MUST deep-equal today's hand-authored `riversMap`:
identical area ids, kinds, adjacency, ports, value stars, HQs, and bonus slots. The
hand-authored adjacency graph is itself just the edge-adjacency of the real board's tiles, so an
exact match is achievable by reconstructing each tile's hex cluster faithfully.

The existing `packages/engine/test/maps/riversMap.test.ts` stays **green and unchanged** and
becomes the verification oracle. Before replacing `areaList`, capture the current
`riversMap.areas` as a committed JSON snapshot fixture; a new equivalence test asserts the
compiled definition's areas deep-equal that snapshot (full adjacency/ports/feature equality,
stronger than the fact-based assertions alone). Ordering note: `compileHexMap` sorts each area's
`adjacent` and `ports` arrays, so the snapshot must be normalized the same way before comparison. `startingDeployment` is ported
**verbatim** from `RIVERS_STARTING_UNITS` in `game.ts` (10 entries, including tile14/tile18
ships) so setup behaviour and the `game.test.ts` determinism anchor are unchanged.

## Component 1 — geometry extraction (engine)

The 22 tiles in `board.svg` are `<use>` of 5 shape-stamps at `translate(...)` offsets on a
flat-top grid of `size ≈ 113.974` (x-pitch `size*1.5 ≈ 170.96`, y full-pitch
`size*√3 ≈ 197.4`, half-pitch `≈ 98.7`). Decoded stamps:

- `path9-5`, `path9-5-0` → single hex (most tiles; two variants are orientation/parity).
- `path9-2`, `path9-2-2` → small multi-hex clusters (tile1, tile5, tile14, tile18).
- `path9` → large multi-hex cluster (tile22).

**Process:** a throwaway extraction script (lives in scratchpad, NOT committed) decodes each
stamp into a relative axial-hex set, applies each tile's `translate` to absolute axial coords
(origin normalized so `min q`/`min r` start at 0), and emits a static `riversSource: HexMapSource`
literal. **The committed artifact is the generated static source literal** — readable and
diffable, no build-time SVG parsing. The adjacency oracle confirms correctness; any disagreeing
edge means that tile's hex set is adjusted until the derived graph matches exactly.

**Wiring:**

- New `packages/engine/src/maps/riversSource.ts` exporting `riversSource: HexMapSource` (id
  `"rivers"`, name `"Rivers"`, `layout {size, originX, originY}`, 22 tiles with hex sets +
  features + ports, `startingDeployment`, `bonusSlots: ["tile2","tile4","tile20"]`).
- `riversMap.ts`: keep the `MapArea` / `MapDefinition` / `StartingUnits` type homes (hex/source.ts
  imports them). Replace the hand-authored `areaList` with
  `export const riversMap = compileHexMap(riversSource).definition`.
- `game.ts` already resolves `map.startingDeployment ?? RIVERS_STARTING_UNITS`; the fallback
  becomes dead for Rivers. Leave it in place as a generic default (minimal diff); note the future
  cleanup.

Tile ids stay `tile`-prefixed (`tile1`..`tile22`) — web `slotIdForSpace` requires
`rest.startsWith("tile")`.

## Component 2 — bonus glyphs (board-render)

`board.svg` defines `sunbonus-tile2`, `moonbonus-tile4`, `starbonus-tile20`; SP2 did not extract
them, and `board-render` does not render bonus markers. To match the old board:

- Extract the 3 bonus glyphs **verbatim** into `packages/board-render/src/assets.ts` as new
  `GlyphId`s (`glyph-bonus-sun`, `glyph-bonus-moon`, `glyph-bonus-star`) — same `<symbol>`
  pattern as the existing glyphs.
- Render a bonus marker on each `definition.bonusSlots` tile in `scene.ts` (new glyph anchor,
  offset to avoid colliding with the star/harbor anchors) and `assemble.ts` (`#features`).
- **Icon choice is cosmetic** (the real bonus is drawn randomly at setup). Map by bonus-slot
  **order**: slot 0 → sun, 1 → moon, 2 → star, cycling for >3 slots. Rivers' slots are
  `[tile2, tile4, tile20]`, so this reproduces the original board exactly with **no new
  rules-model field**.
- Update the committed board-render snapshot test to include bonus markers.

## Component 3 — web render swap

`packages/web/src/components/board/MapBoard.tsx`:

- Replace `import board.svg?raw` with building the SVG at module load:
  `compileHexMap(getMapSource("rivers"))` → `buildScene` → `assembleBoardSvg` → inject the
  string. (Web imports `board-render` and the engine map source/registry.)
- `prepareSvg` rewrite:
  - Read `data-authored-fill` directly off `.tile` **paths** (procedural tiles are `<path>`, not
    `<use>` of shared defs); remove `captureAuthoredFills`' `use[id^=tile]` logic and the
    `TILE_GEOMETRY_DEFS` neutralization.
  - Drop the runtime `STRIPE_PATTERNS` injection (patterns now live in board-render `<defs>`).
  - Drop `EXAMPLE_UNIT_IDS` hiding (procedural output has no example units).
- `ARMY_DEF`/`SHIP_DEF` point at semantic ids `unit-army-red/black`, `unit-ship-red/black`;
  HQ glyphs via `glyph-hq-red/black`.
- Tiles carry no renderer stroke; `decorate` continues to apply the live black stroke per tile.
- Verify unit-stack centring: `renderUnitStack` measures `getBBox()` on a `<use>` of a
  `<symbol>`, which may report the 40×40 symbol viewport rather than true ink bounds. Fix with an
  explicit bbox / `vector-effect` if centring is visibly off.
- e2e specs (`tests/e2e/*.spec.ts`) select by `[data-source]` / `[data-legal-target]` /
  `[data-seat]`, not by tile id or geometry, so they should stay green; confirm during
  verification.

## Component 4 — board.svg retirement

After the above, every component is migrated into code. Per the constraint not to delete
`board.svg` while components are still sourced from it:

- Remove the live `?raw` import from the web.
- **Keep** `assets/maps/rivers/board.svg` in the repo as extraction provenance.
- Check for any other importer of `board.svg`. If none, its Dockerfile `COPY` is dead; leave it
  this PR (harmless) and flag deletion as a follow-up to avoid a build surprise.

## Delivery

**One PR** (user accepts a temporarily non-deployable intermediate state). Full local gate before
push (`pnpm typecheck`, `test`, `build`, `lint`, `prettier --check` on changed paths), then watch
CI to green. Ask before merge (engine/topology change); squash + delete branch.

## Risks & mitigations

- **Adjacency mismatch after extraction** → the existing `riversMap.test.ts` + a deep-equality
  equivalence test catch any divergence; adjust hex sets until exact.
- **Determinism anchor shift** → `startingDeployment` ported verbatim; deployment is not an RNG
  input, so `game.test.ts` stays stable.
- **Unit-stack mis-centring with `<symbol>`** → flagged from SP2; verify and correct bbox math.
- **HQ-black vs harbor glyph near-identical at small scale** (SP2 carry-forward) → note during
  visual verification; differentiate only if it reads ambiguously in full-Rivers context.

## Out of scope / follow-ups

- Deleting `board.svg` and its Dockerfile `COPY` (separate cleanup once confident).
- Removing the dead `RIVERS_STARTING_UNITS` fallback from `game.ts`.
- Terrain for Rivers / custom maps (SP6).
- Server map library (SP4) and editor UI (SP5).
