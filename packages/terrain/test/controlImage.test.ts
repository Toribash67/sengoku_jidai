import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { riversMap } from "@sengoku-jidai/engine";
import { prepBoardSvgMarkup, renderBaseImage, tileColorMap } from "../src/controlImage.js";
import { mapSvgPath } from "../src/mapSources.js";

const LAND = "#7e8c5a";
const SEA = "#566f80";

describe("tileColorMap", () => {
  it("maps every tile to the land or sea colour by kind", () => {
    const colors = tileColorMap(riversMap, LAND, SEA);
    expect(Object.keys(colors).sort()).toEqual(Object.keys(riversMap.areas).sort());
    expect(colors.tile1).toBe(LAND); // tile1 is land
    expect(colors.tile3).toBe(SEA); // tile3 is sea
    for (const value of Object.values(colors)) {
      expect([LAND, SEA]).toContain(value);
    }
  });
});

describe("prepBoardSvgMarkup", () => {
  it("returns SVG markup sized to the request with a tile filled by the given colour", () => {
    const svgMarkup = readFileSync(mapSvgPath("rivers"), "utf8");
    const markup = prepBoardSvgMarkup({
      svgMarkup,
      colors: tileColorMap(riversMap, LAND, SEA),
      backgroundColor: LAND,
      width: 256,
      height: 290
    });
    expect(markup).toContain('width="256"');
    expect(markup).toContain('preserveAspectRatio="none"');
    // tile1 is land, so its inline style carries the land fill.
    expect(markup).toMatch(/id="tile1"[^>]*fill:#7e8c5a/);
  });
});

describe("renderBaseImage", () => {
  it("renders a colour base of the requested size with both land and sea regions present", async () => {
    const svgMarkup = readFileSync(mapSvgPath("rivers"), "utf8");
    const png = await renderBaseImage({
      svgMarkup,
      colors: tileColorMap(riversMap, LAND, SEA),
      backgroundColor: LAND,
      width: 256,
      height: 290,
      blurSigma: 0 // crisp regions so the colour assertions are exact
    });

    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(256);
    expect(info.height).toBe(290);

    // Count pixels near the land (126,140,90) and sea (86,111,128) colours.
    const near = (r: number, g: number, b: number, tr: number, tg: number, tb: number) =>
      Math.abs(r - tr) < 30 && Math.abs(g - tg) < 30 && Math.abs(b - tb) < 30;
    let land = 0;
    let sea = 0;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (near(r, g, b, 126, 140, 90)) land += 1;
      else if (near(r, g, b, 86, 111, 128)) sea += 1;
    }
    const total = info.width * info.height;
    // Land dominates (it's also the background); sea is a meaningful minority.
    expect(land / total).toBeGreaterThan(0.4);
    expect(sea / total).toBeGreaterThan(0.1);
  });
});
