import type { StyleProfile } from "./styleProfile.js";

export interface TerrainBackend {
  generate(args: { control: Buffer; styleReference: Buffer; profile: StyleProfile }): Promise<Buffer>;
}

export interface FalClient {
  storage: { upload(blob: Blob): Promise<string> };
  subscribe(model: string, opts: { input: Record<string, unknown> }): Promise<{ data: unknown }>;
}

export type FetchFn = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Pull the first output image URL out of a fal result payload (`{ images: [{ url }] }`). */
function firstImageUrl(data: unknown): string {
  const images = (data as { images?: Array<{ url?: string }> })?.images;
  const url = images?.[0]?.url;
  if (!url) {
    throw new Error(`fal result had no image url: ${JSON.stringify(data)}`);
  }
  return url;
}

/** fal.ai-backed terrain generator. `fal` and `fetch` are injected so tests stay offline. */
export function createFalBackend(deps: { fal: FalClient; fetch: FetchFn }): TerrainBackend {
  const { fal, fetch } = deps;
  return {
    async generate({ control, styleReference, profile }) {
      const controlUrl = await fal.storage.upload(new Blob([control], { type: "image/png" }));
      const styleUrl = await fal.storage.upload(new Blob([styleReference], { type: "image/png" }));

      const input: Record<string, unknown> = {
        ...profile.extraInput,
        prompt: profile.prompt,
        negative_prompt: profile.negativePrompt,
        seed: profile.seed,
        image_size: { width: profile.outputSize.width, height: profile.outputSize.height },
        [profile.controlImageKey]: controlUrl,
        [profile.styleImageKey]: styleUrl
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
