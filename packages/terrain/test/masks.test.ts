import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { riversMap } from "@sengoku-jidai/engine";
import { renderMasks } from "../src/masks.js";
import { mapSvgPath } from "../src/mapSources.js";

describe("renderMasks", () => {
  it("produces a binary land mask (white land, black sea) and a non-empty coastline", async () => {
    const svgMarkup = readFileSync(mapSvgPath("rivers"), "utf8");
    const { landMask, coastStroke, width, height } = await renderMasks({
      svgMarkup,
      map: riversMap,
      width: 256,
      height: 290,
      organicSigma: 0,
      inkColor: "#3a2f23",
      strokeWidth: 2
    });
    expect(width).toBe(256);
    expect(height).toBe(290);

    // Land mask is strictly binary with both populations present.
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

    // Coastline has opaque ink pixels (the boundary) but is mostly transparent.
    const { data, info } = await sharp(coastStroke)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3]! > 128) opaque += 1;
    }
    const totalPx = info.width * info.height;
    expect(opaque).toBeGreaterThan(0);
    expect(opaque / totalPx).toBeLessThan(0.2); // a stroke, not a fill
  });
});
