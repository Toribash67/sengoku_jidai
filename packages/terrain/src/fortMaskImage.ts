import sharp from "sharp";

/** An editable region for the mask, in output-image pixels. Same shape `fortMarkers` produces. */
export interface MaskDisc {
  x: number;
  y: number;
  radius: number;
}

/**
 * Build an RGBA mask for the gpt-image edit pass. Following the gpt-image convention, TRANSPARENT
 * (alpha 0) pixels are editable and OPAQUE pixels are kept: so by default the mask is opaque black
 * everywhere with a transparent disc punched at each fort tile, restricting the fort pass to those
 * regions. `invert` swaps the polarity (opaque discs, transparent elsewhere) — kept trivially
 * flippable because fal's exact mask polarity is verified empirically, not from a schema.
 *
 * The transparent discs are punched with a `dest-out` composite: an opaque white circle removes
 * the base layer's alpha where it lands, leaving a clean alpha hole.
 */
export async function fortMaskImage(args: {
  width: number;
  height: number;
  discs: MaskDisc[];
  invert?: boolean;
}): Promise<Buffer> {
  const { width, height, discs, invert = false } = args;
  // Base alpha: opaque where we keep, transparent where we edit. Default keeps everything (opaque)
  // and punches editable holes; invert starts transparent and stamps opaque discs.
  const baseAlpha = invert ? 0 : 255;
  const base = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: baseAlpha / 255 } }
  });
  if (discs.length === 0) {
    return base.png().toBuffer();
  }
  const circles = discs
    .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.radius}" fill="#ffffff"/>`)
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`
  );
  // Default: dest-out punches the discs to transparent (editable). Invert: normal over-composite
  // stamps opaque discs onto a transparent field (the discs become the kept region).
  return base
    .composite([{ input: svg, blend: invert ? "over" : "dest-out" }])
    .png()
    .toBuffer();
}

/**
 * Build a luminance mask for true-inpainting models (FLUX Fill / SDXL inpaint): WHITE discs =
 * the region to inpaint, BLACK = keep. Unlike `fortMaskImage` (alpha-based, for gpt-image), these
 * models take an opaque black/white image and preserve every black pixel exactly.
 */
export async function fortFillMask(args: {
  width: number;
  height: number;
  discs: MaskDisc[];
}): Promise<Buffer> {
  const { width, height, discs } = args;
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } }
  });
  if (discs.length === 0) {
    return base.png().toBuffer();
  }
  const circles = discs
    .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.radius}" fill="#ffffff"/>`)
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`
  );
  return base
    .composite([{ input: svg }])
    .png()
    .toBuffer();
}
