import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const MapProfileSchema = z.object({
  base: z.object({
    /** Control-image land/sea fills. Bold, distinct colours (green land / blue sea) read most
     *  reliably to the edit model; the control colour never appears in the final map. */
    landColor: z.string().default("#2e7d32"),
    seaColor: z.string().default("#1565c0"),
    /** Target output width; the height is derived from the board's viewBox so the background
     *  lines up with the UI and tiles are not distorted. */
    outputSize: z.object({ width: z.number().int() }),
    /** Blur-then-threshold sigma that softens the hex facets of the land mask. */
    organicSigma: z.number().min(0).default(6),
    /** What the area outside the tiles reads as. Custom maps default to "sea" so the tiled
     *  region becomes land/islands in an ocean; "land" suits a full-continent board (e.g. the
     *  hand-authored Rivers look), where only explicit sea tiles are water. */
    background: z.enum(["land", "sea"]).default("sea"),
    /** Domain-warps the land/sea boundary through a smooth noise vector field so hex edges
     *  bend into natural, connected coastlines. `amplitude` is the max displacement in pixels
     *  (kept low so the background hugs the tile layout — the override flag on gen:map-control
     *  can raise it); `scale` is the noise base frequency (smaller = larger bays). amplitude 0
     *  disables. */
    coastWarp: z
      .object({
        amplitude: z.number().min(0).default(30),
        scale: z.number().positive().default(0.003),
        seed: z.number().int().default(7)
      })
      .default({})
  }),
  /** Final render via a multi-image instruction-edit model: a flat land/sea control + a style
   *  reference image → the map redrawn in that style. `styleRef` is relative to the terrain
   *  package root. */
  edit: z.object({
    model: z.string().default("fal-ai/gpt-image-1.5/edit"),
    /** Optional style-reference image (relative to the terrain package root). Absent = prompt-only. */
    styleRef: z.string().optional(),
    /** gpt-image cost/quality tier. */
    quality: z.enum(["low", "medium", "high"]).default("high"),
    /** How strongly gpt-image preserves the control's structure. "high" keeps island placement. */
    inputFidelity: z.enum(["low", "high"]).default("high"),
    prompt: z.string().min(1)
  }),
  /** Second pass that draws a fort (Sengoku-era Japanese castle) at each fort tile. Skipped
   *  entirely for maps with no forts. Whole block defaults when omitted.
   *
   *  Two methods:
   *  - "inpaint" (default): a true hard-mask inpainting model (`model`, e.g. FLUX Fill) redraws
   *    ONLY each fort tile disc and preserves every other pixel exactly — no castle can leak onto
   *    a non-fort tile. Each fort is inpainted in its own pass. Uses `inpaintPrompt`,
   *    `maskRadiusFactor`.
   *  - "marker": the base edit model (gpt-image) with a magenta marker overlay and an optional
   *    soft mask. Localizes less reliably (the model recreates the whole frame) but reuses the
   *    base model. Uses `prompt`, `markerRadiusFactor`, `markerColor`, `maskRadiusFactor`. */
  fortPass: z
    .object({
      /** Which fort-drawing method to run (see block docs). */
      method: z.enum(["inpaint", "marker"]).default("inpaint"),
      /** Inpainting model id for method "inpaint" (single-image `image_url`+`mask_url` schema). */
      model: z.string().default("fal-ai/flux-pro/v1/fill"),
      /** Prompt for method "inpaint". No marker is drawn — the mask defines the region, so this
       *  describes only the castle and its style. Per-style profiles override it (e.g. ink). The
       *  default is tuned for the antique sepia look so it blends into the hand-drawn map. */
      inpaintPrompt: z
        .string()
        .default(
          "A tiny Sengoku-era Japanese castle keep with multiple tiered roofs, drawn ONLY as faded brown sepia-ink line-work on aged parchment, in the EXACT same muted antique hand-drawn cartography style as the surrounding mountains and forests: fine sepia hatching, thin brown ink lines, low contrast, weathered and monochrome sepia. Use the SAME faded brown ink colour as the rest of the map. NO bright white, NO blue, NO vivid or saturated colours, NO bold black cartoon outlines, no photo-realism, no shading blocks. A small flat top-down map symbol that blends seamlessly and unobtrusively into the old sepia map."
        ),
      /** Prompt for method "marker" (mentions the magenta marker the overlay draws). */
      prompt: z
        .string()
        .default(
          "Each bright magenta circle in this image marks the location of a fortress. At the exact centre of every magenta circle, draw one small Sengoku-era Japanese castle (a tenshukaku keep with white plaster walls and stacked tiered blue-grey tiled roofs) rendered in the SAME hand-drawn style, linework and colour palette as the rest of this map, sized to sit inside the circle without overflowing it. Then COMPLETELY REMOVE every magenta circle, blending its area back into the surrounding terrain. Leave every other part of the image — coastlines, land texture, sea, and colours — unchanged."
        ),
      markerRadiusFactor: z.number().positive().default(0.45),
      markerColor: z.string().default("#ff00ff"),
      /** Radius (× hex size) of the mask disc around each fort — the inpaint/edit region. Larger
       *  than the marker so the drawn castle has room inside it. */
      maskRadiusFactor: z.number().positive().default(0.7)
    })
    .default({}),
  webpQuality: z.number().int().min(1).max(100).default(82)
});

export type MapProfile = z.infer<typeof MapProfileSchema>;

/** Read and validate a map profile JSON file. Throws with a clear message on invalid input. */
export function loadMapProfile(path: string): MapProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Invalid map profile at ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const parsed = MapProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid map profile at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Committed profile file per style id. Ids mirror `TERRAIN_STYLES` in @sengoku-jidai/shared;
 *  the terrain package owns which JSON each id loads. */
const STYLE_PROFILE_FILES: Record<string, string> = {
  antique: "map.json",
  ink: "ink.json"
};

/** Resolve a terrain style id to its committed, validated profile. Paths resolve via
 *  `import.meta.url` so this works from source (tests) and from the built server's dist. */
export function loadStyleProfile(styleId: string): MapProfile {
  const file = STYLE_PROFILE_FILES[styleId];
  if (!file) {
    throw new Error(
      `unknown terrain style "${styleId}" (known: ${Object.keys(STYLE_PROFILE_FILES).join(", ")})`
    );
  }
  return loadMapProfile(fileURLToPath(new URL(`../profiles/${file}`, import.meta.url)));
}
