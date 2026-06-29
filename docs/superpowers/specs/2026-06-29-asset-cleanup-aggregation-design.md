# Asset cleanup + per-map aggregation

## Problem

Committed assets are scattered and partly stale. Source assets, build artifacts, and
runtime-bundled assets are mixed across the repo root and two packages, with no per-map
grouping:

- `cloned_map.svg` (repo root) — board SVG source.
- `cards/rivers/*.png` (repo root) — full-res card scans (source).
- `packages/web/src/assets/cards/*.webp` + `packages/web/src/assets/terrain/rivers.webp`
  — runtime, Vite-bundled.
- `packages/terrain/assets/style-ref.jpeg` — global generation input.
- `packages/terrain/assets/controls/rivers-control.png` — regenerable, **write-only,
  nothing reads it**.
- `terrain/rivers/base.png`, `terrain/rivers/generated.png` — **stale** outputs of the
  abandoned old generation pipeline.

Goal: remove unused/stale assets and the dead code that produced them, and aggregate the
rest into one folder per map with related assets in subfolders.

## Constraints

- Runtime webp (cards + terrain background) are pulled in by **Vite imports/globs that
  expect them under `packages/web/src/`** — they cannot move to a repo-root tree without
  cross-package bundler reach. So aggregation is **split by role**:
  source/tooling assets live at repo root; runtime/bundled assets stay under the web
  package, but both are organized per-map.
- `style-ref.jpeg` is a global generation input, not a per-map asset; it stays in the
  terrain package.
- Use `git mv` so history follows moved files.

## Decisions

- Split-by-role aggregation (not a single root tree).
- Remove the committed control image (regenerable, unused).
- Remove the dead old-pipeline CLIs and their now-unused modules.
- Rename `cloned_map.svg` → `board.svg` (generic per-map name; clone-ids inside untouched).

## Deletions

Stale assets:
- `terrain/rivers/base.png`
- `terrain/rivers/generated.png`
- `packages/terrain/assets/controls/rivers-control.png`

Dead old-pipeline code (verified imported only by each other / removed entry points; nothing
in the new pipeline or outside `@sengoku-jidai/terrain` imports them):
- src: `cli.ts`, `controlCli.ts`, `matrixCli.ts`, `pipeline.ts`, `matrixBackend.ts`,
  `matrixProfile.ts`, `contactSheet.ts`
- tests: `matrixBackend.test.ts`, `matrixProfile.test.ts`, `contactSheet.test.ts`
- `package.json` scripts: `gen`, `gen:base`, `gen:matrix`

Kept (used by the new `gen:map` / `gen:map-control` pipeline): `backend`, `styleProfile`,
`postprocess`, `controlImage`, `composite`, `editPass`, `masks`, `mapSources`,
`mapProfile`, `mapPipeline`, `mapPipelineCli`, `mapControlCli`, `mapControlArgs`.

## Target layout

Source/tooling assets → repo-root `assets/maps/<map>/`:
```
assets/maps/rivers/
  board.svg          (was cloned_map.svg)
  cards/*.png        (9 full-res source scans, was cards/rivers/*.png)
```

Runtime/bundled assets → per-map under the web package:
```
packages/web/src/assets/rivers/
  background.webp    (was packages/web/src/assets/terrain/rivers.webp)
  cards/*.webp       (9, was packages/web/src/assets/cards/*.webp)
```

Unchanged: `packages/terrain/assets/style-ref.jpeg`.

Removed directories after the moves: root `cards/`, root `terrain/`,
`packages/web/src/assets/cards/`, `packages/web/src/assets/terrain/`,
`packages/terrain/assets/controls/`.

## Code edits

- `packages/web/src/components/board/MapBoard.tsx`: SVG import
  `../../../../../cloned_map.svg?raw` → `../../../../../assets/maps/rivers/board.svg?raw`.
- `packages/terrain/src/mapSources.ts`: `SVG_BY_MAP.rivers = "assets/maps/rivers/board.svg"`;
  **remove the `mapControlPath` export** (control no longer committed).
- `packages/terrain/src/mapControlCli.ts`: stop importing/using `mapControlPath`; write the
  (preview-only) control to the scratch output dir using the same
  `TERRAIN_OUT_DIR ?? <repo>/terrain/<mapId>/` pattern as `mapPipelineCli.ts`, to
  `control.png`.
- `packages/web/src/components/board/cardImages.ts`: card imports →
  `../../assets/rivers/cards/<name>.webp`; update the regenerate-command comment to the new
  source (`assets/maps/rivers/cards/`) and output (`packages/web/src/assets/rivers/cards`)
  paths.
- `packages/web/src/components/board/terrainImages.ts`: glob
  `../../assets/*/background.webp`, keyed by the parent directory name = `<mapId>`.
- `packages/web/test/board/terrainImages.test.ts`: update the mocked glob keys/paths to the
  new shape.
- `packages/terrain/test/mapSources.test.ts`: update the `mapSvgPath` assertion to
  `assets/maps/rivers/board.svg`; remove the `mapControlPath` describe block.
- `.gitignore`: add `/terrain/` (repo-local scratch output dir for `gen:map` /
  `gen:map-control`, so generated artifacts are never committed again).
- `README.md`: remove `gen` / `gen:base` usage lines; fix any asset paths that moved.
- `packages/engine/src/maps/riversMap.ts`: comments mentioning `cloned_map.svg` → `board.svg`.

## Verification

- `pnpm --filter @sengoku-jidai/terrain typecheck` + `test`
- `pnpm --filter @sengoku-jidai/web typecheck` + `test`
- `pnpm -w lint` + prettier on touched files
- **Production build** (`pnpm --filter @sengoku-jidai/web build` or the repo build) — the
  real safety net: Vite must resolve every moved import/glob, or the build fails.
- CI Browser Smoke Test confirms the board still renders the background + cards (no local
  browser verification available).
- Grep for orphan references to old paths (`cloned_map.svg`, `assets/cards/`,
  `assets/terrain/`, `assets/controls`, `cards/rivers`, `terrain/rivers`,
  `mapControlPath`) returns only the spec/plan docs.
