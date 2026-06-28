import type { StyleProfile } from "./styleProfile.js";

export interface TerrainBackend {
  generate(args: { base: Buffer; profile: StyleProfile }): Promise<Buffer>;
}

export interface FalClient {
  storage: { upload(blob: Blob): Promise<string> };
  subscribe(model: string, opts: { input: Record<string, unknown> }): Promise<{ data: unknown }>;
}

export type FetchFn = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Pull the first output image URL out of a fal result payload (`{ images: [{ url }] }`). */
export function firstImageUrl(data: unknown): string {
  const images = (data as { images?: Array<{ url?: string }> })?.images;
  const url = images?.[0]?.url;
  if (!url) {
    throw new Error(`fal result had no image url: ${JSON.stringify(data)}`);
  }
  return url;
}

/**
 * fal.ai image-to-image terrain generator. Uploads the colour base and runs it through the
 * profile's img2img model, so the land/sea regions in the base carry into the result while the
 * prompt restyles it. `fal` and `fetch` are injected so tests stay offline.
 */
export function createFalBackend(deps: { fal: FalClient; fetch: FetchFn }): TerrainBackend {
  const { fal, fetch } = deps;
  return {
    async generate({ base, profile }) {
      const imageUrl = await fal.storage.upload(
        new Blob([new Uint8Array(base)], { type: "image/png" })
      );

      const input: Record<string, unknown> = {
        prompt: profile.prompt,
        image_url: imageUrl,
        strength: profile.strength,
        guidance_scale: profile.guidanceScale,
        num_inference_steps: profile.numInferenceSteps,
        seed: profile.seed,
        num_images: 1,
        enable_safety_checker: profile.enableSafetyChecker,
        image_size: { width: profile.outputSize.width, height: profile.outputSize.height }
      };

      const result = await fal.subscribe(profile.model, { input });
      const url = firstImageUrl(result.data);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`fetching generated image failed: ${response.status} ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }
  };
}
