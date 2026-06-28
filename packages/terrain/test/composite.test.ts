import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderControl } from "../src/composite.js";

const W = 16;
const H = 16;

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

describe("renderControl", () => {
  it("paints landColor where the mask is land and seaColor where it is sea", async () => {
    const out = await renderControl({
      landMask: await splitMask(),
      landColor: "#2e7d32", // green
      seaColor: "#1565c0", // blue
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
    const [lr, lg, lb] = px(2, 8); // left → land green #2e7d32
    expect([lr, lg, lb]).toEqual([0x2e, 0x7d, 0x32]);
    const [sr, sg, sb] = px(13, 8); // right → sea blue #1565c0
    expect([sr, sg, sb]).toEqual([0x15, 0x65, 0xc0]);
  });
});
