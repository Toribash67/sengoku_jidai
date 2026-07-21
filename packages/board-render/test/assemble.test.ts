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

  it("places HQ / star / harbor markers for the featured tiles", () => {
    // HQ base + harbor are the artist's tile-sized hex outlines drawn verbatim at native scale.
    expect(svg).toContain(`class="hq-base"`); // tiles A (red) + E (black)
    expect(svg).toContain(`stroke:#e02d2d`); // red HQ base (tile A), colour in the path style
    expect(svg).toContain(`class="harbor"`); // tile D (concentric solid + dashed hexes)
    expect(svg).toContain(`class="star"`); // tiles B, C (native star badges)
    expect(svg).toContain(`fill:#ce3485`); // the pink star fill from board.svg
  });

  it("emits invisible order-slot anchors at the slotIdForSpace ids", () => {
    for (const id of ["move-A", "move-B", "shell-B", "sail-C", "bombard-C", "move-D", "move-E"]) {
      expect(svg).toContain(`id="${id}"`);
    }
  });

  it("draws the board.svg order-symbol art on every slot", () => {
    // One visible token per order slot: land→move (A,B,D,E), shellable land→shell (B),
    // sea→sail+bombard (C). Each token is a def instantiated with a <use> per slot.
    const uses = (kind: string) =>
      (svg.match(new RegExp(`<use href="#order-art-${kind}"`, "g")) ?? []).length;
    expect(svg).toContain(`id="order-art-move"`);
    expect(uses("move")).toBe(4);
    expect(uses("shell")).toBe(1);
    expect(uses("sail")).toBe(1);
    expect(uses("bombard")).toBe(1);
    expect(svg).toContain("M 63.45577,37.504402"); // the artist's token hex path from board.svg
    // board.svg places every order group inside rotate(180,...) — the def art is authored
    // upside down, so each placed token must carry the same 180° spin about its centre.
    expect(svg).toMatch(/<use href="#order-art-move"[^>]*rotate\(180\)/);
    // Symbols are board art and must never intercept tile clicks.
    expect(svg).toMatch(/id="order-slots"[^>]*pointer-events="none"/);
  });

  it("emits the hidden hex-grid layer", () => {
    expect(svg).toMatch(/class="hex-grid"[^>]*display:none/);
  });

  it("bakes a generic bonus marker on each slot tile, tagged for runtime retargeting", () => {
    expect(svg).toContain(`class="bonus-marker" data-area="B"`);
    expect(svg).toContain(`href="#glyph-bonus-generic"`);
  });

  it("matches the committed snapshot", () => {
    expect(svg).toMatchSnapshot();
  });
});
