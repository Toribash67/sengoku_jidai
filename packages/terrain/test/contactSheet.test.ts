import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { gridLayout, buildContactSheet } from "../src/contactSheet.js";

const opts = { columns: 3, cellWidth: 100, cellHeight: 120, captionHeight: 20 };

describe("gridLayout", () => {
  it("computes canvas size and cell offsets for a full row plus a partial row", () => {
    const g = gridLayout(4, opts);
    // 3 columns used → width = 300; 2 rows → height = 2 * (120 + 20) = 280
    expect(g.canvasWidth).toBe(300);
    expect(g.canvasHeight).toBe(280);
    expect(g.cells[0]).toEqual({ x: 0, y: 0 });
    expect(g.cells[2]).toEqual({ x: 200, y: 0 });
    expect(g.cells[3]).toEqual({ x: 0, y: 140 }); // wraps to row 2
  });

  it("narrows the canvas when there are fewer items than columns", () => {
    const g = gridLayout(2, opts);
    expect(g.canvasWidth).toBe(200); // only 2 columns used
    expect(g.canvasHeight).toBe(140); // 1 row
  });
});

describe("buildContactSheet", () => {
  it("produces a PNG of the laid-out size, tolerating a null (failed) cell", async () => {
    const red = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } }
    })
      .png()
      .toBuffer();
    const out = await buildContactSheet(
      [
        { label: "ok-1", image: red },
        { label: "failed", image: null },
        { label: "ok-2", image: red }
      ],
      opts
    );
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(300); // 3 columns
    expect(meta.height).toBe(140); // 1 row
  });
});
