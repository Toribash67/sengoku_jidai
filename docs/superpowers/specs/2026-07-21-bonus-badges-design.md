# Bonus-specific tile badges

**Status:** approved design, ready for implementation plan
**Date:** 2026-07-21

## Problem

Bonus slots on the board carry an icon (currently a sun / moon / star), but the icon
has three flaws:

1. **It doesn't say which bonus is on which tile.** The sun/moon/star are cosmetic slot
   markers assigned by slot *index* — literally "flavour only" per the code comment. On the
   physical board this was unavoidable: the bonus assigned to each slot is drawn randomly at
   setup, so the printed board could only distinguish the slots, not name their bonuses.
   Digitally we know the assignment, so the symbol should identify the actual bonus.
2. **The icon is too small.**
3. **It sits in the wrong place** (lower-left of the tile centroid). It should be in the
   tile's rightmost corner.

## Key constraint that shapes the design

Bonuses are assigned **per game**, not per map. At setup `game.ts` shuffles the ruleset's
`bonusSet` and writes `state.bonuses: Record<areaId, BonusType>`; this already reaches the
client as `view.bonuses`. The current on-board icon, by contrast, is baked into the
**static, per-map SVG** produced by `board-render` and cached per map. A per-map artifact
cannot encode a per-game assignment.

Therefore the bonus icon must be drawn (or finalized) at **runtime**, from `view.bonuses`,
the same way owner tints and unit stacks are drawn in the web's `decorate()` overlay.
Map-static features (value-stars, HQ, harbour) stay baked; per-game features belong to the
runtime layer.

The five bonuses in Rivers are `barracks, warRoom, pirateHaven, shipyard, hiddenBase`
(the type also includes `armoury`, Siege-only, not in Rivers).

## Design

### 1. Rendering: bake generic, retarget at runtime

- **`board-render`** bakes **one generic bonus-slot badge per slot** — repositioned to the
  tile's right corner and enlarged — tagged `class="bonus-marker"` and `data-area="<id>"`.
  This serves any context with no game: the map **editor** and static map previews. It uses a
  neutral placeholder symbol (a sumi ring/dot), since without a game there is no assigned
  bonus to name.
- **`MapBoard.decorate()`** (web) receives a new `bonuses` prop (`Record<areaId, BonusType>`,
  from `view.bonuses`). For each entry it finds the baked `.bonus-marker[data-area="<id>"]`
  and **retargets its `<use href>`** to the bonus-specific symbol via `bonusTypeGlyph(bonus)`.
  Retargeting the existing element (rather than hiding + redrawing) keeps position and size
  from the baked marker and is idempotent, so it survives the 3s poll's `decorate()` re-run.
  With no `bonuses` data the marker stays generic.

The badge symbols live in `board-render`'s `ASSETS.defs`, which are injected into every
assembled SVG — so the `<use>` reference resolves in both the baked (editor) and retargeted
(game) cases.

### 2. Placeholder art: lettered badges

Add lettered-badge `<symbol>`s to `board-render` ASSETS — a washi disc with a single sumi
letter — one per `BonusType`, plus the neutral generic disc:

| Bonus | Letter |
|-------|--------|
| barracks | B |
| warRoom | W |
| pirateHaven | P |
| shipyard | S |
| hiddenBase | H |
| armoury | A |

Add `bonusTypeGlyph(bonus: BonusType): GlyphId`, exhaustive over `BonusType`. Replacing the
placeholders with final art later means swapping each symbol's inner geometry; the mapping is
untouched. The obsolete sun/moon/star index cycling (`bonusGlyph(index)` and the
`glyph-bonus-sun/moon/star` defs) is removed.

### 3. Position and size

Anchor the badge at the tile's **rightmost corner**: the E vertex of the tile's rightmost hex
(a new `rightmostHex` helper mirroring the existing `bottommostHex`), offset along the (+1, 0)
axis at a fraction of the centre→vertex distance, matching how the value-star badge is seated
at the SE vertex. Size the badge relative to `hexSize` (roughly 2× the current apparent size)
so it tracks any map's scale. It renders in the `features` layer, above owner tints, and does
not collide with order tokens (NW/NE vertices) or the value-star badge (SE vertex).

### 4. Area detail panel: name + effect

`AreaDetails.tsx` already renders `Bonus: {raw enum}` from `view.bonuses[area.id]`. Replace
the raw enum with a human-readable name and short effect from a new pure helper
`bonusLabel(bonus: BonusType): { name: string; effect: string }`:

| Bonus | Name | Effect |
|-------|------|--------|
| barracks | Barracks | +2 troops when you Reinforce |
| warRoom | War Room | +1 card when you Plan |
| pirateHaven | Pirate Haven | +1 die when you Bombard |
| shipyard | Shipyard | +1 ship when you Sail |
| hiddenBase | Hidden Base | +1 troop when you Advance |
| armoury | Armoury | (Siege only) |

Rendered as e.g. `Bonus: Shipyard — +1 ship when you Sail` in the existing trait list.

## Components and interfaces

- `board-render/assets.ts`: new lettered-badge + generic-disc `<symbol>`s; `GlyphId` gains the
  new ids and drops the sun/moon/star; new `bonusTypeGlyph(bonus)`; `bonusGlyph(index)` removed.
- `board-render/scene.ts`: `rightmostHex` helper; bonus anchor moved to the E vertex.
  `SceneTile.bonusGlyph` stays a `GlyphId` but is set to the single generic marker id for every
  slot (no more index cycling).
- `board-render/assemble.ts`: `featureGlyphs` places the generic marker with
  `class="bonus-marker" data-area="<id>"` at the new anchor and larger size.
- `web/MapBoard.tsx`: new `bonuses` prop; `decorate()` retargets `.bonus-marker` hrefs.
- `web/App.tsx` (or wherever MapBoard is mounted): pass `view.bonuses` down.
- `web/AreaDetails.tsx`: render name + effect via `bonusLabel`.
- New pure helper module for `bonusLabel` (web side, unit-tested).

## Testing

- **Unit:** `bonusTypeGlyph` (total over `BonusType`, distinct ids); `bonusLabel` (every
  `BonusType` returns a non-empty name + effect); update `board-render/test/scene.test.ts`
  (drop the sun-by-index assertion; assert the new anchor / generic marker).
- **Visual:** the throwaway SVG-render-harness method (assemble Rivers, render PNG, read it) to
  confirm badge size, right-corner placement, and no collision with stars/tokens.
- **e2e:** existing specs stay green; `AreaDetails` still renders a `Bonus:` line, now with the
  friendly name. No spec asserts the old raw text or the old glyph.

## Out of scope

- Final bonus artwork (Martin will draw it; this ships lettered placeholders).
- Any editor UI for assigning specific bonuses (bonuses remain randomly assigned at setup).
