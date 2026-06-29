# Hex Map Data Model + Geometry + Adjacency — Design

- **Date:** 2026-06-29
- **Status:** Approved (design); pending implementation plan
- **Scope:** Sub-project **1 of 6** of the **Custom Map Editor** initiative. Pure data, geometry math, and a compiler. **No rendering, no editor UI, no server work.** Those are later sub-projects.

## 0. Where this fits (the larger initiative)

The user wants a web-based **map editor/creator**: lay out a hex grid, group hexes into game tiles, attribute features (player base, harbor, land/sea, victory points), and play the result as a fully functional game — reusing the visual building blocks of `board.svg` but composing them into new constellations.

Decisions already made for the initiative as a whole:

- **Fully playable** is the target: a custom map must compile to the engine's runtime `MapDefinition` and be playable end-to-end, including online.
- **Feature-driven actions** (no engine rules changes): the editor only sets feature flags; action legality stays derived from `kind` + features + ruleset exactly as today.
- **Adjacency auto-derived** from hex-edge sharing; ports authored explicitly (ports are not movement edges).
- **Server map library** is the eventual home for custom maps (sqlite + a maps API + a dynamic registry the engine resolves from). Not built in this sub-project.
- **Unify on one procedural hex renderer**: Rivers itself will be re-expressed as a hex map and the bespoke `board.svg` injection retired. Terrain is AI-generated (fal.ai) from a land/sea mask, so every custom map can get its own terrain. Not built in this sub-project.

The 6 sub-projects and order: **(1) hex data model + geometry + adjacency** ← *this spec* → (2) SVG asset library + procedural renderer → (3) migrate Rivers onto the hex renderer → (4) server map library → (5) editor UI → (6) terrain for custom maps.

The rationale for doing #1 first: it is pure and fully unit-testable, it has no UI or I/O, and everything downstream depends on its types and its compiler.

## 1. Overview & Goals

Introduce a **hex authoring format** plus a **compiler** that derives the engine's existing runtime `MapDefinition` from it. The engine's legality / supply / scoring / action-space modules consume `MapDefinition` unchanged. Only **map construction** changes; runtime rules code is untouched.

Concretely, after this sub-project you can:

1. Author a hex map (`HexMapSource`) in TypeScript: a flat-top hex grid, tiles as connected hex sets, per-tile feature flags, ports, starting deployment, and bonus slots.
2. Validate it (fail-fast on connectivity / overlap / kind / port / id errors).
3. Compile it with `compileHexMap(source)` into a runtime `MapDefinition` (with **auto-derived adjacency**) plus a separate `MapLayout` (per-tile hex coordinates + geometry) that the future renderer/editor consume.
4. Start a game from a map whose **starting deployment is map-driven** rather than hardcoded.

### Non-goals (explicitly out of scope for #1)

- Any SVG generation, glyph extraction, or rendering.
- Any editor UI.
- Any server storage, maps API, or dynamic registry.
- Migrating Rivers to the new format (sub-project 3). #1 ships with a **small fixture map** used only by tests.
- More than two seats. The engine is 2-seat (`red`/`black`); the format assumes the same and validates against `SeatId`.
- Per-tile action overrides (decided: feature-driven only).

## 2. Hex geometry — orientation & coordinates

Rivers' tiles are **flat-top** hexagons (derived from `path9` in `board.svg`: horizontal top/bottom edges, pointed left/right; flat-edge length ≈ size ≈ 114 user units, point-to-point width ≈ 2·size, height ≈ √3·size). The new system standardizes on flat-top so Rivers migrates naturally in #3.

**Coordinate system:** axial `(q, r)` with cube conversion for math. Flat-top axial neighbor directions (the six edge-sharing neighbors):

```
(+1, 0)  (+1, -1)  (0, -1)  (-1, 0)  (-1, +1)  (0, +1)
```

`coords.ts` (pure, no dependencies) provides:

- `Axial = { q: number; r: number }` and a stable string key `axialKey(a)` = `"q,r"`.
- `axialToCube` / `cubeToAxial`.
- `NEIGHBOR_DIRS` (the six above) and `neighbors(a): Axial[]`.
- `areNeighbors(a, b): boolean` (edge adjacency).
- `axialToPixel(a, layout): {x, y}` and the inverse `pixelToAxial` for a `HexLayout { size, originX, originY }` (flat-top formulas).
- `hexDistance(a, b): number`.

