import { describe, it, expect } from "vitest";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { buildScene } from "../src/scene.js";
import { mapThumbnailSvg } from "../src/assemble.js";

const scene = buildScene(compileHexMap(FIXTURE_HEX_MAP));
const svg = mapThumbnailSvg(scene);

describe("mapThumbnailSvg", () => {
  it("is a single well-formed <svg> carrying the scene viewBox", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    const { x, y, width, height } = scene.viewBox;
    expect(svg).toContain(`viewBox="${x} ${y} ${width} ${height}"`);
  });

  it("fills land and sea tiles with the flat-terrain colours", () => {
    expect(svg).toContain("#d5d3c4"); // land
    expect(svg).toContain("#8cb2f2"); // sea
  });

  it("draws one polygon per tile and nothing else — no features, glyphs, or order slots", () => {
    const paths = svg.match(/<path/g) ?? [];
    expect(paths).toHaveLength(scene.tiles.length); // 5 tiles A–E
    // A simplified land/sea preview: none of the board's feature/token machinery.
    expect(svg).not.toContain("<use");
    expect(svg).not.toContain("order-art");
    expect(svg).not.toContain("glyph-hq");
    expect(svg).not.toContain('class="star"');
    expect(svg).not.toContain("hq-outline");
    expect(svg).not.toContain("harbor-outline");
  });
});
