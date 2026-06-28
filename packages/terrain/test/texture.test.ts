import { describe, expect, it, vi } from "vitest";
import { generateTexture } from "../src/texture.js";

describe("generateTexture", () => {
  it("calls the t2i model with image_size and no image_url, returns the fetched bytes", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/land.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("LANDBYTES").buffer
    }));

    const out = await generateTexture(
      { fal, fetch },
      {
        model: "fal-ai/flux/dev",
        prompt: "antique parchment landmass",
        seed: 1568,
        width: 1024,
        height: 1164,
        guidanceScale: 3.5,
        numInferenceSteps: 34
      }
    );

    expect(fal.storage.upload).not.toHaveBeenCalled(); // t2i: nothing uploaded
    const [model, opts] = fal.subscribe.mock.calls[0]!;
    expect(model).toBe("fal-ai/flux/dev");
    expect(opts.input).toMatchObject({
      prompt: "antique parchment landmass",
      seed: 1568,
      num_images: 1,
      guidance_scale: 3.5,
      num_inference_steps: 34,
      enable_safety_checker: false,
      image_size: { width: 1024, height: 1164 }
    });
    expect(opts.input).not.toHaveProperty("image_url");
    expect(fetch).toHaveBeenCalledWith("https://out/land.png");
    expect(out.toString()).toBe("LANDBYTES");
  });

  it("throws when the image fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/x.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0)
    }));
    await expect(
      generateTexture(
        { fal, fetch },
        {
          model: "m",
          prompt: "p",
          seed: 1,
          width: 8,
          height: 8,
          guidanceScale: 3.5,
          numInferenceSteps: 34
        }
      )
    ).rejects.toThrow(/500/);
  });
});
