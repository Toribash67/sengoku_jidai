import { describe, expect, it } from "vitest";
import { createAiRng, seedFromString, pick, shuffle } from "../src/rng.js";

describe("AiRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createAiRng(seedFromString("hello"));
    const b = createAiRng(seedFromString("hello"));
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });

  it("shuffle is a permutation and does not mutate input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(createAiRng(42), input);
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it("pick returns an element of the array", () => {
    const arr = ["a", "b", "c"];
    expect(arr).toContain(pick(createAiRng(7), arr));
  });
});
