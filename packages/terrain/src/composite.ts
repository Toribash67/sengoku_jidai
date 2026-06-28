import sharp from "sharp";

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

/**
 * Flat two-colour control image: `landColor` where the (warped) mask is land, `seaColor`
 * where it is sea. Fed (with a style reference) to the edit model so it places land/sea.
 * Use bold, distinct colours (e.g. green land / blue sea) — the control colour never appears
 * in the final map, so clarity to the model matters more than matching the UI palette.
 */
export async function renderControl(args: {
  landMask: Buffer;
  landColor: string;
  seaColor: string;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { width, height } = args;
  const mask = await sharp(args.landMask)
    .resize({ width, height, fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const l = parseHex(args.landColor);
  const s = parseHex(args.seaColor);
  const out = Buffer.alloc(width * height * 3);
  for (let p = 0, q = 0; p < width * height; p++, q += 3) {
    const land = mask[p]! > 127;
    out[q] = land ? l.r : s.r;
    out[q + 1] = land ? l.g : s.g;
    out[q + 2] = land ? l.b : s.b;
  }
  return sharp(out, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}
