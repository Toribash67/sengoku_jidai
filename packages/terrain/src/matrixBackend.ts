import { firstImageUrl, type FalClient, type FetchFn } from "./backend.js";
import type { Candidate } from "./matrixProfile.js";

export interface CandidateInputDeps {
  /** fal storage URL of the uploaded colour base, shared by every candidate. */
  baseUrl: string;
}

/**
 * Build the fal `input` for one candidate. Pure — no network. Param names match the fal
 * endpoints verified in `profiles/README.md`. These are all image-to-image endpoints whose
 * output dims follow the input image, so no `image_size` is sent. The Flux and SDXL
 * endpoints take the full knob set (guidance_scale / num_inference_steps /
 * enable_safety_checker); sd35-large takes the same minus `enable_safety_checker`; Recraft
 * takes none of them (just prompt / image_url / strength / style).
 */
export function buildCandidateInput(
  c: Candidate,
  deps: CandidateInputDeps
): Record<string, unknown> {
  const fluxKnobs = {
    seed: c.seed,
    num_images: 1,
    guidance_scale: c.guidanceScale,
    num_inference_steps: c.numInferenceSteps,
    enable_safety_checker: c.enableSafetyChecker
  };
  switch (c.method) {
    case "flux-img2img":
      return {
        prompt: c.prompt,
        image_url: deps.baseUrl,
        strength: c.strength ?? 0.9,
        ...fluxKnobs
      };
    case "flux-controlnet-canny":
      return {
        prompt: c.prompt,
        image_url: deps.baseUrl,
        control_lora_image_url: deps.baseUrl,
        control_lora_strength: c.conditioningScale ?? 0.5,
        ...fluxKnobs
      };
    case "recraft-v3":
      return {
        prompt: c.prompt,
        image_url: deps.baseUrl,
        strength: c.strength ?? 0.5,
        style: c.style ?? "digital_illustration"
      };
    case "sdxl-map-lora":
      return {
        prompt: c.prompt,
        image_url: deps.baseUrl,
        strength: c.strength ?? 0.7,
        loras: c.loraUrl ? [{ path: c.loraUrl, scale: 1 }] : [],
        ...fluxKnobs
      };
    case "sd35-large":
      return {
        prompt: c.prompt,
        image_url: deps.baseUrl,
        strength: c.strength ?? 0.7,
        seed: c.seed,
        num_images: 1,
        guidance_scale: c.guidanceScale,
        num_inference_steps: c.numInferenceSteps
      };
  }
}

export interface FalDeps {
  fal: FalClient;
  fetch: FetchFn;
}

/** Run one candidate: subscribe to its model with the built input, fetch the result bytes. */
export async function generateCandidate(
  deps: FalDeps,
  args: { candidate: Candidate; baseUrl: string }
): Promise<Buffer> {
  const input = buildCandidateInput(args.candidate, { baseUrl: args.baseUrl });
  const result = await deps.fal.subscribe(args.candidate.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`candidate "${args.candidate.label}" fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
