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

## Verified fal endpoints (matrix)

Verified 2026-06-28 by fetching fal.ai model pages and OpenAPI schemas directly.
Fields marked **UNVERIFIED** could not be confirmed from the live schema/docs.

| method tag              | endpoint id                                        | source/control image param                                                  | strength/conditioning param                                                      | extras                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flux-img2img`          | `fal-ai/flux/dev/image-to-image`                   | `image_url`                                                                 | `strength` (0.01–1.0, default 0.95)                                              | No `image_size` param — output dims follow input image                                                                                                                                                                                                                                                                                                                       |
| `flux-controlnet-canny` | `fal-ai/flux-control-lora-canny/image-to-image`    | `control_lora_image_url` (canny edge control); `image_url` (i2i base image) | `control_lora_strength` (float, default 1); `strength` (i2i blend, default 0.85) | Both a base img and a canny control img are accepted; original candidate `fal-ai/flux-controlnet-canny` returned 404                                                                                                                                                                                                                                                         |
| `recraft-v3`            | `fal-ai/recraft/v3/image-to-image`                 | `image_url`                                                                 | `strength` (0–1, default 0.5)                                                    | `style` field accepted (string enum, e.g. `"realistic_image"`); `style_id` for custom styles; original candidate `fal-ai/recraft-v3/image-to-image` returned 404                                                                                                                                                                                                             |
| `sdxl-map-lora`         | `fal-ai/fast-sdxl/image-to-image`                  | `image_url`                                                                 | `strength` (0.05–1.0, default 0.95)                                              | `loras` array shape: `[{ path: string, scale?: number (0–1, default 1), force?: boolean }]`; chosen LoRA URL: `https://civitai.com/api/download/models/427437` (Fantasy Map – Heavy, SDXL 1.0, trigger word: `fantasy map`) — **UNVERIFIED** (URL resolves on civitai; fal.ai accepts civitai download URLs per docs, but this specific URL has not been test-called on fal) |
| `sd35-large`            | `fal-ai/stable-diffusion-v35-large/image-to-image` | `image_url`                                                                 | `strength` (0.01–1.0, default 0.83)                                              | Also accepts `controlnet`, `loras`, `ip_adapter` objects                                                                                                                                                                                                                                                                                                                     |

### Notes

- `fal-ai/flux-controlnet-canny` (the originally guessed canny endpoint) returned HTTP 404.
  The confirmed i2i canny endpoint is `fal-ai/flux-control-lora-canny/image-to-image`.
  A pure-canny text-to-image variant also exists at `fal-ai/flux-lora-canny` (takes `image_url`
  as the canny source, no explicit conditioning-scale param).
- `fal-ai/recraft-v3/image-to-image` (the originally guessed Recraft endpoint) returned HTTP 404.
  The confirmed path is `fal-ai/recraft/v3/image-to-image`.
- The `flux-img2img` baseline (`fal-ai/flux/dev/image-to-image`) schema does **not** include an
  `image_size` parameter — output dimensions follow the input image.
- LoRA URL for `sdxl-map-lora`: `https://civitai.com/api/download/models/427437`
  (civitai model 382959 "Fantasy Map – Heavy", safetensors, ~218 MB, SDXL 1.0).
  Marked **UNVERIFIED** because no live fal.ai call was made to confirm it loads.
  Confidence: medium — civitai download URLs are documented as supported by fal.ai fast-sdxl.
