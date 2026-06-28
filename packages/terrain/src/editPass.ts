import { firstImageUrl, type FalClient, type FetchFn } from "./backend.js";

/** fal client + fetch, injected so tests run offline. */
export interface EditDeps {
  fal: FalClient;
  fetch: FetchFn;
}

/**
 * Render the final map with a multi-image instruction-edit model (e.g. nano-banana-pro/edit).
 * Two images are uploaded: the flat land/sea control (placement) and a style reference
 * (aesthetic). The model redraws the control's land/sea layout in the reference's hand-drawn
 * style, producing one cohesive antique map with a natural drawn coastline. `image_urls` is
 * ordered [control, style] and the prompt names each by role so the model never swaps them.
 */
export async function editMapPass(
  deps: EditDeps,
  args: {
    controlImage: Buffer;
    styleImage: Buffer;
    model: string;
    prompt: string;
    resolution: string;
    seed: number;
  }
): Promise<Buffer> {
  const [controlUrl, styleUrl] = await Promise.all([
    deps.fal.storage.upload(new Blob([new Uint8Array(args.controlImage)], { type: "image/png" })),
    deps.fal.storage.upload(new Blob([new Uint8Array(args.styleImage)], { type: "image/jpeg" }))
  ]);
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    image_urls: [controlUrl, styleUrl],
    num_images: 1,
    resolution: args.resolution,
    output_format: "png",
    seed: args.seed
  };
  const result = await deps.fal.subscribe(args.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`edit pass fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
