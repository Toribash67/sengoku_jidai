import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderLandMask } from "../src/masks.js";

// Two adjacent single-hex tiles: t1 land, t2 sea.
const SOURCE = {
  id: "m",
  name: "Mask Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 3
};

describe("renderLandMask from a procedural board SVG", () => {
  it("produces a binary mask with both land (white) and sea (black) present", async () => {
    const compiled = compileHexMap(SOURCE as never);
    const svgMarkup = assembleBoardSvg(buildScene(compiled));

    const maskPng = await renderLandMask({
      svgMarkup,
      map: compiled.definition,
      width: 128,
      height: 64,
      organicSigma: 0
    });

    const { data, info } = await sharp(maskPng).greyscale().raw().toBuffer({
      resolveWithObject: true
    });
    let white = 0;
    let black = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i]! > 200) white++;
      else if (data[i]! < 55) black++;
    }
    // Both classes present ⇒ the recolor correctly split land vs sea from procedural output.
    expect(white).toBeGreaterThan(0);
    expect(black).toBeGreaterThan(0);
  });
});
