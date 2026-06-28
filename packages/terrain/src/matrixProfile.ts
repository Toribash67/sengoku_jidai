import { readFileSync } from "node:fs";
import { z } from "zod";

export const MethodSchema = z.enum([
  "flux-img2img",
  "flux-controlnet-canny",
  "recraft-v3",
  "sdxl-map-lora",
  "sd35-large"
]);
export type Method = z.infer<typeof MethodSchema>;

const CandidateSchema = z.object({
  /** Unique, filename-safe identifier; also the contact-sheet caption. */
  label: z.string().regex(/^[a-z0-9-]+$/, "label must be lowercase kebab-case"),
  method: MethodSchema,
  /** fal endpoint id for this candidate. */
  model: z.string().min(1),
  prompt: z.string().min(1),
  seed: z.number().int(),
  /** img2img / image-to-image denoise strength. */
  strength: z.number().min(0).max(1).optional(),
  /** ControlNet conditioning scale (how tightly the coastline is followed). */
  conditioningScale: z.number().min(0).max(2).optional(),
  /** LoRA weights URL (sdxl-map-lora). */
  loraUrl: z.string().url().optional(),
  /** Recraft style enum (recraft-v3), e.g. "digital_illustration". */
  style: z.string().optional(),
  guidanceScale: z.number().default(3.5),
  numInferenceSteps: z.number().int().default(34),
  enableSafetyChecker: z.boolean().default(false)
});
export type Candidate = z.infer<typeof CandidateSchema>;

const MatrixConfigSchema = z.object({
  /** Shared colour base + output dims fed to every candidate. */
  base: z.object({
    landColor: z.string(),
    seaColor: z.string(),
    blurSigma: z.number().min(0).default(4),
    outputSize: z.object({ width: z.number().int(), height: z.number().int() })
  }),
  /** Contact-sheet column count (rows group by method when ordered model-major). */
  columns: z.number().int().min(1).default(3),
  candidates: z
    .array(CandidateSchema)
    .min(1)
    .refine(
      (cs) => new Set(cs.map((c) => c.label)).size === cs.length,
      "candidate labels must be unique"
    )
});
export type MatrixConfig = z.infer<typeof MatrixConfigSchema>;

/** Read and validate a matrix config JSON file. Throws with a clear message on invalid input. */
export function loadMatrixConfig(path: string): MatrixConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = MatrixConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid matrix config at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}
