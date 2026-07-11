# In-editor terrain preview — design

**Date:** 2026-07-11
**Status:** Draft (design approved with §1 as controller default; user review pending)

## Problem

After clicking "Generate terrain" for a saved custom map, the editor gives no way to
see the result — the author has to open fal.ai (or the deployed play view) to check it.
This is the last open item of the custom-map-editor initiative after the terrain-quality
fixes shipped (PRs #79, #80).

## Goal

Show a saved custom map's generated terrain webp inside the editor, updating automatically
when generation finishes, reusing the existing terrain-URL and board-render machinery.

## Non-goals

- Terrain on the live editing canvas (grid-hex render). Preview mode is the surface.
- Detecting/warning when terrain is stale relative to unsaved geometry edits.
- Any change to terrain generation, the terrain package, or the server.

## Placement decision (§1)

Terrain overlays the existing **Preview** board only (`.editor-preview`), not the live
editing canvas and not a separate panel.

Rationale: Preview already renders the true board via
`assembleBoardSvg(buildScene(compileHexMap(docToSource(doc))))` — the same pipeline the
terrain webp is generated from — so the image aligns pixel-for-pixel under
`preserveAspectRatio="none"`, exactly as the play view's `MapBoard` does it. The editing
canvas is a different render (editor grid hexes) where terrain would drift as geometry is
edited. This is the lowest-risk, highest-fidelity option and directly answers the ask.

(Controller default made while the user was AFK; revisit if a live-canvas backdrop is wanted.)

## Architecture

Three small, well-bounded pieces:

### A. Pure markup helper — `injectTerrainBackground`

New file `packages/web/src/components/editor/terrainPreview.ts`:

```
injectTerrainBackground(svgMarkup: string, terrainUrl: string | null): string
```

- If `terrainUrl` is null/empty → return `svgMarkup` unchanged.
- Parse `viewBox="x y w h"` from the assembled SVG string. If absent → return unchanged.
- Build an `<image>` element covering the viewBox, using the shared `terrainImageAttrs`
  (x/y/width/height + `preserveAspectRatio="none"`), `pointer-events="none"`, and both
  `href` and `xlink:href` set to `terrainUrl` (SVG-image href compatibility, matching
  `applyTerrain`).
- Splice the `<image>` immediately after the opening `<svg …>` tag so it is the first
  child (bottom layer, beneath `defs`/tiles/features). Guard against double-injection
  (helper is called on fresh markup each render, so a simple "already contains the id"
  check is belt-and-suspenders).

Pure and string-only → unit-testable despite web having no jsdom/testing-library.

### B. Shared viewBox→image attrs — relocate `terrainImageAttrs`

`terrainImageAttrs` currently lives in `MapBoard.tsx`. Move it into
`packages/web/src/components/board/terrainImages.ts` (the terrain-URL home) and import it
from both `MapBoard.tsx` (`applyTerrain`) and the new helper, so preview and play derive
identical image geometry from a single source.

### C. Wiring in `EditorScreen` + `TerrainButton`

- `TerrainButton` gains one optional prop `onStatusChange?(terrain: TerrainStatus): void`.
  It already `setState`s the UI on every seed/poll/click; it additionally reports the raw
  `TerrainStatus` upward at those points. Its tested pure helpers (`uiFromStatus`,
  `uiFromError`) and lifecycle/cancellation logic are unchanged.
- `EditorScreen` holds `const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>("none")`,
  passes `onStatusChange={setTerrainStatus}` to `TerrainButton`, and resets it on
  mapId/doc-id change.
- Preview terrain URL:
  `resolveTerrainUrl({ committed: terrainImage(id), terrain: terrainStatus, mapId: id })`
  where `id = state.doc.id ?? ""`. Committed built-in asset wins; else the API url once
  `ready`; else null.
- The `previewResult` memo wraps its `svg` through `injectTerrainBackground(svg, url)`.
  When polling flips `terrainStatus` to `ready`, the memo recomputes and the preview
  updates live (while Preview is open).

### Data flow

```
TerrainButton poll → onStatusChange(status) → EditorScreen.terrainStatus
      → resolveTerrainUrl(...) → previewResult memo
      → injectTerrainBackground(assembledSvg, url) → .editor-preview innerHTML
```

## Regenerate & staleness (accepted limitations)

- **Regenerate:** the API url is stable, so the browser may serve the cached prior webp.
  Append a cache-bust query keyed to a ready-transition counter (e.g. `?v=<n>`), bumped
  each time status transitions into `ready`, so a fresh generation is visibly reflected.
- **Edit-after-generate:** terrain is baked from the *saved* source. Editing geometry then
  previewing shows slightly stale terrain until regeneration. v1 accepts this without a
  banner (noted, not built).

## Testing

- Unit (pure): `injectTerrainBackground` — injects image for a url; passes markup through
  unchanged for null url and for markup without a viewBox; does not double-inject;
  produced attrs match `terrainImageAttrs` for a known viewBox.
- `resolveTerrainUrl` / `terrainImageAttrs` already covered; extend if relocation warrants.
- E2e: existing `tests/e2e/map-editor.spec.ts` (+ `-mobile`) must stay green with stable
  DOM hooks preserved. CI has no `FAL_KEY`, so no generation-dependent e2e is added; the
  preview simply shows flat fills there (URL resolves to null), unchanged from today.

## Constraints carried forward

No new npm deps; pure-logic tests only in web; `corepack pnpm`; rebuild libs before
filtered web tests; e2e only via the temp-port recipe (never port 18081 = live prod).
