import { describe, expect, it } from "vitest";
import { injectTerrainBackground, parseViewBox } from "../src/terrainComposite.js";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10.00 -20.00 1133.86 1288.16"><defs></defs><g id="tile-sea"></g></svg>';

// An SVG with real tile paths carrying opaque authored fills (as assembleBoardSvg emits them),
// plus a feature glyph (an order token) that carries its OWN inline fill and must be preserved.
const SVG_WITH_TILES =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs></defs>' +
  '<g id="tile-sea"><path id="tileA" class="tile" d="M0,0Z" data-authored-fill="#8cb2f2" style="fill:#8cb2f2"/></g>' +
  '<g id="tile-land"><path id="tileB" class="tile" d="M1,1Z" data-authored-fill="#d5d3c4" style="fill:#d5d3c4"/></g>' +
  '<g id="features"><path id="ordertoken" style="fill:#000000;fill-rule:evenodd;stroke:none"/></g>' +
  "</svg>";

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

  it("clears the tiles' opaque fills so terrain shows through when a url is present", () => {
    const out = injectTerrainBackground(SVG_WITH_TILES, "/api/maps/x/terrain.webp");
    // The authored fills must be gone (they would otherwise hide the terrain image beneath them)
    // and replaced with transparent + a hex outline, mirroring the play view's decorate() reveal.
    expect(out).not.toContain("fill:#8cb2f2");
    expect(out).not.toContain("fill:#d5d3c4");
    expect(out).toContain("fill:transparent");
    expect(out).toContain("stroke:#000000");
    // The authored colours are preserved on the data attribute for reference.
    expect(out).toContain('data-authored-fill="#8cb2f2"');
  });

  it("preserves feature glyphs' own inline fills (only tile fills are cleared)", () => {
    const out = injectTerrainBackground(SVG_WITH_TILES, "/api/maps/x/terrain.webp");
    // The order token's black fill must survive — it is not a tile.
    expect(out).toContain('id="ordertoken" style="fill:#000000;fill-rule:evenodd;stroke:none"');
  });

  it("leaves the tiles' authored fills untouched when there is no terrain url", () => {
    expect(injectTerrainBackground(SVG_WITH_TILES, null)).toBe(SVG_WITH_TILES);
    expect(injectTerrainBackground(SVG_WITH_TILES, null)).toContain("fill:#8cb2f2");
  });
});
