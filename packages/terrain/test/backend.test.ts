import { describe, expect, it, vi } from "vitest";
import { createFalBackend } from "../src/backend.js";
import type { StyleProfile } from "../src/styleProfile.js";

const profile: StyleProfile = {
  model: "fal-ai/test-i2i",
  prompt: "antique map",
  seed: 42,
  strength: 0.92,
  guidanceScale: 3.5,
  numInferenceSteps: 34,
  landColor: "#7e8c5a",
  seaColor: "#566f80",
  blurSigma: 4,
  enableSafetyChecker: false,
  outputSize: { width: 1024, height: 1164 },
  webpQuality: 82
};

describe("createFalBackend", () => {
  it("uploads the base, calls the model with the assembled input, and returns the result bytes", async () => {
    const fal = {
      storage: { upload: vi.fn(async () => "https://up/base.png") },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/result.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("PNGBYTES").buffer
    }));

    const backend = createFalBackend({ fal, fetch });
    const out = await backend.generate({ base: Buffer.from("base"), profile });

    // One upload (the colour base).
    expect(fal.storage.upload).toHaveBeenCalledTimes(1);
    // Model + assembled img2img input.
    const [model, opts] = fal.subscribe.mock.calls[0]!; // non-null: asserted via the result below
    expect(model).toBe("fal-ai/test-i2i");
    expect(opts.input).toMatchObject({
      prompt: "antique map",
      image_url: "https://up/base.png",
      strength: 0.92,
      guidance_scale: 3.5,
      num_inference_steps: 34,
      seed: 42,
      enable_safety_checker: false,
      image_size: { width: 1024, height: 1164 }
    });
    // Result bytes are the fetched image.
    expect(fetch).toHaveBeenCalledWith("https://out/result.png");
    expect(out.toString()).toBe("PNGBYTES");
  });

  it("throws when the result image fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn(async () => "https://up/x.png") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/r.png" }] } }))
    };
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0)
    }));
    const backend = createFalBackend({ fal, fetch });
    await expect(backend.generate({ base: Buffer.from("b"), profile })).rejects.toThrow(/500/);
  });
});
