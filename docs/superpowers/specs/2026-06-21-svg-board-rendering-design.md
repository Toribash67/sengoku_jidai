# SVG Board Rendering — Design

**Date:** 2026-06-21
**Status:** Approved (pending written-spec review)
**Phase:** First slice of the interactive Rivers board UI (see memory `next-phase-interactive-ui`).

## Goal

Replace the placeholder card-grid board (`packages/web/src/components/board/Board.tsx`)
with the canonical hand-drawn map, `cloned_map.svg`, rendered inline. The map is
**read-only with select + highlight**: clicking a tile selects it (highlight + side-panel
details), exactly the interaction the app already supports. Issuing orders other than
**Pass** is explicitly out of scope.

No engine, server, or shared-package changes. This consumes the existing LEAN
`PlayerGameView` as-is.

## Why this is safe / localized

- `cloned_map.svg` `<path>`/`<use>` elements carry ids `tile1…tile22` that match the
  engine's area ids exactly (`tile9` = red HQ, `tile13` = black HQ). State overlays key
  on area id with no remapping.
- The SVG already contains all **static** artwork we must NOT redraw: `redflag`/
  `blackflag` (HQ markers), `feature-seaharbor`/`feature-harbortile` (harbors),
  `feature-basered`/`feature-baseblack` (bases), and four order tracks (`order-move`,
  `order-sail`, `order-bombard`, `order-shell`) whose per-tile slots are ided like
  `bombard-tile22`.
- Today `App.tsx` already owns `selectedAreaId`, the detail panel, the Pass button, the
  seat switcher, and the event log. Only the board child changes.

## Approach

**Inline SVG with SVG-native overlays** (chosen over an HTML overlay layer):

- The SVG is imported into the web bundle as raw markup (Vite `?raw`) and rendered inline
  by a new `MapBoard` component.
- Dynamic state is drawn *inside the same SVG coordinate space* — tile fills, unit-count
  `<text>`, occupancy `<circle>`, selection outline — so everything scales together with
  no HTML/SVG alignment drift.
- An `<img src>` embed was rejected: it cannot recolor individual tiles or attach per-tile
  click handlers, both of which this design requires.

## Components & data flow

- `App.tsx`: unchanged behavior. Still fetches `PlayerGameView`, owns `selectedAreaId`,
  renders the side panel (detail + Pass + seat switcher + event log). Swaps the `<Board>`
  child for `<MapBoard>`.
- `MapBoard.tsx` (new, replaces `Board.tsx`): same prop shape as today —
  `{ areas: PlayerAreaView[]; activeSeat: SeatId; selectedAreaId: string | null;
  onSelectArea: (id: string) => void }` — plus it additionally reads `actionSpaces:
  Record<string, SeatId | null>` from the view for occupancy markers.
- A tiny pure helper module (e.g. `tileFill.ts`) exposes the fill decision so it is unit
  testable in isolation.

The `data-testid="board"` contract is preserved; tiles remain individually addressable
(by `#tileN` and a per-tile `data-testid`) so the existing e2e smoke adapts cleanly.

## Overlay rendering

On mount `MapBoard` injects the raw SVG into the DOM, then for each `tile1…tile22`:

1. **Owner/supply tint** — set the tile `<use>` `fill`:
   - `owner === seat` **and** `suppliedBy === seat` → solid seat colour.
   - `owner === seat` **and** not supplied → striped seat colour via an SVG `<pattern>`
     injected into `<defs>` (`#stripe-red`, `#stripe-black`).
   - `owner === null` → leave the artwork's default fill untouched.
   - Sea and land tiles tint identically by owner (ships can own sea areas).
2. **Click** — attach a handler → `onSelectArea(id)`.
3. **Selection highlight** — apply an outline class/stroke when `selectedAreaId === id`.
4. **Unit count** — draw a small `<text>` `Nt·Ms` (troops·ships) at the tile's `getBBox()`
   center; omit when the tile has zero units.
5. **Action-space occupancy** — when `actionSpaces` shows a commander on a slot linked to
   this area, draw an occupancy `<circle>` near the tile center. Mapping from action-space
   id to area id uses the existing `order-*`/`*-tileN` slot id convention.

**Left entirely to the existing artwork** (no duplicate overlay): stars (`valueStars`),
HQ flags, harbors, bases, order-track labels. `valueStars`, `kind`, and `suppliedBy`
continue to appear in the side panel on select.

## SVG preparation

Used essentially verbatim. A light, one-time preparation:

- Strip the hidden Inkscape `layer1` group (`style="display:none"` cruft at the top) to
  reduce noise.
- Ensure the stripe `<pattern>` defs exist (added in `<defs>`).

The `tile1…tile22` ids remain the single source of truth and are not renamed. No
re-derivation of topology (the engine's `maps/riversMap.ts` already encodes it).

## Scope boundaries

In scope:

- Inline render of `cloned_map.svg`.
- Owner solid-tint / out-of-supply stripe.
- Click-to-select + highlight + side-panel details (port of existing behavior).
- Unit-count text and action-space occupancy markers.
- Pass (already wired) stays.

Out of scope (deferred to later phases):

- Issuing any order other than Pass (advance/sail/bombard/shell/reinforce/embark/plan).
- Enriching the engine `legal` payload (per-action target enumeration).
- WebSocket realtime, operation cards, Fortress/Siege.
- Any engine / server / shared change.

## Error handling / edge cases

- A `tile` id present in the SVG but absent from `view.areas` (or vice versa) should fail
  loud in dev: log/throw a clear message rather than silently mis-tinting. The id sets are
  expected to match exactly.
- Zero-unit tiles draw no unit text.
- Unowned tiles keep their drawn fill (no tint applied).

## Testing

- **Unit:** pure `tileFill` decision function — solid vs stripe vs untouched for the
  owner×supply combinations, per seat.
- **e2e (Playwright smoke, adapted from today's):** create a game; assert the inline board
  renders (`data-testid="board"` present and `#tile9` / `#tile13` exist in the DOM); click
  a tile and assert the side-panel detail updates; reload persists. No backend test changes
  (engine/server untouched).
