import { firstImageUrl, type FalClient, type FetchFn } from "./backend.js";

export interface TextureDeps {
  fal: FalClient;
  fetch: FetchFn;
}

/**
 * Generate one full-frame, unconstrained texture via a fal text-to-image endpoint. The
 * model never sees the coastline (no init image), so there are no boundary artifacts — the
 * texture is clipped to the land/sea mask afterward in compositeMap.
 */
export async function generateTexture(
  deps: TextureDeps,
  args: {
    model: string;
    prompt: string;
    seed: number;
    width: number;
    height: number;
    guidanceScale: number;
    numInferenceSteps: number;
  }
): Promise<Buffer> {
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    seed: args.seed,
    num_images: 1,
    guidance_scale: args.guidanceScale,
    num_inference_steps: args.numInferenceSteps,
    enable_safety_checker: false,
    image_size: { width: args.width, height: args.height }
  };
  const result = await deps.fal.subscribe(args.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`texture fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
