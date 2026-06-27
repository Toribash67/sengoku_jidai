# Style profiles

Each profile defines one shared art style, applied to every map so backgrounds
look like siblings. `antique.json` is the default.

## Required: a style reference image

`styleReference` points at an image (e.g. `antique-reference.png`) fed to the
model via IP-Adapter — it is the main style dial. **You must add this image**
before running the pipeline; it is curated art, not generated here. Recommended:
a single representative antique-map crop, ~1024px. Commit it alongside the profile.

## Tuning

- `prompt` / `negativePrompt` / `seed`: locked text + seed for consistency.
- `extraInput`: model-specific knobs (ControlNet strength, steps, IP-Adapter weight).
- `model` / `controlImageKey` / `styleImageKey`: confirm these against the chosen
  fal.ai model's input schema; defaults target an SDXL ControlNet-union pipeline.