Flat-top pixel layout (reference formulas, `size` = centre-to-corner):

```
x = originX + size * (3/2) * q
y = originY + size * √3 * (r + q/2)
```

All geometry is unit-tested independently of the rest of the system.

## 3. The authoring format (`source.ts`)

Exported from the engine package so web (editor) and server (storage/validation) can import the **same** types later.

```ts
type SeatId = "red" | "black"; // re-used from engine types

interface HexMapSource {
  id: string;
  name: string;
  /** Flat-top layout the renderer/editor will use; engine ignores it. */
  layout: HexLayout;              // { size, originX, originY }
  tiles: HexTileSource[];
  /** Map-driven starting unit placement, keyed by tile id. */
  startingDeployment: Record<string, StartingUnits>;
  /** Tile ids that receive a random bonus at setup. */
  bonusSlots: string[];
}

interface HexTileSource {
  id: string;                    // unique within the map
  kind: "land" | "sea";          // every member hex inherits this
  hexes: Axial[];                // connected, non-empty, disjoint from other tiles
  features: {
    hq?: SeatId;                 // HQ owner if a headquarters
    valueStars?: 0 | 1 | 2;      // victory stars
    harbor?: boolean;            // can build/launch ships (port endpoint)
    shellable?: boolean;         // coastal land targetable by Shell
  };
  /** Sea tile ids reachable from this harbor via a pier (not movement edges). */
  ports?: string[];
}

interface StartingUnits { seat: SeatId; troop?: number; ship?: number }
```

Design notes:

- **Tile kind is authored per tile, not per hex.** A tile is wholly land or wholly sea. Member hexes inherit it. This keeps the substrate simple and matches the engine's per-area `kind`.
- **`ports` are directional from the harbor.** They are validated (endpoint must be a sea tile; the owning tile should be a `harbor`) but, like today, they are *not* added to the adjacency graph.
- The format carries **layout coords** (`hexes` are real grid positions) so #2 can render without a second data source.

## 4. The compiler (`compile.ts`)

`compileHexMap(source: HexMapSource): CompiledMap` where:

```ts
interface CompiledMap {
  definition: MapDefinition;   // the existing runtime shape the engine consumes
  layout: MapLayout;           // per-tile hex coords + derived geometry, for renderer/editor
}

interface MapLayout {
  size: number;
  origin: { x: number; y: number };
  tiles: Record<string, { hexes: Axial[] }>;
  /** Overall pixel bounds, for viewBox sizing in #2. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}
```

Compilation steps:

1. **Validate** (see §5) — throws on any structural error before producing output.
2. **Build the hex→tile index** (`axialKey → tileId`) for adjacency derivation.
3. **Derive adjacency.** For each tile, scan every member hex's six neighbors; any neighbor hex owned by a *different* tile contributes that tile to the adjacency set. Result is de-duplicated and **symmetric by construction** (if A's hex borders B's hex, the reverse scan finds it too). This naturally yields land↔land, sea↔sea, and mixed land↔sea edges — the mixed edges Shell/Bombard/supply require.
4. **Emit `MapDefinition`.** For each tile, produce a `MapArea` with `id`, `kind`, `hq`, `valueStars`, `harbor`, `shellable`, `adjacent` (sorted for determinism), and `ports`. Set `map.bonusSlots` and the new `map.startingDeployment`.
5. **Emit `MapLayout`** from the source hexes + layout, including pixel `bounds`.

The compiler is pure and deterministic: same source → identical output (adjacency lists sorted, object keys insertion-ordered by tile order).

## 5. Validation (`validate.ts`)

Fail-fast checks, each with a clear error message (mirrors the invariants `riversMap.test.ts` asserts today):

- **Unique tile ids**; non-empty `tiles`.
- **Hex ownership is disjoint:** no axial coordinate appears in two tiles.
- **Each tile is connected:** its hexes form a single edge-connected component.
- **Each tile is non-empty.**
- **Valid seats:** any `hq` / `startingDeployment.seat` is a known `SeatId`.
- **Port endpoints valid:** every id in `ports` is an existing **sea** tile; the owning tile is marked `harbor` (warn-or-throw — throw, for fail-fast authoring).
- **Reference integrity:** every `bonusSlots` id and every `startingDeployment` key is an existing tile id.
- **Bonus slot count** is checked at game setup against the ruleset (existing `game.ts` check), not here.
- **HQ sanity:** at most one HQ per seat (the engine assumes a single HQ land area per seat for supply/scoring).

