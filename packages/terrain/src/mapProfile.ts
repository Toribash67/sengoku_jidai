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
