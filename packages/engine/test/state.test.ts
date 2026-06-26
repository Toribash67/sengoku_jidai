import { describe, expect, it } from "vitest";
import { RIVERS_UNIT_POOL, zeroUnits } from "../src/state.js";

describe("unit state helpers", () => {
  it("zeroUnits returns a fresh all-zero counts object", () => {
    const a = zeroUnits();
    expect(a).toEqual({ troop: 0, ship: 0, siege: 0 });
    a.troop = 5;
    expect(zeroUnits().troop).toBe(0); // each call is independent
  });

  it("defines the Rivers unit pools", () => {
    expect(RIVERS_UNIT_POOL).toEqual({ troop: 25, ship: 10, siege: 0 });
  });
});
