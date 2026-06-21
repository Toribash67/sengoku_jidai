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

> **SVG internals (verified):** Each visible tile is a `<use>` that references one of five
> shared geometry `<path>` defs (`path9`, `path9-2`, `path9-2-2`, `path9-5`, `path9-5-0`).
> Those defs are declared inside `<g id="layer1" style="display:none">` — i.e. `layer1` is
> the de-facto `<defs>` store and **must NOT be removed**. The defs carry inline `fill`/
> `stroke`, which by SVG cascade rules win over a `fill` set on the `<use>`. So recoloring
> requires neutralizing the def styling first (see SVG preparation). There is also an empty
> real `<defs id="defs1"/>` where the stripe `<pattern>` is injected.
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

On mount `MapBoard` injects the raw SVG into the DOM and runs the one-time preparation
(below), then on every render decorates each `tile1…tile22`:

1. **Owner/supply tint** — set the tile `<use>` element's `style.fill` (inline style wins
   over the def, which prep has set to `inherit`):
   - `owner === seat` **and** `suppliedBy === seat` → solid seat colour.
   - `owner === seat` **and** not supplied → striped seat colour via `url(#stripe-red)` /
     `url(#stripe-black)` (SVG `<pattern>` injected into `<defs>` during prep).
   - `owner === null` → the kind-based default colour (land vs sea), since prep neutralized
     the def's own fill. The pure `tileFill(kind, owner, suppliedBy)` helper returns the
     exact fill string for all cases.
   - Sea and land tiles tint identically by owner (ships can own sea areas).
2. **Click** — attach a click handler on each tile `<use>` → `onSelectArea(id)`.
3. **Selection highlight** — set the tile `<use>` `style.stroke`/`style.strokeWidth`
   (default black/5; selected gold/8). Prep set the def stroke to `inherit` so this wins.
4. **Unit count** — draw a small `<text>` `Nt·Ms` (troops·ships) in a top-level overlay
   `<g>`, positioned at the tile center mapped to root coordinates via
   `useEl.getBBox()` + `useEl.getCTM()` (avoids the rotated tile-group flipping the text);
   omit when the tile has zero units.
5. **Action-space occupancy** — for each occupied on-map action space, draw an occupancy
   `<circle>` (seat-coloured) in the overlay `<g>` at the corresponding order-slot's center
   (same getBBox+getCTM mapping). The engine space id maps to the SVG slot id by type:
   `advance-tileN → #move-tileN`, `sail-tileN → #sail-tileN`, `bombard-tileN →
   #bombard-tileN`, `shell-tileN → #shell-tileN`. Support spaces
   (reinforce/embark/plan) have no board slot and are skipped. A pure `slotIdForSpace`
   helper performs this mapping.

The overlay `<g>` is fully rebuilt on each decorate pass (cleared then repopulated), so it
stays in sync with view/selection changes without leaking stale nodes.

**Left entirely to the existing artwork** (no duplicate overlay): stars (`valueStars`),
HQ flags, harbors, bases, order-track labels. `valueStars`, `kind`, and `suppliedBy`
continue to appear in the side panel on select.

## SVG preparation

The file is used verbatim from disk; preparation is done **at runtime** on the injected
DOM (no second checked-in copy, no build transform). On mount, after injecting the raw SVG:

- **Keep `layer1`.** It is `display:none` but holds the shared geometry `<path>` defs that
  every tile `<use>` references — removing it breaks the map.
- **Neutralize tile-def styling so per-tile colour works.** For each of the five tile
  geometry defs (`path9`, `path9-2`, `path9-2-2`, `path9-5`, `path9-5-0`), set
  `style.fill`, `style.stroke`, and `style.strokeWidth` to `inherit`. Each tile `<use>`
  then supplies its own fill/stroke via inline style. (The `-3`/`-3-6` variants belong to
  HQ/base features and are left alone.)
- **Inject stripe patterns** `#stripe-red` and `#stripe-black` into the existing empty
  `<defs id="defs1">`.

The `tile1…tile22` ids remain the single source of truth and are not renamed. No
re-derivation of topology (the engine's `maps/riversMap.ts` already encodes it).

## Asset import

`cloned_map.svg` lives at the repo root and is the single canonical copy. The web imports
it as a raw string: `import rawMapSvg from "<path>/cloned_map.svg?raw"`. Because the file
sits above the web package, `packages/web/vite.config.ts` sets
`server.fs.allow = [searchForWorkspaceRoot(process.cwd())]` (Vite helper) so the dev server
can serve it. `vite/client` types (already in `packages/web/tsconfig.json`) provide the
`?raw` module typing — no extra `.d.ts` needed.

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
- Unowned tiles render the kind-based default colour (land vs sea), matching the original
  artwork's palette.

## Testing

- **Unit:** pure `tileFill` decision function — solid vs stripe vs untouched for the
  owner×supply combinations, per seat.
- **e2e (Playwright smoke, adapted from today's):** create a game; assert the inline board
  renders (`data-testid="board"` present and `#tile9` / `#tile13` exist in the DOM); click
  a tile and assert the side-panel detail updates; reload persists. No backend test changes
  (engine/server untouched).
