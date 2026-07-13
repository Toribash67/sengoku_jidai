import { describe, expect, it } from "vitest";
import { diceKey, randomFaces, shouldTumble } from "./diceReveal.js";

describe("diceKey", () => {
  it("is null when there are no rolled values yet", () => {
    expect(diceKey(undefined)).toBeNull();
  });
  it("is a stable string for a set of faces", () => {
    expect(diceKey([4, 2, 6])).toBe("4,2,6");
  });
  it("distinguishes different faces (so a reroll re-animates)", () => {
    expect(diceKey([4, 2])).not.toBe(diceKey([2, 4]));
  });
});

describe("shouldTumble", () => {
  const base = { seenBefore: true, reducedMotion: false, prevKey: null, nextKey: "4,2" };

  it("tumbles when a fresh roll arrives after awaiting (null -> faces)", () => {
    expect(shouldTumble(base)).toBe(true);
  });

  it("tumbles on a reroll (faces -> different faces)", () => {
    expect(shouldTumble({ ...base, prevKey: "4,2", nextKey: "5,1" })).toBe(true);
  });

  it("does not tumble before any dice are rolled (nextKey null)", () => {
    expect(shouldTumble({ ...base, prevKey: null, nextKey: null })).toBe(false);
  });

  it("does not tumble on first observation (page loaded mid-combat)", () => {
    expect(shouldTumble({ ...base, seenBefore: false })).toBe(false);
  });

  it("does not tumble when the reduced-motion preference is set", () => {
    expect(shouldTumble({ ...base, reducedMotion: true })).toBe(false);
  });

  it("does not re-tumble when the faces are unchanged (idempotent re-render)", () => {
    expect(shouldTumble({ ...base, prevKey: "4,2", nextKey: "4,2" })).toBe(false);
  });
});

describe("randomFaces", () => {
  it("returns the requested number of faces", () => {
    expect(randomFaces(3, () => 0)).toHaveLength(3);
  });
  it("maps the rng across the 1-6 range", () => {
    expect(randomFaces(2, () => 0)).toEqual([1, 1]);
    expect(randomFaces(2, () => 0.999)).toEqual([6, 6]);
  });
});
