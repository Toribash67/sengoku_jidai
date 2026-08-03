import { firstImageUrl, type FalClient, type FetchFn } from "./backend.js";

/** fal client + fetch, injected so tests run offline. */
export interface EditDeps {
  fal: FalClient;
  fetch: FetchFn;
}

/**
 * Render the final map with a multi-image instruction-edit model (gpt-image-1.5/edit). One or
 * two images are uploaded: the flat land/sea control (placement, always present) and an
 * optional style reference (aesthetic). The model redraws the control's land/sea layout in the
 * reference's hand-drawn style (or from the prompt alone when no style image is given),
 * producing one cohesive antique map with a natural drawn coastline. `image_urls` is ordered
 * [control, style] and the prompt names each by role so the model never swaps them.
 */
export async function editMapPass(
  deps: EditDeps,
  args: {
    controlImage: Buffer;
    styleImage: Buffer | null;
    /** Optional gpt-image edit mask (RGBA): transparent = editable, opaque = kept. When present,
     *  uploaded and passed as `mask_image_url` to localize the edit (see fortMaskImage). */
    maskImage?: Buffer | null;
    model: string;
    prompt: string;
    imageSize: string;
    quality: string;
    inputFidelity: string;
  }
): Promise<Buffer> {
  const controlUrl = await deps.fal.storage.upload(
    new Blob([new Uint8Array(args.controlImage)], { type: "image/png" })
  );
  const image_urls = [controlUrl];
  if (args.styleImage) {
    const styleUrl = await deps.fal.storage.upload(
      new Blob([new Uint8Array(args.styleImage)], { type: "image/jpeg" })
    );
    image_urls.push(styleUrl);
  }
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    image_urls,
    num_images: 1,
    image_size: args.imageSize,
    quality: args.quality,
    input_fidelity: args.inputFidelity,
    output_format: "png"
  };
  if (args.maskImage) {
    input.mask_image_url = await deps.fal.storage.upload(
      new Blob([new Uint8Array(args.maskImage)], { type: "image/png" })
    );
  }
  const result = await deps.fal.subscribe(args.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`edit pass fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
