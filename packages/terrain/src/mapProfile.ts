import { readFileSync } from "node:fs";
import { z } from "zod";

const RegionSchema = z.object({ prompt: z.string().min(1), seed: z.number().int() });

const MapProfileSchema = z.object({
  base: z.object({
    /** fal text-to-image endpoint id used for both region textures. */
    model: z.string().min(1),
    landColor: z.string().default("#7e8c5a"),
    seaColor: z.string().default("#566f80"),
    outputSize: z.object({ width: z.number().int(), height: z.number().int() }),
    /** Blur-then-threshold sigma that rounds hex facets into organic coastline. */
    organicSigma: z.number().min(0).default(2),
    inkColor: z.string().default("#3a2f23"),
    strokeWidth: z.number().min(1).default(2)
  }),
  land: RegionSchema,
  sea: RegionSchema,
  guidanceScale: z.number().default(3.5),
  numInferenceSteps: z.number().int().default(34),
  harmonize: z.object({
    saturation: z.number().min(0).default(0.6),
    brightness: z.number().min(0).default(0.96),
    parchmentTint: z.string().default("#d8c8a8"),
    vignette: z.boolean().default(true)
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
