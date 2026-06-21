import { describe, expect, it } from "vitest";
import {
  SEAT_SOLID,
  TILE_LAND_FILL,
  TILE_SEA_FILL,
  tileFill
} from "../../src/components/board/tileFill.js";

describe("tileFill", () => {
  it("uses the solid seat colour when controlled and supplied", () => {
    expect(tileFill({ kind: "land", owner: "red", suppliedBy: "red" })).toBe(SEAT_SOLID.red);
    expect(tileFill({ kind: "sea", owner: "black", suppliedBy: "black" })).toBe(SEAT_SOLID.black);
  });

  it("uses the stripe pattern when controlled but out of supply", () => {
    expect(tileFill({ kind: "land", owner: "black", suppliedBy: null })).toBe("url(#stripe-black)");
  });

  it("uses the owner's stripe even if supplied by the enemy", () => {
    expect(tileFill({ kind: "land", owner: "red", suppliedBy: "black" })).toBe("url(#stripe-red)");
  });

  it("uses the kind default colour when unowned", () => {
    expect(tileFill({ kind: "land", owner: null, suppliedBy: null })).toBe(TILE_LAND_FILL);
    expect(tileFill({ kind: "sea", owner: null, suppliedBy: null })).toBe(TILE_SEA_FILL);
  });
});
