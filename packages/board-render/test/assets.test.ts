import { describe, it, expect } from "vitest";
import {
  ASSETS,
  armyGlyph,
  hqGlyph,
  shipGlyph,
  bonusTypeGlyph,
  orderGlyphArt,
  ORDER_TOKEN_RADIUS
} from "../src/assets.js";
import type { OrderKind } from "../src/assets.js";
import type { BonusType } from "@sengoku-jidai/engine";

describe("ASSETS.defs", () => {
  it("declares a symbol for every glyph id + the stripe patterns", () => {
    for (const id of [
      "unit-army-red",
      "unit-army-black",
      "unit-ship-red",
      "unit-ship-black",
      "glyph-hq-red",
      "glyph-hq-black",
      "glyph-star",
      "glyph-harbor"
    ]) {
      expect(ASSETS.defs).toContain(`id="${id}"`);
    }
    expect(ASSETS.defs).toContain(`id="stripe-red"`);
    expect(ASSETS.defs).toContain(`id="stripe-black"`);
    expect(ASSETS.defs).toContain(`id="stripe-source"`);
  });
});

describe("ASSETS.place", () => {
  it("emits a translated <use> of the requested glyph", () => {
    const out = ASSETS.place("glyph-star", { x: 10, y: 20 });
    expect(out).toContain(`href="#glyph-star"`);
    expect(out).toContain(`translate(10 20)`);
  });
});

describe("glyph selectors", () => {
  it("map seat -> glyph id", () => {
    expect(armyGlyph("red")).toBe("unit-army-red");
    expect(shipGlyph("black")).toBe("unit-ship-black");
    expect(hqGlyph("red")).toBe("glyph-hq-red");
  });
});

describe("bonusTypeGlyph", () => {
  const ALL: BonusType[] = [
    "barracks",
    "warRoom",
    "pirateHaven",
    "shipyard",
    "hiddenBase",
    "armoury"
  ];

  it("maps every bonus type to a distinct badge symbol that exists in defs", () => {
    const ids = ALL.map(bonusTypeGlyph);
    expect(new Set(ids).size).toBe(ALL.length);
    for (const id of ids) {
      expect(ASSETS.defs).toContain(`id="${id}"`);
    }
  });

  it("bakes a generic marker symbol for game-less contexts", () => {
    expect(ASSETS.defs).toContain(`id="glyph-bonus-generic"`);
  });
});

describe("orderGlyphArt", () => {
  const KINDS: OrderKind[] = ["move", "sail", "bombard", "shell"];

  it("returns distinct standalone art for each order kind", () => {
    const inners = KINDS.map((k) => orderGlyphArt(k).inner);
    expect(new Set(inners).size).toBe(KINDS.length);
  });

  it("re-centres each token at the origin so it renders in its own viewBox", () => {
    // The board keeps the token art at board coordinates (~490,-403 for move);
    // the standalone glyph must translate it back onto (0,0) or it renders off-screen.
    for (const kind of KINDS) {
      const { inner } = orderGlyphArt(kind);
      expect(inner).toContain("translate(");
    }
  });

  it("applies the board's 180° flip so the glyph renders upright, not inverted", () => {
    // board.svg authors the token art upside down; assemble.ts places every token inside
    // rotate(180) (see slotAnchors). The standalone glyph must do the same or it shows
    // inverted relative to the tile.
    for (const kind of KINDS) {
      const { inner } = orderGlyphArt(kind);
      expect(inner).toContain("rotate(180)");
    }
  });

  it("keeps both the black hex and its white icon in every kind", () => {
    for (const kind of KINDS) {
      const { inner } = orderGlyphArt(kind);
      expect(inner).toContain("fill:#000000"); // the hex token
      expect(inner).toMatch(/fill:#(ffffff|fefefe|e8e8e8)/i); // the white icon
    }
  });

  it("frames the token with a symmetric viewBox large enough to contain it", () => {
    const { viewBox } = orderGlyphArt("move");
    const parts = viewBox.split(/\s+/).map(Number);
    expect(parts).toHaveLength(4);
    const [minX, minY, w, h] = parts as [number, number, number, number];
    expect(minX).toBe(-w / 2); // centred on origin
    expect(minY).toBe(-h / 2);
    expect(w / 2).toBeGreaterThanOrEqual(ORDER_TOKEN_RADIUS); // token fits
  });
});
