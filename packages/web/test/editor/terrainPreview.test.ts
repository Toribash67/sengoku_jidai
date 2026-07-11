import { describe, expect, it } from "vitest";
import {
  injectTerrainBackground,
  parseViewBox
} from "../../src/components/editor/terrainPreview.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10.00 -20.00 1133.86 1288.16"><defs></defs><g id="tile-sea"></g></svg>';

describe("parseViewBox", () => {
  it("reads the four viewBox numbers", () => {
    expect(parseViewBox(SVG)).toEqual({ x: -10, y: -20, width: 1133.86, height: 1288.16 });
  });

  it("returns null when there is no viewBox", () => {
    expect(parseViewBox("<svg></svg>")).toBeNull();
  });

  it("returns null for a malformed viewBox", () => {
    expect(parseViewBox('<svg viewBox="1 2 3"></svg>')).toBeNull();
  });
});

describe("injectTerrainBackground", () => {
  it("returns markup unchanged when the url is null", () => {
    expect(injectTerrainBackground(SVG, null)).toBe(SVG);
  });

  it("returns markup unchanged when the viewBox is missing", () => {
    const noVb = "<svg></svg>";
    expect(injectTerrainBackground(noVb, "/api/maps/x/terrain.webp")).toBe(noVb);
  });

  it("splices an image sized to the viewBox as the first child", () => {
    const out = injectTerrainBackground(SVG, "/api/maps/x/terrain.webp?v=1");
    // image comes right after the opening <svg ...> tag, before <defs>
    expect(out).toMatch(/<svg[^>]*>\s*<image /);
    expect(out.indexOf("<image ")).toBeLessThan(out.indexOf("<defs>"));
    expect(out).toContain('id="map-terrain"');
    expect(out).toContain('x="-10"');
    expect(out).toContain('width="1133.86"');
    expect(out).toContain('height="1288.16"');
    expect(out).toContain('preserveAspectRatio="none"');
    expect(out).toContain('pointer-events="none"');
    expect(out).toContain('href="/api/maps/x/terrain.webp?v=1"');
    expect(out).toContain('xlink:href="/api/maps/x/terrain.webp?v=1"');
  });

  it("does not inject twice if an image is already present", () => {
    const once = injectTerrainBackground(SVG, "/api/maps/x/terrain.webp");
    const twice = injectTerrainBackground(once, "/api/maps/x/terrain.webp");
    expect(twice).toBe(once);
  });
});
