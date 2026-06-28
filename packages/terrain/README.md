# @sengoku-jidai/terrain

A **dev-only** offline pipeline that generates faded, antique-style terrain background
images for the game board. It is not part of the app or the Docker image — it produces a
static `webp` asset that the web client renders behind the SVG vectors.

The coastlines of the generated image follow the map's hex **land/sea** data, because the
image is conditioned (via ControlNet) on a 2-tone **control image** rendered directly from
the board SVG. A single shared **style profile** keeps the look consistent across maps.

```
board SVG ─┐
           ├─▶ control image (land=white / sea=black, exact coastline)  ─┐
MapDef ────┘                                                             │
style profile (prompt + seed + reference image) ────────────────────────┼─▶ fal.ai (SDXL + ControlNet + IP-Adapter)
                                                                         │        │
                                                                         ▼        ▼
                                          terrain/<mapId>/control.png   terrain/<mapId>/generated.png
                                                                                  │
                                                                                  ▼  (resize → webp)
                                                  packages/web/src/assets/terrain/<mapId>.webp  ← committed asset
```

## Preview the control image (no API key needed)

The control image is the land/sea mask the generator's coastline is conditioned on. You can
render it on its own — no `FAL_KEY`, no reference image, no cost:

```bash
pnpm build:libs                                         # build the engine (one time / after engine changes)
pnpm --filter @sengoku-jidai/terrain gen:control rivers # render only the control image
```

It writes **`terrain/rivers/control.png`** (repo root). Open that file to see the exact
land/sea coastline the terrain will follow — land (and everything outside the tiles) is
white, sea is black. This is the quickest way to sanity-check a new map's mask before spending
a generation.

## Generate a terrain background (full pipeline)

This calls the hosted **fal.ai** API, so it needs an API key and a style reference image.

### One-time setup

1. **API key** — get a key from [fal.ai](https://fal.ai) and set it in your environment (or
   the repo `.env`, which is git-ignored):

   ```bash
   export FAL_KEY=...        # see .env.example
   ```

2. **Style reference image** — add a curated reference image that defines the art style. It is
   fed to the model via IP-Adapter and is the main style dial. By default the profile expects:

   ```
   packages/terrain/profiles/antique-reference.png
   ```

   Use a single representative antique-map crop (~1024px). See
   [`profiles/README.md`](profiles/README.md) for details. This image is curated art — it is
   not generated here.

### Run it

```bash
pnpm build:libs                                  # build the engine first
pnpm --filter @sengoku-jidai/terrain gen rivers  # render control image → generate → webp
```

Outputs:

| Path                                           | What                                         | Commit it? |
| ---------------------------------------------- | -------------------------------------------- | ---------- |
| `terrain/<mapId>/control.png`                  | The land/sea control image (for inspection)  | optional   |
| `terrain/<mapId>/generated.png`                | The raw full-res generation (for inspection) | optional   |
| `packages/web/src/assets/terrain/<mapId>.webp` | The bundled board background                 | **yes**    |

Inspect `control.png` and `generated.png`, and when you're happy with the result, **commit
the `.webp`**. The web board picks it up automatically (Vite bundles
`src/assets/terrain/*.webp`); until an asset is committed, the board renders with flat tile
fills as before.

## Tuning the style

Everything that controls the look lives in [`profiles/antique.json`](profiles/antique.json),
shared by every map:

- `prompt` / `negativePrompt` / `seed` — locked text + seed for consistency.
- `styleReference` — the IP-Adapter reference image (your main style dial).
- `model`, `controlImageKey`, `styleImageKey`, `extraInput` — the fal.ai model id and its
  input shape. Confirm these against the chosen model's schema; the defaults target an SDXL
  ControlNet-union pipeline. (`prompt`, `negative_prompt`, `seed`, and `image_size` are
  standard across fal SDXL pipelines.)
- `outputSize` — image dimensions (matched to the board's viewBox aspect).

To restyle every map, tune one profile and regenerate. A second art style is a second profile.

## How the committed `rivers.webp` was generated

The shipped Rivers background was **not** produced by the `gen` CLI above. The SDXL
ControlNet-union path constrains edges/elevation, not regions, so it drew a hex grid and
never filled the sea as water. The asset was instead made with an **image-to-image** recipe
that carries the land/sea regions as colour, then restyles into antique watercolour — which
preserves the coastline layout. Folding this into the CLI is future work. The recipe, for
reproducibility (artifacts kept under [`terrain/rivers/`](../../terrain/rivers)):

1. **Base** (`base.png`): render the control mask with **land `#7e8c5a` (green), sea
   `#566f80` (blue)**, outside-the-map = land, then a light Gaussian blur (σ≈4) to round the
   hex corners into organic coastlines (a hard hex coastline makes the model hallucinate a
   grid). `control.png` is the underlying land/sea mask.
2. **Generate** (`generated.png`): `fal-ai/flux/dev/image-to-image` with the base as
   `image_url`, `strength: 0.92`, `guidance_scale: 3.5`, `num_inference_steps: 34`,
   `seed: 1568`, `enable_safety_checker: false`, and a prompt of muted green forested land /
   calm faded blue sea, vintage watercolour, top-down, no grid/horizon. Strength is the key
   dial: ≤0.85 barely changes the flat base; ≥0.95 reshapes the geography; **0.92** adds the
   antique texture while keeping the layout.
3. **Post**: resize to the board's viewBox aspect (1024×1164) and encode webp →
   `packages/web/src/assets/terrain/rivers.webp`.

> The control image was rendered headlessly with `sharp` + `jsdom` rather than Playwright,
> because the dev host lacks Chromium's system libraries.

## Adding terrain for a future map

1. Author the map's SVG (tile ids `#tileN`) and its `MapDefinition` (registered in the engine).
2. Add the map's SVG path to `SVG_BY_MAP` in [`src/mapSources.ts`](src/mapSources.ts).
3. `pnpm --filter @sengoku-jidai/terrain gen:control <mapId>` and check the control image.
4. `pnpm --filter @sengoku-jidai/terrain gen <mapId>` and review the result.
5. Commit `packages/web/src/assets/terrain/<mapId>.webp`. No per-map style work is needed.
