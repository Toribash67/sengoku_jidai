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

  it("traces HQ + harbor markers as outlines of the tile shape", () => {
    expect(svg).toContain(`class="hq-outline"`); // tiles A (red) + E (black)
    expect(svg).toContain(`class="harbor-outline"`); // tile D solid outline
    expect(svg).toContain(`class="harbor-outline-dash"`); // tile D dashed hug
    expect(svg).toContain(`class="star"`); // tiles B, C (native star badges)
    expect(svg).toContain(`fill:#ce3485`); // the pink star fill from board.svg
    // The old centered-glyph markers are gone.
    expect(svg).not.toContain(`class="hq-base"`);
    expect(svg).not.toContain(`class="harbor"`);
  });

  it("draws feature outlines that trace an arbitrary (multi-hex) tile shape", () => {
    // An 8-vertex ring proves the marker follows tile.rings, not a fixed 6-vertex hexagon.
    const octagon = [
      { x: -20, y: -10 },
      { x: 0, y: -20 },
      { x: 20, y: -10 },
      { x: 20, y: 10 },
      { x: 0, y: 20 },
      { x: -20, y: 10 },
      { x: -20, y: 0 },
      { x: -20, y: -5 }
    ];
    const tile = {
      id: "HQ",
      kind: "land" as const,
      rings: [octagon],
      centroid: { x: 0, y: 0 },
      authoredFill: "#d5d3c4",
      features: { hq: "red" as const, valueStars: 0 as const, harbor: false, fort: false },
      glyphAnchors: {},
      slots: {},
      ports: []
    };
    const scene = {
      viewBox: { x: -50, y: -50, width: 100, height: 100 },
      tiles: [tile],
      hexGrid: [],
      hexSize: 114
    };
    const out = assembleBoardSvg(scene);
    const d = /<path d="([^"]+)" class="hq-outline"/.exec(out)?.[1] ?? "";
    const vertexCount = (d.match(/[ML]/g) ?? []).length;
    expect(vertexCount).toBe(octagon.length); // 8, not 6 — it traces the real shape
  });

  it("draws a white fort border nested between the base and harbor, with the dash inside the solid", () => {
    const hexRing = [
      { x: -57, y: -33 },
      { x: 0, y: -66 },
      { x: 57, y: -33 },
      { x: 57, y: 33 },
      { x: 0, y: 66 },
      { x: -57, y: 33 }
    ];
    const tile = {
      id: "keep",
      kind: "land" as const,
      rings: [hexRing],
      centroid: { x: 0, y: 0 },
      authoredFill: "#d5d3c4",
      features: { hq: "black" as const, valueStars: 0 as const, harbor: true, fort: true },
      glyphAnchors: {},
      slots: {},
      ports: []
    };
    const scene = {
      viewBox: { x: -120, y: -120, width: 240, height: 240 },
      tiles: [tile],
      hexGrid: [],
      hexSize: 114
    };
    const out = assembleBoardSvg(scene);
    expect(out).toContain(`class="fort-outline"`);
    expect(out).toContain(`stroke:#ffffff`); // fort is white
    expect(out).toContain(`class="hq-outline"`);
    expect(out).toContain(`class="harbor-outline"`);
    expect(out).toContain(`class="harbor-outline-dash"`);
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
