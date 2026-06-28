# Style profiles

Each profile defines one shared art style, applied to every map so backgrounds
look like siblings. `antique.json` is the default. No reference image is needed —
the regions and style come entirely from the colour base and the prompt.

## Tuning

- `prompt` / `seed`: locked text + seed for consistency.
- `strength`: image-to-image denoise. The key dial — too low keeps the flat colour
  base (no texture), too high reshapes the geography; ~0.92 adds antique texture
  while preserving the land/sea layout.
- `landColor` / `seaColor`: the colours painted into the base for land vs. sea. They
  carry the regions into the result, so the model knows where water goes.
- `blurSigma`: Gaussian blur on the base — rounds the hex corners into organic
  coastlines (a hard hex coastline makes the model draw a grid).
- `model`: the fal.ai image-to-image endpoint (default `fal-ai/flux/dev/image-to-image`).
- `guidanceScale` / `numInferenceSteps` / `enableSafetyChecker`: standard model knobs.
  Safety is off by default because fal's checker false-positives on these flat bases.
- `outputSize` / `webpQuality`: final asset dimensions (matched to the board viewBox
  aspect) and webp quality.
