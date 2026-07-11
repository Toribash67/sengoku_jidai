import { terrainImageAttrs } from "../board/terrainImages.js";

/** Id of the injected background image — matches the play view's terrain layer id. */
const PREVIEW_TERRAIN_ID = "map-terrain";

/** Parse the four `viewBox="x y w h"` numbers from an assembled SVG string, or null if the
 *  attribute is absent or malformed. */
export function parseViewBox(
  svgMarkup: string
): { x: number; y: number; width: number; height: number } | null {
  const match = svgMarkup.match(/viewBox="([^"]+)"/);
  if (!match) {
    return null;
  }
  const parts = match[1]!.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height };
}

/** Return `svgMarkup` with a terrain `<image>` spliced in as the SVG's first child, so it paints
 *  beneath every tile — mirroring the play view's `applyTerrain`. No-op when the url is empty,
 *  the viewBox can't be parsed, or a terrain image is already present. */
export function injectTerrainBackground(svgMarkup: string, terrainUrl: string | null): string {
  if (!terrainUrl) {
    return svgMarkup;
  }
  if (svgMarkup.includes(`id="${PREVIEW_TERRAIN_ID}"`)) {
    return svgMarkup;
  }
  const viewBox = parseViewBox(svgMarkup);
  if (!viewBox) {
    return svgMarkup;
  }
  const openTagEnd = svgMarkup.indexOf(">");
  if (openTagEnd === -1) {
    return svgMarkup;
  }
  const a = terrainImageAttrs(viewBox);
  const image =
    `<image id="${PREVIEW_TERRAIN_ID}" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}"` +
    ` preserveAspectRatio="${a.preserveAspectRatio}" pointer-events="none"` +
    ` href="${terrainUrl}" xlink:href="${terrainUrl}" />`;
  return svgMarkup.slice(0, openTagEnd + 1) + image + svgMarkup.slice(openTagEnd + 1);
}
