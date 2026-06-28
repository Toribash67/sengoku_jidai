import { readFileSync } from "node:fs";
import { z } from "zod";

const StyleProfileSchema = z.object({
  /** fal.ai model/endpoint id. The pipeline targets an image-to-image endpoint. */
  model: z.string().min(1),
  /** Text prompt describing the terrain style (land/sea, antique tone, top-down). */
  prompt: z.string().min(1),
  /** Fixed seed for reproducible, consistent output across maps. */
  seed: z.number().int(),
  /**
   * Image-to-image denoise strength. The key dial: too low keeps the flat colour base
   * (no texture), too high reshapes the geography. ~0.92 adds antique texture while
   * preserving the land/sea layout.
   */
  strength: z.number().min(0).max(1).default(0.92),
  guidanceScale: z.number().default(3.5),
  numInferenceSteps: z.number().int().default(34),
  /** Land + outside-the-map fill in the colour base fed to img2img. */
  landColor: z.string().default("#7e8c5a"),
  /** Sea fill in the colour base. */
  seaColor: z.string().default("#566f80"),
  /** Gaussian blur applied to the colour base, rounding hex corners into organic coastlines
   *  (a hard hex coastline makes the model hallucinate a grid). 0 disables the blur. */
  blurSigma: z.number().min(0).default(4),
  /** fal's safety checker false-positives on these flat painterly bases, so it's off by default. */
  enableSafetyChecker: z.boolean().default(false),
  /** Final asset dimensions (matched to the board's viewBox aspect). */
  outputSize: z.object({ width: z.number().int(), height: z.number().int() }),
  webpQuality: z.number().int().min(1).max(100).default(82)
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;

/** Read and validate a style profile JSON file. Throws with a clear message on invalid input. */
export function loadStyleProfile(path: string): StyleProfile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = StyleProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid style profile at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}
