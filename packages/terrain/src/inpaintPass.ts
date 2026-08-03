import { firstImageUrl } from "./backend.js";
import type { EditDeps } from "./editPass.js";

/**
 * Run a true (hard-mask) inpainting model — e.g. `fal-ai/flux-pro/v1/fill` — that regenerates
 * ONLY the masked region and preserves every pixel outside it. Unlike gpt-image's soft mask
 * (`editMapPass`), the unmasked terrain is guaranteed untouched, so the fort castle cannot leak
 * onto other tiles. Single-image schema: `image_url` + `mask_url` + `prompt` (white = inpaint,
 * black = keep). Returns the generated PNG bytes.
 */
export async function inpaintPass(
  deps: EditDeps,
  args: { image: Buffer; mask: Buffer; model: string; prompt: string }
): Promise<Buffer> {
  const imageUrl = await deps.fal.storage.upload(
    new Blob([new Uint8Array(args.image)], { type: "image/png" })
  );
  const maskUrl = await deps.fal.storage.upload(
    new Blob([new Uint8Array(args.mask)], { type: "image/png" })
  );
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    image_url: imageUrl,
    mask_url: maskUrl,
    output_format: "png"
  };
  const result = await deps.fal.subscribe(args.model, { input });
  const url = firstImageUrl(result.data);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`inpaint pass fetch failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
