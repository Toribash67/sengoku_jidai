import { describe, it, expect } from "vitest";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { buildScene } from "../src/scene.js";
import { assembleBoardSvg } from "../src/assemble.js";

const svg = assembleBoardSvg(buildScene(compileHexMap(FIXTURE_HEX_MAP)));

describe("assembleBoardSvg", () => {
  it("is a single well-formed <svg> with a viewBox", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("viewBox=");
  });

  it("splits tiles into #tile-sea and #tile-land groups with a path per area", () => {
    expect(svg).toContain(`id="tile-sea"`);
    expect(svg).toContain(`id="tile-land"`);
    // land tiles A,B,D,E and sea tile C each get an id'd path
    for (const id of ["A", "B", "C", "D", "E"]) {
      expect(svg).toMatch(new RegExp(`<path[^>]*id="${id}"`));
    }
  });

  it("includes the asset defs + stripe patterns", () => {
    expect(svg).toContain(`id="glyph-hq-red"`);
    expect(svg).toContain(`id="stripe-red"`);
  });

  it("places HQ / star / harbor glyphs for the featured tiles", () => {
    expect(svg).toContain(`href="#glyph-hq-red"`); // tile A
    expect(svg).toContain(`href="#glyph-hq-black"`); // tile E
    expect(svg).toContain(`href="#glyph-star"`); // tiles B, C
    expect(svg).toContain(`href="#glyph-harbor"`); // tile D
  });

  it("emits invisible order-slot anchors at the slotIdForSpace ids", () => {
    for (const id of ["move-A", "move-B", "shell-B", "sail-C", "bombard-C", "move-D", "move-E"]) {
      expect(svg).toContain(`id="${id}"`);
    }
  });

  it("emits the hidden hex-grid layer", () => {
    expect(svg).toMatch(/class="hex-grid"[^>]*display:none/);
  });

  it("matches the committed snapshot", () => {
    expect(svg).toMatchSnapshot();
  });
});
