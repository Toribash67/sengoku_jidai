import { describe, expect, it } from "vitest";
import { createRngState, nextFloat, rollDie, shuffle, DEFAULT_DICE_FACES } from "./rng.js";

describe("rng", () => {
  it("derives a stable state string from a seed", () => {
    expect(createRngState("seed")).toBe(createRngState("seed"));
    expect(createRngState("a")).not.toBe(createRngState("b"));
  });

  it("produces a deterministic, advancing float stream", () => {
    const s0 = createRngState("seed");
    const a = nextFloat(s0);
    const b = nextFloat(a.state);
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThan(1);
    expect(a.state).not.toBe(s0); // state advanced
    // same start state reproduces the same value
    expect(nextFloat(s0).value).toBe(a.value);
    expect(b.value).not.toBe(a.value);
  });

  it("rolls dice from the configured faces", () => {
    let state = createRngState("dice");
    const counts = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const r = rollDie(state, DEFAULT_DICE_FACES);
      state = r.state;
      counts.set(r.value, (counts.get(r.value) ?? 0) + 1);
    }
    // only the configured face values ever appear
    for (const v of counts.keys()) expect(DEFAULT_DICE_FACES).toContain(v);
    // 0,1,2 all appear given the [0,1,1,1,1,2] distribution
    expect(counts.get(0)).toBeGreaterThan(0);
    expect(counts.get(1)).toBeGreaterThan(0);
    expect(counts.get(2)).toBeGreaterThan(0);
  });

  it("shuffles deterministically without losing elements", () => {
    const s0 = createRngState("shuffle");
    const input = [1, 2, 3, 4, 5];
    const r1 = shuffle(s0, input);
    const r2 = shuffle(s0, input);
    expect(r1.value).toEqual(r2.value); // same seed -> same order
    expect([...r1.value].sort((x, y) => x - y)).toEqual(input); // permutation
    expect(input).toEqual([1, 2, 3, 4, 5]); // input not mutated
  });
});
