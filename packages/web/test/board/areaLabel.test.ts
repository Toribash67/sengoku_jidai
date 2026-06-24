import type { MapArea } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { describeArea } from "../../src/components/board/areaLabel.js";

function area(overrides: Partial<MapArea>): MapArea {
  return {
    id: "tileX",
    kind: "land",
    hq: null,
    valueStars: 0,
    harbor: false,
    shellable: false,
    adjacent: [],
    ports: [],
    ...overrides
  };
}

describe("describeArea", () => {
  it("names HQs by seat", () => {
    expect(describeArea(area({ hq: "red" }))).toBe("Red HQ");
    expect(describeArea(area({ hq: "black" }))).toBe("Black HQ");
  });

  it("labels sea areas", () => {
    expect(describeArea(area({ kind: "sea" }))).toBe("Sea");
  });

  it("prefers harbour over coastal for harbour land", () => {
    expect(describeArea(area({ harbor: true, shellable: true }))).toBe("Harbour");
  });

  it("labels shellable coastal land", () => {
    expect(describeArea(area({ shellable: true }))).toBe("Coastal land");
  });

  it("falls back to inland", () => {
    expect(describeArea(area({}))).toBe("Inland");
  });

  it("never returns the raw id", () => {
    expect(describeArea(area({ id: "tile9", hq: "red" }))).not.toContain("tile");
  });
});
