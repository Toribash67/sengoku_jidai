# Terrain Background Layer — Design

**Date:** 2026-06-27
**Status:** Approved (brainstorm) — pending spec review

## Problem

The board (`cloned_map.svg`) is clean and playable but not thematic. We want a
faded, antique-style terrain image *behind* the vector graphics. Land vs. sea is
meaningful game data, so the generated coastlines must follow the hex land/sea
topology almost exactly (near, not pixel-perfect). The solution must:

- Work for the current **Rivers** map now.
- Generalize to any future map (each map supplies its own SVG + `MapDefinition`).
- Produce backgrounds whose art style is **broadly consistent** across maps.

## Decisions (from brainstorming)

1. **Offline asset pipeline.** Generation runs on the developer's machine; the
   resulting image is committed as a static asset. No GPU/API at runtime or in CI.
2. **Hosted generation API** (no local GPU). Backend kept swappable behind an
   interface; first target **fal.ai**, with **Replicate** as a documented drop-in.
3. **Control image encodes land/sea only** to start (harbors/HQs remain SVG vector
   icons on top). Extra classes can come later.
4. **Style consistency** via a committed **style profile**: locked prompt + seed +
   a **style reference image** fed through IP-Adapter.
5. **Control image is rendered from the existing SVG via Playwright** (already a
   dependency) — guarantees the control coastline is pixel-identical to the board,
   so the generated terrain aligns behind the vectors by construction.

## Architecture

A new **dev-only workspace package `@sengoku-jidai/terrain`** (not shipped in the
app or Docker image) exposes a CLI: `pnpm terrain:gen <mapId>`.

```
MapDefinition (kind per tile)  ┐
                               ├─▶ [1] control-image renderer (Playwright)
map SVG (#tileN geometry)      ┘         → control.png  (land=white, sea=black, exact coastline)
                                                │
style profile (committed) ──────────────────────┤  prompt + seed + IP-Adapter ref + model/strength
                                                ▼
                                  [2] generation client (hosted API)
                                       SDXL + ControlNet(coastline) + IP-Adapter(style ref)
                                                │
                                                ▼
                                  [3] post: crop/resize → webp
                                       → packages/web/src/assets/terrain/<mapId>.webp  (committed)
                                                │
                                                ▼
                                  [4] web: <image> as bottom layer of the board SVG
```

Stages 1–3 are the offline pipeline (developer machine, API key in `.env`).
Stage 4 is the only runtime change.

### Key invariant

**Coastline fidelity** comes from the control image + ControlNet. **Style
consistency** comes from the shared style profile + IP-Adapter. The two are
decoupled, so tuning one does not disturb the other.

## Components

### 1. Control-image renderer (stage 1)

- A minimal HTML harness injects the target map's SVG into a Playwright page and
  runs a stripped-down decorator:
  - For each tile id present in that map's `MapDefinition`, set fill to **white if
    `kind === "land"`, black if `kind === "sea"`.**
  - Paint the area **outside** the tiles black, so the landmasses read as an island
    cluster in open ocean and outer coastlines render correctly.
  - Hide all other layers (units, HQ/harbor/star/bonus icons, overlays, grid).
- Screenshot at a fixed, aspect-matched resolution. ViewBox ratio ≈
  1133.86 / 1288.16 ≈ 0.88 → **1024 × 1152** (an SDXL-friendly bucket).
- Output `control.png`.
- **General interface:** the renderer takes `(svgPath, mapDefinition)`. Both are
  keyed by tile id (`#tileN` ↔ `MapDefinition.areas[tileN]`), so any future map
  works by supplying its own SVG and registry entry. Land/sea truth is read from
  the engine (`getMap(mapId)`), never re-authored here.

### 2. Style profile (committed config)

One file per *style*, shared by **all** maps:

- `prompt` / `negativePrompt` (antique cartography, faded parchment, muted terrain)
- `seed` (fixed)
- `styleReference` → committed reference image, fed via **IP-Adapter** (the main
  style dial)
