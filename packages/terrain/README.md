# @sengoku-jidai/terrain

A **dev-only** offline pipeline that generates antique-style terrain background images for
the game board. It runs outside the app and CI: the generated image is committed as a static
asset, so the running app never calls an image API. Until an asset is committed, the board
renders with flat tile fills.

## How it works

1. Render a flat land/sea **control** image from the board SVG (`assets/maps/<map>/board.svg`):
   green = land, blue = sea, with the hex coastline domain-warped into organic shores.
2. Send the control plus a shared **style reference**
   (`assets/style-ref.jpeg`) to a multi-image instruction-**edit** model (fal.ai
   `nano-banana-pro/edit`), which redraws the control's land/sea layout in the reference's
   hand-drawn style.
3. Convert to `background.webp` at the board's aspect ratio.

Everything that controls the look lives in one shared profile,
[`profiles/map.json`](profiles/map.json) — see [`profiles/README.md`](profiles/README.md).

## Commands

```bash
# Preview only the land/sea control (no API key, no cost). Writes terrain/<map>/control.png.
pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId> [--amplitude <px>]

# Full pipeline (needs FAL_KEY). Writes the control, intermediates, and background.webp.
pnpm --filter @sengoku-jidai/terrain gen:map <mapId>
```

`--amplitude <px>` overrides the profile's coastline-warp amplitude (max pixel displacement;
0 disables) so you can sweep distortion cheaply with the fal-free control render.

## Output location

Both commands write to `TERRAIN_OUT_DIR/<mapId>/` if `TERRAIN_OUT_DIR` is set, otherwise the
git-ignored repo-local `terrain/<mapId>/`. To ship a generated background, copy
`background.webp` to `packages/web/src/assets/<mapId>/background.webp` and commit it.

## Adding a map

1. Add the board SVG at `assets/maps/<mapId>/board.svg`.
2. Add an `SVG_BY_MAP` entry in `src/mapSources.ts`.
3. Run `gen:map <mapId>` and promote the resulting `background.webp`.
