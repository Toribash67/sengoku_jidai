import { describe, expect, it, vi } from "vitest";
import { inpaintPass } from "../src/inpaintPass.js";

describe("inpaintPass", () => {
  it("uploads image + mask and calls the fill model with image_url/mask_url/prompt", async () => {
    const upload = vi
      .fn<(blob: Blob) => Promise<string>>()
      .mockResolvedValueOnce("https://up/image.png")
      .mockResolvedValueOnce("https://up/mask.png");
    const fal = {
      storage: { upload },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/filled.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("FILLBYTES").buffer
    }));

    const out = await inpaintPass(
      { fal, fetch },
      {
        image: Buffer.from("base"),
        mask: Buffer.from("mask"),
        model: "fal-ai/flux-pro/v1/fill",
        prompt: "a Japanese castle"
      }
    );

    expect(upload).toHaveBeenCalledTimes(2); // image + mask
    const [model, opts] = fal.subscribe.mock.calls[0]!;
    expect(model).toBe("fal-ai/flux-pro/v1/fill");
    expect(opts.input).toMatchObject({
      prompt: "a Japanese castle",
      image_url: "https://up/image.png",
      mask_url: "https://up/mask.png",
      output_format: "png"
    });
    // Single-image schema: no gpt-image image_urls array.
    expect(opts.input).not.toHaveProperty("image_urls");
    expect(fetch).toHaveBeenCalledWith("https://out/filled.png");
    expect(out.toString()).toBe("FILLBYTES");
  });

  it("throws when the result fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn(async () => "https://up/x") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/x.png" }] } }))
    };
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0)
    }));
    await expect(
      inpaintPass(
        { fal, fetch },
        { image: Buffer.from("i"), mask: Buffer.from("m"), model: "m", prompt: "p" }
      )
    ).rejects.toThrow(/500/);
  });
});
