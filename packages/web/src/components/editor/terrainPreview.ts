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

/** Assembled tiles carry an opaque authored fill (`class="tile" … style="fill:…"`). Terrain
 *  paints beneath them, so those fills would hide it. Clear them to a transparent fill + hex
 *  outline so the terrain shows through — the same reveal the play view does in `decorate()`
 *  when a terrain layer is present. Scoped to `class="tile"` so it never touches the feature
 *  glyphs (HQ/harbour/order tokens/star badges), which carry their own inline fill styles.
 *  In `assembleBoardSvg` output a tile path is `<path id=… class="tile" d=… style="fill:…">`,
 *  so `style` always follows `class="tile"` on the same element (no `>` between). */
const TILE_FILL_STYLE = /(class="tile"[^>]*?)style="fill:[^"]*"/g;
const TILE_REVEAL_STYLE = 'style="fill:transparent;stroke:#000000;stroke-width:5"';

/** Return `svgMarkup` prepared to display the given terrain: a terrain `<image>` spliced in as
 *  the SVG's first child (so it paints beneath everything, mirroring the play view's
 *  `applyTerrain`), and the tiles' opaque authored fills cleared so the image shows through.
 *  No-op when the url is empty, the viewBox can't be parsed, or a terrain image is already
 *  present. */
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
  // Clearing tile fills does not touch the opening <svg …> tag (it has no fill style), so the
  // first ">" — where the image is spliced — is at the same index before and after the reveal.
  const revealed = svgMarkup.replace(TILE_FILL_STYLE, (_m, prefix) => prefix + TILE_REVEAL_STYLE);
  const openTagEnd = revealed.indexOf(">");
  if (openTagEnd === -1) {
    return svgMarkup;
  }
  const a = terrainImageAttrs(viewBox);
  const image =
    `<image id="${PREVIEW_TERRAIN_ID}" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}"` +
    ` preserveAspectRatio="${a.preserveAspectRatio}" pointer-events="none"` +
    ` href="${terrainUrl}" xlink:href="${terrainUrl}" />`;
  return revealed.slice(0, openTagEnd + 1) + image + revealed.slice(openTagEnd + 1);
}
