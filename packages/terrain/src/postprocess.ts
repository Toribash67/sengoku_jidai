import sharp from "sharp";

/** Resize a generated PNG to the final dimensions and encode it as webp. */
export async function toWebp(
  png: Buffer,
  opts: { width: number; height: number; quality: number }
): Promise<Buffer> {
  return await sharp(png)
    .resize(opts.width, opts.height, { fit: "fill" })
    .webp({ quality: opts.quality })
    .toBuffer();
}
