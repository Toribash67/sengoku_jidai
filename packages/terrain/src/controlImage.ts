import type { MapDefinition } from "@sengoku-jidai/engine";
import { JSDOM } from "jsdom";
import sharp from "sharp";

/** Shared tile geometry defs whose inline fill/stroke must be neutralized so each
 *  tile's own fill wins (mirrors the web MapBoard prep). */
const TILE_GEOMETRY_DEFS = ["path9", "path9-2", "path9-2-2", "path9-5", "path9-5-0"];

/** Map every tile id in a map to its colour-base fill by land/sea kind. */
export function tileColorMap(
  map: MapDefinition,
  landColor: string,
  seaColor: string
): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const area of Object.values(map.areas)) {
    colors[area.id] = area.kind === "land" ? landColor : seaColor;
  }
  return colors;
}

/**
 * Render the colour base that conditions image-to-image generation, from the board SVG.
 * Land/outside-the-tiles is painted `backgroundColor`, sea its colour, so the regions carry
 * land vs. water into the generation. Rendered headlessly with jsdom (DOM manipulation) +
 * sharp (rasterize) — no browser, so it runs anywhere. Approach:
 *  - paint a `backgroundColor` rect behind everything (so the area outside the tiles reads as land),
 *  - hide every `#g1` child except the `#tile-land` / `#tile-sea` groups (no re-parenting, so
 *    every transform is preserved and coastlines match the board),
 *  - neutralize the shared geometry defs, then fill each tile by its colour with a same-colour
 *    stroke (sealing the anti-aliased seam between same-class tiles),
 *  - rasterize at width×height (preserveAspectRatio="none") and Gaussian-blur to round the hex
 *    corners into organic coastlines.
 */
export async function renderBaseImage(args: {
  svgMarkup: string;
  colors: Record<string, string>;
  backgroundColor: string;
  width: number;
  height: number;
  blurSigma: number;
}): Promise<Buffer> {
  const { svgMarkup, colors, backgroundColor, width, height, blurSigma } = args;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const doc = new JSDOM(`<!doctype html><body>${svgMarkup}</body>`).window.document;
  const svg = doc.querySelector("svg");
  if (!svg) {
    throw new Error("base render: no <svg> in markup");
  }
  const vb = (svg.getAttribute("viewBox") ?? "0 0 0 0").split(/\s+/).map(Number);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");

  // Land-coloured background covering the whole viewBox, behind all tiles.
  const bg = doc.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(vb[0]));
  bg.setAttribute("y", String(vb[1]));
  bg.setAttribute("width", String(vb[2]));
  bg.setAttribute("height", String(vb[3]));
  bg.setAttribute("fill", backgroundColor);
  svg.insertBefore(bg, svg.firstChild);

  // Hide every feature/order/visual layer; keep only the tile groups.
  const g1 = doc.getElementById("g1");
  if (!g1) {
    throw new Error("base render: SVG has no #g1 group");
  }
  for (const child of Array.from(g1.children)) {
    if (child.id !== "tile-land" && child.id !== "tile-sea") {
      child.setAttribute("style", `${child.getAttribute("style") ?? ""};display:none`);
    }
  }

  // Neutralize shared geometry def fill/stroke so each tile's own fill wins.
  for (const id of TILE_GEOMETRY_DEFS) {
    const def = doc.getElementById(id);
    if (def) {
      def.setAttribute("style", `${def.getAttribute("style") ?? ""};fill:inherit;stroke:inherit`);
    }
  }

  // Colour each tile by class; same-colour stroke seals the anti-aliased seam between neighbours.
  for (const [tileId, color] of Object.entries(colors)) {
    const tile = doc.getElementById(tileId);
    if (!tile) {
      throw new Error(`base render: SVG has no element for tile "${tileId}"`);
    }
    tile.setAttribute(
      "style",
      `${tile.getAttribute("style") ?? ""};fill:${color};stroke:${color};stroke-width:2;display:inline`
    );
  }

  let pipeline = sharp(Buffer.from(svg.outerHTML)).resize(width, height, { fit: "fill" });
  if (blurSigma > 0) {
    pipeline = pipeline.blur(blurSigma);
  }
  return pipeline.png().toBuffer();
}