Validation is also exported standalone (`validateHexMap(source): void`) so the future editor can surface errors before saving.

## 6. Map-driven starting deployment (the one runtime change)

Today `game.ts` hardcodes `RIVERS_STARTING_UNITS` keyed by Rivers tile ids. To make custom maps playable, deployment must come from the map.

- Add **optional** `startingDeployment?: Record<string, StartingUnits>` to `MapDefinition`.
- `createInitialState` (the engine's game-setup function) prefers `map.startingDeployment` when present; otherwise falls back to the existing `RIVERS_STARTING_UNITS` (so Rivers is unaffected until #3).
- The fallback is removed in sub-project 3 when Rivers is re-authored as a `HexMapSource` carrying its own deployment.

This is the only change to runtime rules code in #1, and it is backward-compatible (Rivers behavior is byte-for-byte unchanged because it has no `startingDeployment` yet).

## 7. File layout

```
packages/engine/src/maps/hex/
  coords.ts        # axial/cube math, neighbors, pixel layout, distance
  source.ts        # HexMapSource + related authoring types
  compile.ts       # compileHexMap -> { definition, layout }
  validate.ts      # validateHexMap (fail-fast structural checks)
  fixtures.ts      # a small sample HexMapSource used by tests (NOT Rivers)
  coords.test.ts
  compile.test.ts
  validate.test.ts
```

Exports are surfaced through `packages/engine/src/index.ts` (the authoring types, `compileHexMap`, `validateHexMap`) so web/server import them via `@sengoku-jidai/engine`. `MapDefinition` / `MapArea` keep their current home (`maps/riversMap.ts`) for now; the `startingDeployment` field is added there.

## 8. Testing strategy

- **`coords.test.ts`** — neighbor directions, `areNeighbors`, axial↔cube round-trips, `axialToPixel`/`pixelToAxial` round-trips, `hexDistance`.
- **`validate.test.ts`** — one passing fixture plus a failing case per rule (disconnected tile, overlapping hexes, bad port endpoint, unknown bonus/deployment id, unknown seat, duplicate tile id, two HQs for one seat).
- **`compile.test.ts`** — adjacency derivation correctness on a hand-checked fixture (including at least one mixed land↔sea edge and one pair of tiles that touch only at a corner, which must **not** be adjacent), adjacency symmetry, determinism (stable sorted output), and that the compiled `definition` satisfies the same invariants `riversMap.test.ts` enforces (symmetry, no dangling refs).
- A **fixture map** (`fixtures.ts`): a deliberately small layout (e.g. ~4–6 tiles, mixing multi-hex tiles, one harbor + port, one HQ per seat, a couple of stars) — enough to exercise every compiler/validator path without the bulk of a full board.

## 9. Risks & mitigations

- **Corner-adjacency false positives.** Hexes that meet only at a corner must not count as adjacent. Mitigation: adjacency is defined strictly via the six **edge** neighbors (`NEIGHBOR_DIRS`); a corner-touch test case guards this.
- **Determinism.** Renderer snapshots and engine replays need stable output. Mitigation: sort adjacency lists; preserve tile insertion order for object keys; no `Math.random`/`Date`.
- **Drift from the runtime shape.** The compiler emits the *existing* `MapDefinition`, and a compile test re-runs the same invariants `riversMap.test.ts` checks — so a future change to `MapDefinition` that the compiler doesn't satisfy fails loudly.
- **HQ-count assumption.** Supply/scoring assume one HQ land area per seat; validation enforces it so a malformed custom map can't reach the engine.

## 10. Done criteria

- `coords.ts`, `source.ts`, `compile.ts`, `validate.ts`, `fixtures.ts` implemented and exported.
- `MapDefinition` gains optional `startingDeployment`; `createInitialState` consumes it with the Rivers fallback intact.
- All new tests pass; existing engine tests (incl. `riversMap.test.ts`) remain green.
- No rendering / editor / server code introduced.
