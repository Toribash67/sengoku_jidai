import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { toWebp } from "../src/postprocess.js";

describe("toWebp", () => {
  it("resizes and encodes a webp of the requested size", async () => {
    // A small red PNG as input.
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 60, b: 40 } }
    })
      .png()
      .toBuffer();

    const out = await toWebp(png, { width: 128, height: 145, quality: 80 });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(145);
  });
});
