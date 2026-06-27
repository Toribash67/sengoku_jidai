import { describe, expect, it, vi } from "vitest";
import { createFalBackend } from "../src/backend.js";
import type { StyleProfile } from "../src/styleProfile.js";

const profile: StyleProfile = {
  model: "fal-ai/test-model",
  prompt: "antique map",
  negativePrompt: "modern",
  seed: 42,
  styleReference: "ref.png",
  styleReferencePath: "/abs/ref.png",
  controlImageKey: "control_image_url",
  styleImageKey: "ip_adapter_image_url",
  extraInput: { controlnet_conditioning_scale: 0.85 },
  outputSize: { width: 1024, height: 1160 },
  webpQuality: 82
};

describe("createFalBackend", () => {
  it("uploads images, calls the model with the assembled input, and returns the result bytes", async () => {
    const uploads: Blob[] = [];
    const fal = {
      storage: {
        upload: vi.fn(async (blob: Blob) => {
          uploads.push(blob);
          return uploads.length === 1 ? "https://up/control.png" : "https://up/ref.png";
        })
      },
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
    const out = await backend.generate({
      control: Buffer.from("control"),
      styleReference: Buffer.from("ref"),
      profile
    });

    // Two uploads (control, then style reference).
    expect(fal.storage.upload).toHaveBeenCalledTimes(2);
    // Model + assembled input.
    const [model, opts] = fal.subscribe.mock.calls[0]!; // non-null: asserted called above
    expect(model).toBe("fal-ai/test-model");
    expect(opts.input).toMatchObject({
      prompt: "antique map",
      negative_prompt: "modern",
      seed: 42,
      control_image_url: "https://up/control.png",
      ip_adapter_image_url: "https://up/ref.png",
      controlnet_conditioning_scale: 0.85,
      image_size: { width: 1024, height: 1160 }
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
    await expect(
      backend.generate({ control: Buffer.from("c"), styleReference: Buffer.from("r"), profile })
    ).rejects.toThrow(/500/);
  });
});
