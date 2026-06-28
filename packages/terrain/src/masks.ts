import type { MapDefinition } from "@sengoku-jidai/engine";
import sharp, { type SharpOptions } from "sharp";
import { prepBoardSvgMarkup, tileColorMap } from "./controlImage.js";

export interface BoardMasks {
  landMask: Buffer;
  coastStroke: Buffer;
  width: number;
  height: number;
}

/** 3x3 Laplacian: nonzero only where the binary mask changes (the coastline). */
const EDGE_KERNEL = { width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] };

/**
 * Render the structural masks for a map from its board SVG. The land mask is the
 * compositing authority (coastline fidelity is 100% because it is the vector outline,
 * never a model output); the coastline stroke is the inked boundary laid over the
 * finished composite. Land + the area outside the tiles read as land; sea tiles read
 * as sea. `organicSigma` rounds the hex facets into organic curves while keeping the
 * mask strictly binary.
 */
export async function renderMasks(args: {
  svgMarkup: string;
  map: MapDefinition;
  width: number;
  height: number;
  organicSigma: number;
  inkColor: string;
  strokeWidth: number;
}): Promise<BoardMasks> {
  const { svgMarkup, map, width, height, organicSigma, inkColor, strokeWidth } = args;

  const markup = prepBoardSvgMarkup({
    svgMarkup,
    colors: tileColorMap(map, "#ffffff", "#000000"),
    backgroundColor: "#ffffff",
    width,
    height
  });

  let maskPipe = sharp(Buffer.from(markup)).resize(width, height, { fit: "fill" }).greyscale();
  if (organicSigma > 0) {
    maskPipe = maskPipe.blur(organicSigma);
  }
  const landMask = await maskPipe.threshold(128).png().toBuffer();

  // Coastline: edge-detect the binary mask, thicken, then tint with ink as alpha.
  // sharp rasterizes SVG as RGBA (4-channel); flatten composites the alpha against white
  // before greyscale so the Laplacian convolve sees a true single-channel image.
  let edgePipe = sharp(landMask)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .convolve(EDGE_KERNEL)
    .threshold(40);
  if (strokeWidth > 1) {
    edgePipe = edgePipe.blur(strokeWidth / 2).threshold(40);
  }
  const edge = await edgePipe.toColourspace("b-w").raw().toBuffer();

  const { r, g, b } = parseHex(inkColor);
  const coastStroke = await sharp({
    create: { width, height, channels: 3, background: { r, g, b } }
  } as SharpOptions)
    .joinChannel(edge, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return { landMask, coastStroke, width, height };
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
