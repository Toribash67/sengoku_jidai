# Mobile-usable map editor — design

**Date:** 2026-07-08
**Status:** Approved
**Scope:** `packages/web` map editor only (EditorScreen, EditorCanvas, EditorToolbar, InspectorPanel, app.css). The game screen, map library polish, and SP6 terrain work are out of scope.

## Goal

Make the hex map editor fully usable on a phone:

- No action may require right-click, shift-click, or a mouse wheel. Every action has an
  explicit clickable/tappable control.
- The layout must work at phone resolutions (~390px wide) as well as desktop.
- Tools and actions live in a dock locked to the bottom of the viewport.

## Current desktop-only blockers

1. Shift-click is the only way to build a multi-tile selection (needed for merging).
2. Mouse wheel is the only zoom.
3. With a paint tool (Land/Sea/Erase) active, any one-finger drag paints; panning is only
   possible with the Select tool. On touch there is no middle/right-button alternative.
4. Layout: `editor-body` is three fixed columns (toolbar | canvas | 280px inspector) and
   the header is a single wide row. No breakpoint exists for the editor (the game screen
   has one at 900px).

## Decisions

- **Unified bottom dock** on all screen sizes (not a mobile-only responsive variant).
  The left toolbar column is removed; `EditorToolbar` becomes the dock.
- **Sticky "Multi" toggle** replaces shift-click for additive selection. Shift-click
  remains as a desktop shortcut.
- **Two-finger pan / pinch zoom** in any tool mode; one finger always performs the active
  tool. Explicit **+/− zoom buttons** in the dock. The Select tool's one-finger drag
  continues to pan, so panning also has a fully explicit non-gesture path.
- **Gesture handling is hand-rolled**, extending the existing pointer-event code in
  `EditorCanvas` to track a map of active pointers (no new dependency such as
  `@use-gesture/react`).

## Layout

`editor-shell` remains a full-height column: header, banners/toasts, canvas (flexes to
fill), dock at the bottom of the viewport (same treatment as the game's `.action-bar`:
sticky bottom, elevated shadow).

### Dock

Icon buttons, minimum 44×44px touch targets, laid out in groups:

| Group | Buttons |
|---|---|
| Tools | Select, Land, Sea, Erase |
| Selection | Multi toggle (only enabled while Select is active) |
| History | Undo, Redo |
| Zoom | Zoom −, Zoom + |

- Each button keeps today's accessible name as `aria-label` ("Select tool", "Paint land",
  "Paint sea", "Erase", "Undo", "Redo"; new: "Multi-select", "Zoom in", "Zoom out") so the
  existing Playwright suite keeps passing.
- Active tool and Multi state use the existing `is-active` styling plus `aria-pressed`.
- Wide screens show a small text label under each icon; phones show icon-only.

### Inspector

- ≥900px: right-hand side panel, as today.
- <900px: bottom sheet over the canvas (above the dock). The sheet is always present:
  collapsed by default, showing a one-line header ("Map · 12 tiles" with no selection,
  "Land tile · 3 hexes" with one, "2 tiles selected" with several). Selecting a tile
  auto-expands it; an explicit collapse/expand button (plus tapping the header) toggles
  it — no drag-to-dismiss gesture. Expanded, it caps at ~50% of viewport height and
  scrolls internally.

This is the one responsive (non-unified) part of the layout: a permanently open sheet
would consume the phone canvas, and a 280px side panel cannot fit at 390px width.

### Header

On narrow screens the header wraps to two rows: row 1 = Back button + map name input
(flexes); row 2 = validity status, Preview, Save. No interaction changes.

## Interactions

- **Tap (Select tool):** replaces the selection. With Multi on, tap toggles the tile
  in/out of the selection (dispatches the existing `selectTile` with `additive: true` —
  no reducer change). Shift-click behaves like Multi-on for that click.
- **One-finger drag:** paints with Land/Sea/Erase; pans with Select (unchanged).
- **Second finger down:** cancels any in-progress paint stroke (already-painted hexes
  stay; undo covers mistakes) and switches the gesture to pan/pinch until all pointers
  lift.
- **Pinch:** scales the view around the two-pointer centroid, clamped to the existing
  MIN/MAX view width. **Two-finger drag:** pans by the centroid delta.
- **Zoom buttons:** step view width by ~1.4× per press around the viewport center, same
  clamping. **Wheel zoom:** unchanged.

## Copy changes

Inspector hint "Click a tile to edit it; shift-click to select several." becomes
"Tap a tile to edit it; use Multi to select several."

## Testing

- Unit tests for the gesture math (pointer map → pan/pinch view transform) and dock
  rendering/state (Multi enabled only with Select; zoom clamping).
- Existing `tests/e2e/map-editor.spec.ts` must keep passing unchanged (accessible names
  preserved).
- New mobile-viewport e2e (Playwright `viewport: 390×844`, `hasTouch: true`): paint via
  tap, two-finger pan, Multi-select two tiles, merge, save.
- Local e2e runs follow the usual temp-port recipe (never the live 18081 container).
