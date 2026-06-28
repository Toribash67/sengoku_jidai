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
        model: "fal-ai/nano-banana-pro/edit",
        prompt: "grey is land, blue is sea",
        resolution: "2K",
        seed: 1568
      }
    );

    expect(upload).toHaveBeenCalledTimes(2); // control + style reference
    const [model, opts] = fal.subscribe.mock.calls[0]!;
    expect(model).toBe("fal-ai/nano-banana-pro/edit");
    expect(opts.input).toMatchObject({
      prompt: "grey is land, blue is sea",
      image_urls: ["https://up/control.png", "https://up/style.jpeg"],
      resolution: "2K",
      seed: 1568,
      num_images: 1
    });
    expect(fetch).toHaveBeenCalledWith("https://out/map.png");
    expect(out.toString()).toBe("MAPBYTES");
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
          resolution: "1K",
          seed: 1
        }
      )
    ).rejects.toThrow(/503/);
  });
});
