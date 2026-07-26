# Derived, per-edge harbor piers

**Date:** 2026-07-26
**Status:** Approved (design)

## Problem

Today a "pier" is the visual of an explicitly-authored *port* — a link stored on a
harbor land tile (`ports: string[]`) pointing at a specific sea tile. Ports are
hand-placed in map source and via the editor's "Add port" UI, may point at a
non-adjacent sea tile, and drive both gameplay (valid launch/build waters) and
rendering (one pier per port, drawn toward the sea tile's centroid).

We want two changes:

1. **Construction:** piers are no longer explicitly placed. They exist
   automatically from a harbor land tile to each *neighbouring* sea tile.
2. **Rendering:** draw a separate pier from each *hex edge* of the harbor tile
   that faces a sea tile, instead of one pier per sea tile. Multiple piers can
   therefore run from a single harbor tile to the same sea area when that area
   spans several hexes adjacent to the harbor.

## Decisions

- **Remove `ports` authoring entirely.** Ports become derived; the runtime
  `MapArea.ports` field stays (now computed), so gameplay code is unchanged.
- **Only neighbouring sea tiles.** Non-adjacent ports are no longer expressible.
  This is intended. For the built-in Rivers map we *derive & accept* whatever the
  new adjacency-based port set is, and report the before/after diff.
- **Editor derived-pier preview is out of scope** for this change (deferred). The
  editor simply loses the manual port UI.

## Design

### 1. Data model — piers derived, `ports` authoring removed

- `packages/engine/src/maps/hex/source.ts` — remove `ports?: string[]` from
  `HexTileSource`. `features.harbor` remains the only harbor-related authored data.
- `packages/shared/src/schemas.ts` — remove `ports` from `hexTileSourceSchema`.
- `packages/engine/src/maps/hex/validate.ts` — delete the ports validation block
  (harbor-required / target-must-be-sea). Nothing left to validate there.
- `packages/engine/src/maps/hex/compile.ts` — stop copying authored ports.
  Instead, for each harbor tile derive `MapArea.ports` = the sorted, unique set of
  **edge-adjacent sea tiles**, reusing the adjacency the compiler already walks in
  `deriveAdjacency`. `MapArea.ports` keeps its shape and meaning, so
  `packages/engine/src/legality.ts` (launch/build waters) needs **no change**.
- `packages/engine/src/maps/riversSource.ts` — delete the hand-authored `ports:`
  arrays from harbor tiles.

### 2. Rendering — one pier per sea-facing hex edge

New rule: for each harbor tile, for each hex it owns, for each of that hex's 6
edges, if the neighbouring hex across that edge belongs to a **sea** tile, emit a
pier seated at that edge's midpoint, pointing outward (along the edge normal, i.e.
toward the neighbouring hex centre). This naturally yields multiple piers to the
same sea tile when the sea area spans multiple adjacent hexes.

Geometry: for a regular hex the shared edge's midpoint is the midpoint between the
two hex centres, and it lies exactly one apothem from each centre. Outward
direction = `neighbourCentre - hexCentre`.

- `packages/board-render/src/scene.ts` — build a global hex→(tileId, kind) map
  (same pattern as the compiler's `deriveAdjacency`), then compute per-edge pier
  segments for harbor tiles. `SceneTile.ports` changes from
  `{ to: string; from: Pixel; toPoint: Pixel }[]` to per-edge segments, e.g.
  `{ midpoint: Pixel; angle: number }[]`.
- `packages/board-render/src/assemble.ts` — `placePier` takes an edge midpoint and
  outward angle, seats the existing `pierArt()` stub there extending outward.
  `pierArt()` and `PIER_ART_LENGTH` are reused unchanged. Piers remain in the
  non-interactive `#features` group.

### 3. Editor

- `packages/web/src/components/editor/InspectorPanel.tsx` — remove the "Ports"
  list, the "Add port" button, and per-port remove buttons. Keep the Harbor
  checkbox.
- `packages/web/src/editor/reducer.ts` — remove `armPort` / `addPort` /
  `removePort` actions, `portArming` state, the click-to-link flow in
  `selectTile`, the `ports` mirror on `EditorDoc` tiles, and the port-clearing in
  `setFeature` / `normalize`.
- `packages/web/src/components/editor/EditorCanvas.tsx` — remove the manual
  `editor-ports` lines. The ⚓ harbor badge stays. Derived-pier preview in the
  editor is deferred.

### 4. Tests

- `packages/board-render/test/scene.test.ts` — rewrite the pier test to assert
  per-edge piers (one per sea-facing edge).
- `packages/engine` compile/validate tests and `packages/engine/src/maps/hex/fixtures.ts`
  — the fixture harbor "D" must be edge-adjacent to sea "C" so derivation yields
  the port; drop authored `ports`.
- Rivers board-render snapshot — piers change → regenerate with `-u`.
- Report the before/after diff of Rivers launch/build waters.

## Out of scope

- Non-adjacent ports (intentionally dropped).
- Any gameplay-rule change beyond the derived port set.
- Editor derived-pier preview.
- `AreaDetails` / `areaLabel` "Has piers" text (still reads `mapArea.ports.length`).
