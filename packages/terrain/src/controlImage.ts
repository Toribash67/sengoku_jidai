import type { MapDefinition } from "@sengoku-jidai/engine";
import { chromium } from "@playwright/test";

/** Control-image classes: land (and everything outside the tiles) is white, sea is black. */
export const LAND_COLOR = "#ffffff";
export const SEA_COLOR = "#000000";

/** Shared tile geometry defs whose inline fill/stroke must be neutralized so each
 *  tile <use> can drive its own appearance (mirrors the web MapBoard prep). */
const TILE_GEOMETRY_DEFS = ["path9", "path9-2", "path9-2-2", "path9-5", "path9-5-0"];

/** Map every tile id in a map to its control-image colour by land/sea kind. */
export function tileColorMap(map: MapDefinition): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const area of Object.values(map.areas)) {
    colors[area.id] = area.kind === "land" ? LAND_COLOR : SEA_COLOR;
  }
  return colors;
}

/**
 * Render the land/sea control image from the board SVG. Approach:
 *  - land-coloured background rect behind everything (so the area outside the tiles reads as
 *    land, not sea),
 *  - hide every `#g1` child except the `#tile-land` / `#tile-sea` groups (no re-parenting,
 *    so every transform is preserved and coastlines match the board pixel-for-pixel),
 *  - neutralize the shared geometry defs, then fill each tile by its colour with no stroke
 *    (so adjacent same-class tiles merge and the only edge is the coastline),
 *  - size the SVG to width×height with preserveAspectRatio="none" and screenshot it.
 */
export async function renderControlImage(args: {
  svgMarkup: string;
  colors: Record<string, string>;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { svgMarkup, colors, width, height } = args;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><style>*{margin:0;padding:0}</style></head><body>${svgMarkup}</body></html>`,
      { waitUntil: "load" }
    );
    await page.evaluate(
      ({ colors, geometryDefs, width, height, bgColor }) => {
        const svg = document.querySelector("svg");
        if (!svg) {
          throw new Error("control render: no <svg> in markup");
        }
        const SVG_NS = "http://www.w3.org/2000/svg";
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.setAttribute("preserveAspectRatio", "none");

        // Land-coloured background covering the whole viewBox, behind all tiles (so the area
        // outside the hex cluster reads as land rather than sea).
        const vb = svg.viewBox.baseVal;
        const bg = document.createElementNS(SVG_NS, "rect");
        bg.setAttribute("x", String(vb.x));
        bg.setAttribute("y", String(vb.y));
        bg.setAttribute("width", String(vb.width));
        bg.setAttribute("height", String(vb.height));
        bg.setAttribute("fill", bgColor);
        svg.insertBefore(bg, svg.firstChild);

        // Hide every feature/order/visual layer; keep only the tile groups.
        const g1 = svg.querySelector("#g1");
        if (!g1) {
          throw new Error("control render: SVG has no #g1 group");
        }
        for (const child of Array.from(g1.children)) {
          if (child.id !== "tile-land" && child.id !== "tile-sea") {
            (child as SVGElement).style.display = "none";
          }
        }

        // Neutralize shared geometry def fill/stroke so per-tile fill wins.
        for (const id of geometryDefs) {
          const def = document.getElementById(id) as SVGElement | null;
          if (def) {
            def.style.fill = "inherit";
            def.style.stroke = "inherit";
          }
        }

        // Colour each tile by class. Stroke each tile in its OWN fill colour (not "none") so
        // adjacent same-class tiles overlap and seal the anti-aliased seam at their shared hex
        // edge — otherwise the white background bleeds through as a faint grey hex grid inside
        // the (black) sea. The stroke nudges the coastline by < 1px, well within tolerance.
        for (const [tileId, color] of Object.entries(colors)) {
          const tile = document.getElementById(tileId) as SVGElement | null;
          if (!tile) {
            throw new Error(`control render: SVG has no element for tile "${tileId}"`);
          }
          tile.style.fill = color;
          tile.style.stroke = color;
          tile.style.strokeWidth = "2";
          tile.style.display = "inline";
        }
      },
      { colors, geometryDefs: TILE_GEOMETRY_DEFS, width, height, bgColor: LAND_COLOR }
    );
    const svgHandle = await page.$("svg");
    if (!svgHandle) {
      throw new Error("control render: no <svg> to screenshot");
    }
    return await svgHandle.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}
