import { describe, expect, it, vi } from "vitest";
import { editMapPass } from "../src/editPass.js";

describe("editMapPass", () => {
  it("uploads control + style, calls the edit model with both image_urls, returns bytes", async () => {
    const upload = vi
      .fn<(blob: Blob) => Promise<string>>()
      .mockResolvedValueOnce("https://up/control.png")
      .mockResolvedValueOnce("https://up/style.jpeg");
    const fal = {
      storage: { upload },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/map.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("MAPBYTES").buffer
    }));

    const out = await editMapPass(
      { fal, fetch },
      {
        controlImage: Buffer.from("control"),
        styleImage: Buffer.from("style"),
        model: "fal-ai/gpt-image-1.5/edit",
        prompt: "grey is land, blue is sea",
        imageSize: "1024x1024",
        quality: "high",
        inputFidelity: "high"
      }
    );

    expect(upload).toHaveBeenCalledTimes(2); // control + style reference
    const [model, opts] = fal.subscribe.mock.calls[0]!;
    expect(model).toBe("fal-ai/gpt-image-1.5/edit");
    expect(opts.input).toMatchObject({
      prompt: expect.any(String),
      image_urls: [expect.any(String), expect.any(String)],
      num_images: 1,
      image_size: "1024x1024",
      quality: "high",
      input_fidelity: "high",
      output_format: "png"
    });
    expect(opts.input).not.toHaveProperty("resolution");
    expect(opts.input).not.toHaveProperty("seed");
    expect(fetch).toHaveBeenCalledWith("https://out/map.png");
    expect(out.toString()).toBe("MAPBYTES");
  });

  it("uploads only the control image when styleImage is null", async () => {
    const upload = vi
      .fn<(blob: Blob) => Promise<string>>()
      .mockResolvedValueOnce("https://up/control.png");
    const fal = {
      storage: { upload },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/map.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("MAPBYTES").buffer
    }));

    await editMapPass(
      { fal, fetch },
      {
        controlImage: Buffer.from("control"),
        styleImage: null,
        model: "fal-ai/gpt-image-1.5/edit",
        prompt: "grey is land, blue is sea",
        imageSize: "1024x1024",
        quality: "high",
        inputFidelity: "high"
      }
    );

    expect(upload).toHaveBeenCalledTimes(1);
    const [, opts] = fal.subscribe.mock.calls[0]!;
    expect((opts.input as { image_urls: string[] }).image_urls).toHaveLength(1);
  });

  it("uploads the mask and passes mask_image_url only when maskImage is given", async () => {
    const upload = vi
      .fn<(blob: Blob) => Promise<string>>()
      .mockResolvedValueOnce("https://up/control.png")
      .mockResolvedValueOnce("https://up/mask.png");
    const fal = {
      storage: { upload },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/map.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("MAPBYTES").buffer
    }));

    await editMapPass(
      { fal, fetch },
      {
        controlImage: Buffer.from("control"),
        styleImage: null,
        maskImage: Buffer.from("mask"),
        model: "fal-ai/gpt-image-1.5/edit",
        prompt: "draw a castle in the editable region",
        imageSize: "1024x1024",
        quality: "high",
        inputFidelity: "high"
      }
    );

    // control + mask uploaded (no style); mask_image_url points at the mask upload.
    expect(upload).toHaveBeenCalledTimes(2);
    const [, opts] = fal.subscribe.mock.calls[0]!;
    const input = opts.input as { image_urls: string[]; mask_image_url?: string };
    expect(input.image_urls).toHaveLength(1); // control only (style null)
    expect(input.mask_image_url).toBe("https://up/mask.png");
  });

  it("omits mask_image_url when no maskImage is given", async () => {
    const fal = {
      storage: { upload: vi.fn(async () => "https://up/control.png") },
      subscribe: vi.fn(async (_m: string, _o: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/map.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("X").buffer
    }));
    await editMapPass(
      { fal, fetch },
      {
        controlImage: Buffer.from("control"),
        styleImage: null,
        model: "m",
        prompt: "p",
        imageSize: "1024x1024",
        quality: "high",
        inputFidelity: "high"
      }
    );
    const [, opts] = fal.subscribe.mock.calls[0]!;
    expect(opts.input).not.toHaveProperty("mask_image_url");
  });

  it("throws when the result fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn(async () => "https://up/x") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/x.png" }] } }))
    };
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      arrayBuffer: async () => new ArrayBuffer(0)
    }));
    await expect(
      editMapPass(
        { fal, fetch },
        {
          controlImage: Buffer.from("c"),
          styleImage: Buffer.from("s"),
          model: "m",
          prompt: "p",
          imageSize: "1024x1024",
          quality: "high",
          inputFidelity: "high"
        }
      )
    ).rejects.toThrow(/503/);
  });
});
