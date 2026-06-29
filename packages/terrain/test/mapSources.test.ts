import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mapControlPath, mapSvgPath } from "../src/mapSources.js";

describe("mapSvgPath", () => {
  it("resolves the rivers map SVG to an existing file", () => {
    const path = mapSvgPath("rivers");
    expect(path.endsWith("assets/maps/rivers/board.svg")).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("throws on an unknown map id", () => {
    expect(() => mapSvgPath("nope")).toThrow(/unknown map/i);
  });
});

describe("mapControlPath", () => {
  it("points at the committed control asset for a map", () => {
    expect(mapControlPath("rivers").endsWith("assets/controls/rivers-control.png")).toBe(true);
  });
});
