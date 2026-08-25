import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { applyInpaintHarborPass } from "../src/mapPipeline.js";
import { loadStyleProfile } from "../src/mapProfile.js";
import type { EditDeps } from "../src/editPass.js";
import type { HarborScene } from "../src/harborMarkers.js";

// A tiny valid PNG the inpaint model "returns"; applyInpaintHarborPass decodes + resizes it.
const onePxPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function fakeDeps(): EditDeps {
  return {
    fal: {
      storage: { upload: vi.fn(async () => "https://up/x") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://out/x.png" }] } }))
    },
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        onePxPng.buffer.slice(onePxPng.byteOffset, onePxPng.byteOffset + onePxPng.length)
    }))
  };
}

const TWO_HARBORS: HarborScene = {
  viewBox: { x: 0, y: 0, width: 100 },
  hexSize: 10,
  tiles: [
    { centroid: { x: 20, y: 20 }, features: { harbor: true }, ports: [{ edge: { x: 20, y: 28 } }] },
    { centroid: { x: 80, y: 20 }, features: { harbor: true }, ports: [{ edge: { x: 80, y: 28 } }] },
    { centroid: { x: 50, y: 50 }, features: { harbor: false }, ports: [] }
  ]
};

async function whiteBase(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
}

describe("applyInpaintHarborPass", () => {
  it("inpaints once per harbour tile (a separate single-disc call each)", async () => {
    const deps = fakeDeps();
    await applyInpaintHarborPass(deps, {
      base: await whiteBase(100, 100),
      width: 100,
      height: 100,
      profile: loadStyleProfile("antique"),
      scene: TWO_HARBORS,
      model: "fal-ai/flux-pro/v1/fill",
      prompt: "a fishing village"
    });
    // Two harbour tiles → two inpaint passes; each uploads image + mask.
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(2);
    expect(deps.fal.storage.upload).toHaveBeenCalledTimes(4);
  });

  it("returns the base (resized) and calls no model when there are no harbours", async () => {
    const deps = fakeDeps();
    const out = await applyInpaintHarborPass(deps, {
      base: await whiteBase(20, 20),
      width: 20,
      height: 20,
      profile: loadStyleProfile("antique"),
      scene: { viewBox: { x: 0, y: 0, width: 100 }, hexSize: 10, tiles: [] },
      model: "m",
      prompt: "p"
    });
    expect(deps.fal.subscribe).not.toHaveBeenCalled();
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(20);
  });
});
