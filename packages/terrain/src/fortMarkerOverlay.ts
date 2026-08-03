import sharp from "sharp";
import type { FortMarker } from "./fortMarkers.js";

/**
 * Overlay a filled disc of `color` at each fort marker on the base terrain, returning a
 * `width`×`height` PNG. The disc is a bright signal color absent from terrain palettes so the
 * second edit pass can unambiguously locate each fort. With no markers the base is returned
 * unchanged (resized to width×height, RGB).
 */
export async function fortMarkerOverlay(args: {
  base: Buffer;
  width: number;
  height: number;
  markers: FortMarker[];
  color: string;
}): Promise<Buffer> {
  const { base, width, height, markers, color } = args;
  const canvas = sharp(base).resize(width, height, { fit: "fill" }).removeAlpha();
  if (markers.length === 0) {
    return canvas.png().toBuffer();
  }
  const circles = markers
    .map((m) => `<circle cx="${m.x}" cy="${m.y}" r="${m.radius}" fill="${color}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`;
  return canvas
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
