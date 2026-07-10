# Terrain Quality Fix — Texture-Only Reference (option #1)

**Date:** 2026-07-10
**Status:** design approved (approach chosen by Martin: "try #1 texture-only style ref"); refinement defaults chosen while AFK — see Decisions.

## Problem

Generated terrain for custom maps doesn't match the map. Root cause (debugged with evidence — see `memory/terrain-generation-quality.md` and the diagnosis artifact), two stacked faults:

- **A. Empty space is painted land.** `renderLandMask` treats the area outside the tiles as land (`backgroundColor:"#ffffff"`), so a map's blank ocean around islands reads as land. Only explicit *sea*-kind tiles become water.
- **B. The edit model ignores the control.** `fal-ai/nano-banana-pro/edit` is an instruction-edit model, not a structural conditioner. Handed a control map **and** a full-map style reference (`assets/style-ref.jpeg`), it reproduces the reference's composition and ignores the control's land/sea shapes. The generated output was near-identical to the style-ref.

## Approach (option #1 — cheapest, keep the one-call pipeline)

### Fix A — background defaults to sea
Make the land-mask background configurable via the profile and default it to **sea** for custom maps. Land tiles become islands in an ocean; explicit sea tiles stay sea. Rivers uses committed terrain and does not exercise this path.

- `MapProfile.base` gains `background: "land" | "sea"` (default `"sea"`).
- `renderLandMask` takes `background` and passes `backgroundColor` = `#000000` (sea) or `#ffffff` (land) into `prepBoardSvgMarkup`. `tileColorMap(map, "#ffffff", "#000000")` is unchanged (land tiles white, sea tiles black).
- `generateTerrainWebp` threads `profile.base.background` into `renderLandMask`.

### Fix B — texture-only reference
Replace the full-map style reference with a **texture swatch** that has no map composition to copy: a vertical two-band image — top band = land ink-hatching, bottom band = scalloped-wave water — both cropped from the existing `style-ref.jpeg` so the antique aesthetic is preserved.

- New committed asset `packages/terrain/assets/texture-ref.jpeg` (pre-composed swatch, ~512×608).
- `profile.edit.styleRef` → `assets/texture-ref.jpeg`.
- Prompt reworked: image 2 is a **texture legend, not a map** — top half is the land drawing style, bottom half is the water style; redraw image 1 (the control) keeping its **exact** green/blue shapes, filling green with the land texture and blue with the water texture.
- `style-ref.jpeg` is kept in the repo (may be reused if we escalate to option #3 / ControlNet).
- **Escalation if the model conflates the two bands:** send land and sea as two separate `image_urls` with a role-naming prompt (small follow-up; not built now).

## Non-goals
- No server/web/API changes. `TerrainService` keeps calling `generateTerrainWebp` with the default profile; the profile change flows through.
- No editor terrain preview here — that is a separate spec after this lands.
- No per-map land/sea-background toggle (see Decisions).

## Decisions (chosen while Martin AFK; confirm on return)
- **Empty space = always sea** (not a per-map toggle). Matches the "islands" intent, no new editor UI/storage (YAGNI). A continent map fills its area with land tiles.
- **Credit handling:** all non-model work is verified offline (zero credits): the new control image (islands-in-sea) and the swatch are rendered and eyeballed. The real fal generation (≤1–2 runs) is **held for Martin** — he runs it from the app, or blesses the assistant running one on the deploy key.

## Testing
- Unit-test `renderLandMask` / control with `background:"sea"` on a small sample map: the control is **sea-dominant with isolated land islands** (assert land-pixel fraction is low and > 0), and with `background:"land"` stays land-dominant (guards the Rivers-style path). Deterministic, offline.
- The fal call stays behind the injected fake client in existing tests; the prompt/asset change is validated only by the real generations.
- Full gate (build/typecheck/test/lint/prettier) green; the terrain package builds to dist (server consumes dist).

## Validation plan
1. Offline: render the new control for `Small Testmap` (confirm islands-in-sea, islands survive warp/blur) + confirm the swatch. Zero credits. Show Martin.
2. ≤1–2 real generations to confirm the model now follows the layout.
3. If it still drifts → fall back to option #2 (deterministic composite); the mask/control work here is reused.

## Files
| File | Change |
|---|---|
| `packages/terrain/src/mapProfile.ts` | add `base.background` enum (default `"sea"`) |
| `packages/terrain/src/masks.ts` | `renderLandMask` takes `background`, flips `backgroundColor` |
| `packages/terrain/src/mapPipeline.ts` | thread `profile.base.background` into `renderLandMask` |
| `packages/terrain/profiles/map.json` | `styleRef` → texture-ref; reworked prompt; `base.background:"sea"` |
| `packages/terrain/assets/texture-ref.jpeg` | new committed swatch (land band / wave band) |
| `packages/terrain/test/*` | control background unit test |
