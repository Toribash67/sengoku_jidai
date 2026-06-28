import { describe, expect, it } from "vitest";
import sharp, { type Stats } from "sharp";
import { compositeMap, harmonize } from "../src/composite.js";

const W = 16;
const H = 16;

// A solid-colour PNG helper.
async function solid(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

// Left half land (255), right half sea (0): a vertical split single-channel mask.
async function splitMask(): Promise<Buffer> {
  const raw = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) raw[y * W + x] = x < W / 2 ? 255 : 0;
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
}

async function transparent(): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .png()
    .toBuffer();
}

describe("compositeMap", () => {
  it("paints land where the mask is white and sea where it is black", async () => {
    const out = await compositeMap({
      landTexture: await solid(0, 200, 0), // green land
      seaTexture: await solid(0, 0, 200), // blue sea
      landMask: await splitMask(),
      coastStroke: await transparent(),
      width: W,
      height: H
    });
    const { data, info } = await sharp(out)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * 3;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
    expect(px(2, 8)[1]).toBeGreaterThan(150); // left → green land
    expect(px(13, 8)[2]).toBeGreaterThan(150); // right → blue sea
  });
});

describe("harmonize", () => {
  it("reduces saturation of the input", async () => {
    const vivid = await solid(220, 30, 30); // saturated red
    const out = await harmonize(vivid, {
      saturation: 0.3,
      brightness: 1,
      parchmentTint: "#ffffff",
      vignette: false
    });
    const before = await sharp(vivid).stats();
    const after = await sharp(out).stats();
    const spread = (s: Stats) =>
      Math.max(...s.channels.map((c) => c.max)) - Math.min(...s.channels.map((c) => c.min));
    expect(spread(after)).toBeLessThan(spread(before)); // channels pulled together
  });
});
