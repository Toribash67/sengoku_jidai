import type { MapDefinition } from "@sengoku-jidai/engine";
import sharp from "sharp";
import { prepBoardSvgMarkup, tileColorMap } from "./controlImage.js";

/** Smooth low-frequency noise field (single channel, mean ~128) used to domain-warp the
 *  coastline so it reads as a natural irregular shore rather than rounded hexes. The field is
 *  blurred so the displacement varies smoothly between neighbouring pixels — without that, the
 *  nearest-neighbour resample aliases the high-frequency noise into stripes along the boundary;
 *  `normalise` restores the contrast the blur removes so the warp keeps its full amplitude. */
async function displacementField(
  width: number,
  height: number,
  baseFrequency: number,
  seed: number
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <filter id="t"><feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="2" seed="${seed}" stitchTiles="stitch"/></filter>
    <rect width="100%" height="100%" filter="url(#t)"/></svg>`;
  return sharp(Buffer.from(svg))
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .blur(12)
    .normalise()
    .toColourspace("b-w") // force single channel: blur promotes raw input to 3 channels
    .raw()
    .toBuffer();
}

/**
 * Render the binary land mask for a map from its board SVG. Land + the area outside the tiles
 * read as land (white), sea tiles read as sea (black). `organicSigma` softens the hex facets;
 * when `coastWarp` is given the boundary is domain-warped through a smooth noise vector field
 * so the coastline becomes naturally irregular (a real-looking shore, deliberately no longer
 * pixel-perfect to the hex tiles) while staying connected. This mask is the placement control
 * fed (with a style reference) to the edit model.
 */
export async function renderLandMask(args: {
  svgMarkup: string;
  map: MapDefinition;
  width: number;
  height: number;
  organicSigma: number;
  coastWarp?: { amplitude: number; scale: number; seed: number };
}): Promise<Buffer> {
  const { svgMarkup, map, width, height, organicSigma, coastWarp } = args;

  const markup = prepBoardSvgMarkup({
    svgMarkup,
    colors: tileColorMap(map, "#ffffff", "#000000"),
    backgroundColor: "#ffffff",
    width,
    height
  });

  const greyPipe = sharp(Buffer.from(markup)).resize(width, height, { fit: "fill" }).greyscale();

  // Binary source: white land (incl. background), black sea.
  let mask = await greyPipe.threshold(128).toColourspace("b-w").raw().toBuffer();

  if (coastWarp && coastWarp.amplitude > 0) {
    // Domain warp: resample the binary mask through a smooth low-frequency noise vector field.
    // Because the displacement is smooth, whole regions translate coherently — the hex boundary
    // bends into organic coastlines while thin features (rivers) stay connected. `amplitude` is
    // the max displacement in pixels; `scale` is the base frequency (smaller = larger bays).
    const nx = await displacementField(width, height, coastWarp.scale, coastWarp.seed);
    const ny = await displacementField(width, height, coastWarp.scale, coastWarp.seed + 101);
    const amp = coastWarp.amplitude;
    const warped = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const dx = ((nx[i]! - 128) / 128) * amp;
        const dy = ((ny[i]! - 128) / 128) * amp;
        let sx = x + Math.round(dx);
        let sy = y + Math.round(dy);
        sx = sx < 0 ? 0 : sx >= width ? width - 1 : sx;
        sy = sy < 0 ? 0 : sy >= height ? height - 1 : sy;
        warped[i] = mask[sy * width + sx]!;
      }
    }
    mask = warped;
  }

  // Soften the jaggies, then re-threshold to a strict binary mask. Blur and threshold must run
  // in separate sharp passes — within one pipeline sharp applies blur after threshold, which
  // would leave soft grey edges.
  if (organicSigma > 0) {
    mask = await sharp(mask, { raw: { width, height, channels: 1 } })
      .blur(organicSigma)
      .toColourspace("b-w") // force single channel: blur promotes raw input to 3 channels
      .raw()
      .toBuffer();
  }
  return sharp(mask, { raw: { width, height, channels: 1 } })
    .threshold(128)
    .png()
    .toBuffer();
}