- `model` id, `controlnetStrength`, `ipAdapterWeight`, `denoise`, `outputSize`

Regenerating a map changes nothing per-map; restyling everything tunes one profile.
A future second style = a second profile file.

### 3. Generation client (stages 2–3)

Backend-agnostic adapter:

```ts
interface TerrainBackend {
  generate(control: Buffer, profile: StyleProfile): Promise<Buffer>; // returns PNG
}
```

- First implementation: **fal.ai** (typed JS client, SDXL + ControlNet +
  IP-Adapter). **Replicate** documented as a drop-in; switching backends is a
  config change.
- **Conditioning modality:** feed `control.png` to a **soft-edge/Canny ControlNet**
  so the single strong land↔sea boundary pins the coastline crisply; optionally
  also pass the 2-tone image as a low-strength **img2img init** to bias land vs.
  water texture. Both are profile knobs, not hardcoded.
- API key via `.env` (e.g. `FAL_KEY`), never committed; documented in `.env.example`.
- Stage 3 crops/resizes and encodes **webp** via `sharp`, writing
  `packages/web/src/assets/terrain/<mapId>.webp` (same convention as optimized card
  assets — Vite bundles it; no Dockerfile change). Full-res source output and the
  intermediate `control.png` may be committed under a top-level `terrain/<mapId>/`
  directory (mirrors `cards/` holding source scans).

### 4. Web integration (stage 4)

In `MapBoard`, after the SVG is injected:

- Insert an `<image>` as the **first child** of the `<svg>` (bottom of paint order),
  sized to the viewBox with `preserveAspectRatio="xMidYMid slice"`, `href` = the
  imported terrain asset for the active map.
- Change base tile fills: **unowned/supplied tiles get a transparent (or very
  low-opacity) fill** instead of `TILE_LAND_FILL` / `TILE_SEA_FILL`, so terrain
  shows through; the hex **stroke grid stays on top** for readability.
- **Unaffected:** supply tints, source/target highlights, unit stacks, and
  selection outlines all still paint above the terrain exactly as today (the
  existing layer ordering in `MapBoard` is preserved).
- **Optional asset:** if a map has no committed terrain, `MapBoard` skips the
  `<image>` and falls back to today's flat fills.

## Error handling

- Pipeline CLI fails fast with clear messages on: unknown `mapId`, missing API key,
  missing style profile or reference image, backend/HTTP errors (surface status +
  body). Generation is interactive/curated, so no automatic retry policy beyond a
  simple bounded retry on transient HTTP failures.
- Web: missing terrain asset is a non-error (graceful fallback, see stage 4).

## Testing

- **Control-image renderer:** unit-test the tile→color mapping (land=white,
  sea=black) against `riversMap`; assert every `MapDefinition` tile id resolves to
  an SVG element (mirrors `MapBoard`'s existing "no element for area" guard).
  Optionally snapshot `control.png` dimensions.
- **Generation client:** test the adapter against a mocked backend (no network in
  tests); assert the control image + profile fields are passed through and the
  result is webp-encoded at the expected size. No live API calls in CI.
- **Web integration:** `MapBoard` test asserting the `<image>` is inserted as the
  first SVG child when a terrain asset is present, and absent (with flat-fill
  fallback) when it isn't. Coastline *visual* quality is verified by eye on the
  generated asset (curated before commit) and via the existing Browser Smoke Test;
  there is no local browser verification.

## Out of scope (future)

- Harbor/HQ/coastline-emphasis control classes (richer control image).
- Multiple style profiles / map-specific style overrides.
- Local-GPU backend (ComfyUI/diffusers) — the swappable interface leaves room.
- Custom LoRA training.

## General-map checklist (adding terrain to a future map)

1. Author the map's SVG (tile ids `#tileN`) and its `MapDefinition` (registered).
2. `pnpm terrain:gen <mapId>` → review `control.png` and the generated terrain.
3. Commit the optimized `src/assets/terrain/<mapId>.webp`.
4. `MapBoard` wires the asset by map id; no per-map style work needed.
