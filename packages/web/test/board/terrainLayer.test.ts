import { describe, expect, it } from "vitest";
import { terrainImageAttrs } from "@sengoku-jidai/board-render";

describe("terrainImageAttrs", () => {
  it("covers the full viewBox with no aspect distortion-compensation", () => {
    const attrs = terrainImageAttrs({ x: 0, y: 0, width: 1133.8602, height: 1288.1589 });
    expect(attrs).toEqual({
      x: 0,
      y: 0,
      width: 1133.8602,
      height: 1288.1589,
      preserveAspectRatio: "none"
    });
  });
});
