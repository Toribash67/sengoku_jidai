# PR-D — Chromium terrain render dev tool + composite-helper relocation

**Date:** 2026-07-12
**Status:** Draft (first sub-project of [multiple-terrains](2026-07-12-multiple-terrains-design.md))

A local dev tool that composites a map's board with a chosen terrain (or flat) into a viewable
image for visual verification — the check that would have caught the "terrain hidden behind
opaque tiles" bug (#82). Standalone; no dependency on the other terrain PRs. Along the way it
moves the pure SVG-composite helpers into `board-render` so the tool and the app render through
one shared code path (a tool that diverged from the app couldn't verify it).

## Goal

Given a map id (and optionally a terrain image), produce a self-contained HTML render of the
board with the terrain composited exactly as the editor Preview does it, then a PNG via the
existing Chromium shim. Faithful (shares the app's code path), env-honest (no CI claim), quick.

## Part 1 — Relocate the pure composite helpers into `board-render`

These helpers are framework-agnostic SVG-string logic; `board-render` (which already owns SVG
assembly and is the lower layer both web and this tool can import) is their correct home.

**Move into `board-render`:**
- `parseViewBox` and `injectTerrainBackground` — from
  `packages/web/src/components/editor/terrainPreview.ts` → new
  `packages/board-render/src/terrainComposite.ts`.
- `terrainImageAttrs` — from `packages/web/src/components/board/terrainImages.ts` → the same
  `terrainComposite.ts` (its only current callers are `injectTerrainBackground` and the play
  view's `MapBoard`).
- Export all three from `packages/board-render/src/index.ts`.
- Move the unit tests: `packages/web/test/editor/terrainPreview.test.ts` →
  `packages/board-render/test/terrainComposite.test.ts` (imports updated to `../src/…`). They are
  pure string tests and run unchanged under board-render's vitest.

**Update web consumers (no behavior change):**
- `packages/web/src/components/editor/EditorScreen.tsx` — import `injectTerrainBackground` from
  `@sengoku-jidai/board-render` instead of `./terrainPreview.js`.
- `packages/web/src/components/board/MapBoard.tsx` — import `terrainImageAttrs` from
  `@sengoku-jidai/board-render` instead of `./terrainImages.js`.
- `packages/web/src/components/board/terrainImages.ts` — drop `terrainImageAttrs`; keep the
  web-specific URL logic (`resolveTerrain`, `terrainImage`, `terrainApiUrl`, `resolveTerrainUrl`).
- `packages/web/test/board/terrainLayer.test.ts` — import `terrainImageAttrs` from
  `@sengoku-jidai/board-render`.
- Delete `packages/web/src/components/editor/terrainPreview.ts` (now empty of exports).

`board-render` already builds to dist and is consumed by web from dist, so `build:libs` must run
before web typecheck/tests (existing constraint). The moves are additive to board-render's public
API.

## Part 2 — The render tool

`packages/board-render/scripts/terrain-shot.ts` (the `scripts/` dir is eslint-boundary-exempt;
precedent: `scripts/preview.ts`). Run with `tsx` like the existing `preview` script.

**Interface:**
```
tsx packages/board-render/scripts/terrain-shot.ts \
  --map <mapId> [--terrain-url <url|path>] --out <file.html> [--base http://localhost:18081]
```
- `--map <mapId>` — GET `{base}/api/maps/:id`, take `.source`, `assembleBoardSvg(buildScene(
  compileHexMap(source)))`. (`--base` defaults to `http://localhost:18081`, the local deploy.)
- `--terrain-url <url|path>` — optional. A URL (fetched) or a local file path (read) to a webp.
  Its bytes are base64'd into a `data:image/webp;base64,…` URI. Omitted → flat (board only). Being
  a raw url/path, the tool is agnostic to the terrain API shape (works with today's
  `/terrain.webp` and PR-A's `/terrains/:tid.webp`).
- Composite with the relocated `injectTerrainBackground(svg, dataUri)`, wrap in
  `<!doctype html><html><body style="margin:0">…</body></html>`, write to `--out`.
- Print the exact render command to finish the PNG (kept out of the committed script because it is
  Martin-box-specific):
  `LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs <out.html> <out.png> [w] [h]`

Uses Node global `fetch` and `node:fs` only — no new dependencies. `@sengoku-jidai/engine` and
`board-render/src` are already importable in this script context (as `preview.ts` proves).

Add a convenience script to `packages/board-render/package.json`:
`"terrain-shot": "tsx scripts/terrain-shot.ts"`.

## Error handling

- Missing `--map` or `--out` → print usage to stderr, exit 1.
- Non-200 from the maps API, or a terrain fetch/read failure → print the status/path and exit 1
  (don't emit a half-composited file).
- Unparseable source (compile throws) → let it throw with the stack (dev tool).

## Testing

- The relocated pure helpers keep their full unit suite (now under board-render) — the move must
  leave them green, and `terrainLayer.test.ts` green in web.
- Full gate green after the relocation (build:libs → typecheck → web + board-render tests → lint →
  prettier); editor + play e2e untouched by a pure move but must stay green.
- The script itself is a dev tool, verified by a manual smoke run: render Small Testmap flat and
  with its current `/terrain.webp`, eyeball both PNGs (no fal credits — reuses an existing
  terrain). Document the two commands in the report.

## Constraints

No new deps; `corepack pnpm`; rebuild libs before filtered web tests; e2e via the temp-port recipe
only (never 18081 = live prod); the tool is a **local** aid, never a CI gate (headless Chromium
needs the `LD_LIBRARY_PATH` userland-libs shim that exists only on Martin's box).
