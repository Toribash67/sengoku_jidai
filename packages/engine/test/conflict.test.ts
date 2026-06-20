import { describe, expect, it } from "vitest";
import { resolveConflict } from "../src/conflict.js";

// All-1 faces make the defence roll deterministic (=1) for arithmetic assertions.
const ONES = [1, 1, 1, 1, 1, 1];

describe("resolveConflict", () => {
  it("defence removes attackers, then attrition removes one-for-one", () => {
    const r = resolveConflict("123", ONES, 5, 3);
    expect(r.defenceRoll).toBe(1);
    // after defence: 4 attackers vs 3 defenders; attrition removes 3 each -> 1 vs 0.
    expect(r.attackersLeft).toBe(1);
    expect(r.defendersLeft).toBe(0);
    expect(r.attackerLosses).toBe(4); // 1 defence + 3 attrition
    expect(r.defenderLosses).toBe(3);
  });

  it("defender survives when attackers run out", () => {
    const r = resolveConflict("123", ONES, 3, 5);
    // after defence: 2 vs 5; attrition removes 2 each -> 0 vs 3.
    expect(r.attackersLeft).toBe(0);
    expect(r.defendersLeft).toBe(3);
  });

  it("a tie empties both sides", () => {
    const r = resolveConflict("123", ONES, 4, 3);
    // after defence: 3 vs 3; attrition -> 0 vs 0.
    expect(r.attackersLeft).toBe(0);
    expect(r.defendersLeft).toBe(0);
  });

  it("no attrition when defence wipes the attackers", () => {
    const big = [9, 9, 9, 9, 9, 9];
    const r = resolveConflict("123", big, 2, 4);
    expect(r.attackersLeft).toBe(0);
    expect(r.defendersLeft).toBe(4);
    expect(r.attackerLosses).toBe(2);
    expect(r.defenderLosses).toBe(0);
  });

  it("advances the rng state", () => {
    const r = resolveConflict("123", ONES, 1, 1);
    expect(r.rngState).not.toBe("123");
  });
});
