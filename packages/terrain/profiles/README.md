# Map profile

[`map.json`](map.json) is the single shared profile for terrain generation. One style is
applied to every map so backgrounds look like siblings.

## `base` — the land/sea control

- `landColor` / `seaColor`: fills painted into the control for land vs. sea (bold green/blue
  read most reliably to the edit model; they never appear in the final map).
- `outputSize.width`: control render width; height is derived from the board viewBox.
- `organicSigma`: blur that softens the hex facets of the land mask.
- `coastWarp`: domain-warps the coastline through a smooth noise field.
  - `amplitude`: max displacement in pixels (kept low so the background hugs the tile
    layout; `gen:map-control --amplitude` overrides it; 0 disables).
  - `scale`: noise base frequency (smaller = larger bays).
  - `seed`: noise seed.

## `edit` — the style pass

- `model`: the fal.ai multi-image edit endpoint (default `fal-ai/gpt-image-1.5/edit`).
- `styleRef`: optional path (relative to the package root) to the style reference image. When
  absent, generation is prompt-only (just the control image is sent).
- `quality`: gpt-image cost/quality tier — `low` / `medium` / `high`.
- `inputFidelity`: how strongly gpt-image preserves the control's structure — `low` / `high`
  (`high` keeps island placement).
- `prompt`: instructions mapping green→land and blue→sea in the reference's style.

The board's variable aspect is reconciled with gpt-image's fixed output sizes by padding the
control into the least-padding size and cropping the result back (see `gptImageAspect.ts`).

## `webpQuality`

Final webp quality (1–100).
