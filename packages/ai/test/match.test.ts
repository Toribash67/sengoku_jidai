import { describe, expect, it } from "vitest";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";
import { runMatch, runMatches } from "../src/match.js";

describe("runMatch", () => {
  it("plays RandomBot vs RandomBot to a decisive, reproducible result", () => {
    const mk = () => new RandomBot(createAiRng(123));
    const a = runMatch(mk(), mk(), { seed: "match-1" });
    const b = runMatch(mk(), mk(), { seed: "match-1" });
    expect(a.winner).not.toBeNull();
    expect(a.commands).toBeGreaterThan(0);
    expect(a).toEqual(b); // deterministic given seed + bot seeds
  });

  it("runMatches aggregates a series without throwing", () => {
    const res = runMatches(new RandomBot(createAiRng(1)), new RandomBot(createAiRng(2)), {
      games: 6,
      seedPrefix: "series"
    });
    expect(res.games).toBe(6);
    expect(res.aWins + res.bWins).toBe(6);
  });
});
