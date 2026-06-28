import sharp, { type OverlayOptions } from "sharp";

/** Clip the land texture through the land mask over the sea texture, then ink the coast. */
export async function compositeMap(args: {
  landTexture: Buffer;
  seaTexture: Buffer;
  landMask: Buffer;
  coastStroke: Buffer;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { width, height } = args;
  const fit = { width, height, fit: "fill" as const };

  const sea = await sharp(args.seaTexture).resize(fit).removeAlpha().png().toBuffer();
  const maskRaw = await sharp(args.landMask).resize(fit).greyscale().raw().toBuffer();
  const landRgb = await sharp(args.landTexture).resize(fit).removeAlpha().raw().toBuffer();

  // Land texture with the mask as its alpha channel → only land regions are opaque.
  const landWithAlpha = await sharp(landRgb, { raw: { width, height, channels: 3 } })
    .joinChannel(maskRaw, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(sea)
    .composite([{ input: landWithAlpha }, { input: args.coastStroke }])
    .png()
    .toBuffer();
}

/** Desaturate, multiply a parchment tint, and (optionally) vignette into one antique sheet. */
export async function harmonize(
  image: Buffer,
  opts: { saturation: number; brightness: number; parchmentTint: string; vignette: boolean }
): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const overlays: OverlayOptions[] = [
    {
      input: {
        create: { width, height, channels: 3, background: opts.parchmentTint }
      },
      blend: "multiply"
    }
  ];
  if (opts.vignette) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#7a6a4a"/>
      </radialGradient>
      <rect width="100%" height="100%" fill="url(#v)"/></svg>`;
    overlays.push({ input: Buffer.from(svg), blend: "multiply" });
  }

  return sharp(image)
    .modulate({ saturation: opts.saturation, brightness: opts.brightness })
    .composite(overlays)
    .png()
    .toBuffer();
}
