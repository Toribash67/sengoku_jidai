import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fortMaskImage } from "../src/fortMaskImage.js";

/** Read the RGBA value at (x,y) from a PNG buffer. */
async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}

describe("fortMaskImage", () => {
  it("punches a transparent disc at each fort (opaque elsewhere) by default", async () => {
    const W = 40;
    const H = 40;
    const png = await fortMaskImage({
      width: W,
      height: H,
      discs: [{ x: 20, y: 20, radius: 6 }]
    });
    // Disc centre is transparent (editable).
    expect((await pixel(png, 20, 20))[3]).toBe(0);
    // Far corner is fully opaque (kept).
    expect((await pixel(png, 1, 1))[3]).toBe(255);
  });

  it("inverts polarity when invert=true (opaque disc, transparent elsewhere)", async () => {
    const W = 40;
    const H = 40;
    const png = await fortMaskImage({
      width: W,
      height: H,
      discs: [{ x: 20, y: 20, radius: 6 }],
      invert: true
    });
    expect((await pixel(png, 20, 20))[3]).toBe(255); // disc now kept-opaque
    expect((await pixel(png, 1, 1))[3]).toBe(0); // elsewhere now editable-transparent
  });

  it("is fully opaque when there are no discs", async () => {
    const png = await fortMaskImage({ width: 16, height: 16, discs: [] });
    expect((await pixel(png, 8, 8))[3]).toBe(255);
    expect((await pixel(png, 0, 0))[3]).toBe(255);
  });
});
