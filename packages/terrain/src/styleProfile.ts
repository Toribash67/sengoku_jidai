import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const StyleProfileSchema = z.object({
  /** fal.ai model/endpoint id (an SDXL ControlNet + IP-Adapter pipeline). */
  model: z.string().min(1),
  prompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  seed: z.number().int(),
  /** Style reference image path, relative to the profile file (fed via IP-Adapter). */
  styleReference: z.string().min(1),
  /** Input key the chosen fal model expects for the ControlNet image URL. */
  controlImageKey: z.string().default("control_image_url"),
  /** Input key the chosen fal model expects for the IP-Adapter/style image URL. */
  styleImageKey: z.string().default("ip_adapter_image_url"),
  /** Any additional static input the model takes (strengths, steps, etc.). */
  extraInput: z.record(z.unknown()).default({}),
  outputSize: z.object({ width: z.number().int(), height: z.number().int() }),
  webpQuality: z.number().int().min(1).max(100).default(82)
});

export type StyleProfile = z.infer<typeof StyleProfileSchema> & {
  /** Absolute path to the style reference image, resolved from `styleReference`. */
  styleReferencePath: string;
};

/** Read and validate a style profile JSON file. Throws with a clear message on invalid input. */
export function loadStyleProfile(path: string): StyleProfile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = StyleProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid style profile at ${path}: ${parsed.error.message}`);
  }
  return {
    ...parsed.data,
    styleReferencePath: resolve(dirname(path), parsed.data.styleReference)
  };
}
