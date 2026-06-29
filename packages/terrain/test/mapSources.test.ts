import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mapSvgPath } from "../src/mapSources.js";

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
