import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fortMarkerOverlay } from "../src/fortMarkerOverlay.js";

async function whiteBase(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: "#ffffff" }
  })
    .png()
    .toBuffer();
}

describe("fortMarkerOverlay", () => {
  it("draws the marker color at the marker center and leaves far pixels untouched", async () => {
    const W = 40;
    const H = 40;
    const out = await fortMarkerOverlay({
      base: await whiteBase(W, H),
      width: W,
      height: H,
      markers: [{ x: 20, y: 20, radius: 6 }],
      color: "#ff00ff"
    });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Center is magenta (marker disc).
    expect(at(20, 20)).toEqual([255, 0, 255]);
    // Far corner is still white (untouched).
    expect(at(1, 1)).toEqual([255, 255, 255]);
  });

  it("returns the base unchanged when there are no markers", async () => {
    const W = 16;
    const H = 16;
    const base = await whiteBase(W, H);
    const out = await fortMarkerOverlay({
      base,
      width: W,
      height: H,
      markers: [],
      color: "#ff00ff"
    });
    const a = await sharp(out).raw().toBuffer();
    const b = await sharp(base).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
    expect(Buffer.compare(a, b)).toBe(0);
  });
});
