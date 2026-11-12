import { describe, expect, it } from "vitest";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";
import type { Bot } from "../src/types.js";
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
    expect(res.aWins + res.bWins + res.draws).toBe(6);
  });

  it("counts a drawn game as a draw, not a win for B", () => {
    const draw: Bot = {
      chooseCommand: (state, seat) => {
        const pc = state.pendingCombat;
        if (pc) return { type: "combatResolve", pendingId: pc.id };
        void seat;
        return { type: "pass" };
      }
    };
    const res = runMatches(draw, draw, { games: 2, seedPrefix: "draw" });
    expect(res.aWins + res.bWins + res.draws).toBe(2);
    const single = runMatch(draw, draw, { seed: "draw-0" });
    if (single.winner === null) expect(res.draws).toBeGreaterThan(0);
  });

  it("mirrors each seed when seeds are given", () => {
    const mk = () => new RandomBot(createAiRng(7));
    const res = runMatches(mk(), mk(), { seeds: ["m1", "m2", "m3"] });
    expect(res.games).toBe(6);
    expect(res.aWins + res.bWins + res.draws).toBe(6);
  });
});
