import { describe, expect, it } from "vitest";
import { rollTotalDistribution } from "../src/combatOdds.js";

const FACES = [0, 1, 1, 1, 1, 2];

describe("rollTotalDistribution", () => {
  it("nDice=0 is a point mass at 0", () => {
    expect(rollTotalDistribution(FACES, 0)).toEqual([{ total: 0, prob: 1 }]);
  });

  it("one die of [0,1,1,1,1,2]", () => {
    const dist = new Map(rollTotalDistribution(FACES, 1).map((d) => [d.total, d.prob]));
    expect(dist.get(0)).toBeCloseTo(1 / 6, 10);
    expect(dist.get(1)).toBeCloseTo(4 / 6, 10);
    expect(dist.get(2)).toBeCloseTo(1 / 6, 10);
  });

  it("probabilities sum to 1 for two dice", () => {
    const total = rollTotalDistribution(FACES, 2).reduce((s, d) => s + d.prob, 0);
    expect(total).toBeCloseTo(1, 10);
    // sum ranges 0..4
    const totals = rollTotalDistribution(FACES, 2)
      .map((d) => d.total)
      .sort((a, b) => a - b);
    expect(totals[0]).toBe(0);
    expect(totals[totals.length - 1]).toBe(4);
  });
});
