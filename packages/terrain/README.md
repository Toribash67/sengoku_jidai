# @sengoku-jidai/terrain

A **dev-only** offline pipeline that generates faded, antique-style terrain background
images for the game board. It is not part of the app or the Docker image — it produces a
static `webp` asset that the web client renders behind the SVG vectors.

The coastlines of the generated image follow the map's hex **land/sea** data. It works by
**image-to-image**: a colour **base** is rendered from the board SVG (land/outside in one
colour, sea in another), then a hosted model restyles it into antique watercolour. Carrying
the regions as colour is what makes the model put water in the sea and terrain on the land
(plain ControlNet only constrains edges, so it draws a hex grid and leaves the sea empty). A
single shared **style profile** keeps the look consistent across maps. **No reference image
is needed.**

```
board SVG ─┐
           ├─▶ colour base (land green / sea blue, blurred → organic coastline)  ─┐
MapDef ────┘                                                                      │
style profile (prompt + seed + colours + strength) ───────────────────────────────┼─▶ fal.ai (Flux img2img)
                                                                                  │        │
                                                                                  ▼        ▼
                                              terrain/<mapId>/base.png   terrain/<mapId>/generated.png
                                                                                           │
                                                                                           ▼  (resize → webp)
                                                  packages/web/src/assets/terrain/<mapId>.webp  ← committed asset
```

The base is rendered headlessly with `sharp` + `jsdom` (no browser), so the CLI runs anywhere.

## Preview the colour base (no API key, no cost)

The base is what conditions generation — its land/sea regions and coastlines. Render it on
its own, free:

```bash
pnpm build:libs                                      # build the engine (one time / after engine changes)
pnpm --filter @sengoku-jidai/terrain gen:base rivers # render only the colour base
```

It writes **`terrain/rivers/base.png`** (repo root) — the green land / blue sea map with
softened (organic) coastlines. The quickest way to sanity-check a new map before spending a
generation.

## Generate a terrain background (full pipeline)

This calls the hosted **fal.ai** API, so it needs an API key (no reference image required):

```bash
export FAL_KEY=...                               # see .env.example; or put it in the git-ignored .env
pnpm build:libs                                  # build the engine first
pnpm --filter @sengoku-jidai/terrain gen rivers  # render base → img2img → webp
```

Outputs:

| Path                                           | What                                        | Commit it? |
| ---------------------------------------------- | ------------------------------------------- | ---------- |
| `terrain/<mapId>/base.png`                     | The colour base fed to img2img (inspection) | optional   |
| `terrain/<mapId>/generated.png`                | The raw full-res generation (inspection)    | optional   |
| `packages/web/src/assets/terrain/<mapId>.webp` | The bundled board background                | **yes**    |

Inspect the outputs, and when you're happy, **commit the `.webp`**. The web board picks it up
automatically (Vite bundles `src/assets/terrain/*.webp`); until an asset is committed, the
board renders with flat tile fills as before.

## Tuning the style

Everything that controls the look lives in [`profiles/antique.json`](profiles/antique.json),
shared by every map (full field list in [`profiles/README.md`](profiles/README.md)):

- `prompt` / `seed` — locked text + seed for consistency.
- `strength` — the key dial. Too low keeps the flat base (no texture); too high reshapes the
  geography; **0.92** adds antique texture while preserving the layout.
- `landColor` / `seaColor` — the base colours that carry land vs. water into the result.
- `blurSigma` — softens hex corners into organic coastlines (a hard hex edge makes the model
  draw a grid).
- `model` — the fal.ai image-to-image endpoint (default `fal-ai/flux/dev/image-to-image`).

To restyle every map, tune one profile and regenerate. A second art style is a second profile.

## Adding terrain for a future map

1. Author the map's SVG (tile ids `#tileN`) and its `MapDefinition` (registered in the engine).
2. Add the map's SVG path to `SVG_BY_MAP` in [`src/mapSources.ts`](src/mapSources.ts).
3. `pnpm --filter @sengoku-jidai/terrain gen:base <mapId>` and check the colour base.
4. `pnpm --filter @sengoku-jidai/terrain gen <mapId>` and review the result.
5. Commit `packages/web/src/assets/terrain/<mapId>.webp`. No per-map style work is needed.
