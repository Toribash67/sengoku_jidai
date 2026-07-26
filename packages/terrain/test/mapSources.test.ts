import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { compileHexMap, riversSource } from "@sengoku-jidai/engine";
import { mapStructureSvg, mapSvgPath } from "../src/mapSources.js";

function viewBoxAspect(svg: string): number {
  const vb = svg.match(/viewBox="([\d.\s-]+)"/i)?.[1];
  if (!vb) {
    throw new Error("no viewBox");
  }
  const [, , w, h] = vb.trim().split(/\s+/).map(Number);
  return w! / h!;
}

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

describe("mapStructureSvg", () => {
  it("derives the terrain structure SVG from live board-render geometry", () => {
    const rendered = assembleBoardSvg(buildScene(compileHexMap(riversSource)));
    expect(mapStructureSvg("rivers")).toBe(rendered);
  });

  it("matches the aspect ratio of the board the web actually renders", () => {
    const rendered = assembleBoardSvg(buildScene(compileHexMap(riversSource)));
    // preserveAspectRatio="none" stretches terrain to the board viewBox, so any aspect
    // mismatch here re-introduces the vertical-stretch bug.
    expect(viewBoxAspect(mapStructureSvg("rivers"))).toBeCloseTo(viewBoxAspect(rendered), 5);
  });

  it("no longer inherits the stale committed board.svg aspect", () => {
    const committed = readFileSync(mapSvgPath("rivers"), "utf8");
    // The committed board.svg drifted from the rendered geometry; the terrain source must
    // not track it any more, or the background stretches vertically.
    expect(viewBoxAspect(mapStructureSvg("rivers"))).not.toBeCloseTo(viewBoxAspect(committed), 2);
  });

  it("throws on an unknown map id", () => {
    expect(() => mapStructureSvg("nope")).toThrow(/unknown map/i);
  });
});
