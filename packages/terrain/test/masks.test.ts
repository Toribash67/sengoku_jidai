import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { riversMap } from "@sengoku-jidai/engine";
import { renderLandMask } from "../src/masks.js";
import { mapSvgPath } from "../src/mapSources.js";

describe("renderLandMask", () => {
  it("produces a strictly binary land mask (white land, black sea) from the board SVG", async () => {
    const svgMarkup = readFileSync(mapSvgPath("rivers"), "utf8");
    const landMask = await renderLandMask({
      svgMarkup,
      map: riversMap,
      width: 256,
      height: 290,
      organicSigma: 0
    });

    const mask = await sharp(landMask).greyscale().raw().toBuffer();
    let white = 0;
    let black = 0;
    for (const v of mask) {
      if (v > 200) white += 1;
      else if (v < 50) black += 1;
    }
    expect(white + black).toBe(mask.length); // no greys → binary
    expect(white / mask.length).toBeGreaterThan(0.4); // land + background dominate
    expect(black / mask.length).toBeGreaterThan(0.1); // sea is a real minority
  });

  it("keeps the mask binary and connected after the domain warp", async () => {
    const svgMarkup = readFileSync(mapSvgPath("rivers"), "utf8");
    const landMask = await renderLandMask({
      svgMarkup,
      map: riversMap,
      width: 256,
      height: 290,
      organicSigma: 4,
      coastWarp: { amplitude: 30, scale: 0.01, seed: 7 }
    });

    const mask = await sharp(landMask).greyscale().raw().toBuffer();
    let white = 0;
    let black = 0;
    for (const v of mask) {
      if (v > 200) white += 1;
      else if (v < 50) black += 1;
    }
    expect(white + black).toBe(mask.length); // still strictly binary after warp
    expect(white / mask.length).toBeGreaterThan(0.3); // both land and sea survive the warp
    expect(black / mask.length).toBeGreaterThan(0.1);
  });
});
