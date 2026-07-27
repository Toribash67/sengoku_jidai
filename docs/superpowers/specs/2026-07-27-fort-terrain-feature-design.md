# Fort terrain feature — design

**Date:** 2026-07-27

## Summary

Add a **fort**: a land-tile terrain feature that grants the defender one extra
die when defending that tile against a land Advance, stacking with the Ambush
card. It renders as a **white border** on the tile, layered concentrically with
the existing player-base (HQ) and harbor borders. Forts are authored via a new
editor toggle; the shipped Rivers map gets no forts by default.

## Scope decisions (confirmed)

- Forts exist on **land tiles only**; the editor rejects them on sea tiles.
- The extra die applies to **land Advance defence only** (`pendingCombat.kind ===
  "advance"`). `sail` (sea defence), `bombard`, and `shell` are untouched — in
  bombard/shell the defender never rolls, so a fort cannot help there.
- The fort die is **automatic terrain** — no card, no player choice, no
  validation gate.
- It **stacks with Ambush**: normal defence is 1 die → fort makes it 2 → fort +
  Ambush makes it 4 (fort +1, ambush +2).
- No forts are placed on the shipped Rivers map; the author adds them in the
  editor.

## 1. Data model + authoring

- Add `fort: boolean` to `MapArea` (`packages/engine/src/maps/riversMap.ts`),
  alongside `harbor`.
- Add `fort` to the map source schema and any map validation so it round-trips
  through save/load and import/export.
- Add `fort` to the editor's feature patch (`packages/web/src/editor/reducer.ts`,
  mirroring the `harbor` handling around lines 24 and 248) — set the flag when
  true, delete it when false.
- Add a **Fort** toggle to `InspectorPanel.tsx`, mirroring the Harbor toggle,
  **enabled only for land tiles**.
- Surface "Fort" in the tile hover / `AreaDetails.tsx`, the same way Harbor is
  surfaced.

## 2. Combat rule

In `rollPendingCombat` (`packages/engine/src/actions.ts:427`), extend the
dice-count computation:

```ts
const map = getMap(state.mapId);
const fort = pc.kind === "advance" && map.areas[pc.area]?.fort === true;
const count = (isDefence ? 1 : pc.dice!) + (ambush ? 2 : 0) + (fort ? 1 : 0);
```

`getMap` is already imported/used in the resolve layer; use the same registry
lookup. The fort adds exactly one die to the defender's Advance roll. Surface the
fort in the `diceRolled` event / combat log context so it is clear *why* the
defence has an extra die (passive — unlike Ambush, no card is played, so no
`playCard` event is emitted).

## 3. Rendering — layered borders

Borders are strokes of the tile's real fused outline (`tile.rings`), drawn in
`featureGlyphs` (`packages/board-render/src/assemble.ts:85`). The requirement is
three concentric bands in a fixed order — **base (outermost) → fort (middle) →
harbor (innermost)** — with the harbor's **dashed line inside** its own solid
line, always, regardless of which other features are present.

### Approach: dynamic nesting (chosen)

The *outermost feature actually present* stays centered on the tile edge, so a
base-only tile and the common harbor-only tile keep today's look. Each
further-in border nests so its outer edge meets the previous border's inner
edge:

- **base (HQ):** centered on the edge, width 8, seat colour — unchanged.
- **fort:** nested inside base, **white** (`#ffffff`), width ~6.
- **harbor solid:** nested inside fort, black, width 5.
- **harbor dash:** hugs just **inside** the harbor solid — flip the current
  `HARBOR_DASH_OFFSET` from outward to inward — thick dashed, unchanged width.

Implementation uses `offsetRingsOutward(rings, distance)` with **negative**
distances for inward offsets (the helper already supports this via its
outward-normal sign). A small cursor walks inward: the outermost present border
is centered at offset 0; each subsequent present border's center is placed so its
outer edge meets the previous band's inner edge. The harbor dash is offset one
further step inside the harbor solid.

Widths and inter-band gaps are tunable defaults, dialed in visually during
implementation.

### Rejected alternative

Fixed bands where the harbor always sits inset even when it is the only feature.
Rejected because most Rivers tiles are harbors, so it would visibly change every
harbor tile on the board.

## 4. Testing

- **Engine:** unit test that a land Advance defender on a fort tile rolls one
  extra die, and that fort stacks with Ambush (1 → 4 dice). Confirm `sail`,
  `bombard`, and `shell` are unaffected.
- **Board-render:** update snapshots (`-u`) for the new border layering; add a
  fixture tile carrying base + fort + harbor together to lock the three-band
  nesting order and the inside-dash.
- **Editor:** the fort toggle round-trips through save/load; setting a fort on a
  sea tile is rejected/disabled.

## Out of scope

- No fort glyph/icon or legend entry — the border alone denotes a fort.
- No forts on the shipped Rivers map.
- No changes to sea combat, bombard, or shell.
