import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { alphaBetaCommand, AlphaBetaBot } from "../src/bots/alphabeta.js";
import { GreedyBot } from "../src/bots/greedy.js";
import { runMatches } from "../src/match.js";

describe("alphaBetaCommand", () => {
  it("returns an engine-accepted command from the opening", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cmd = alphaBetaCommand(s, s.activeSeat, { depth: 3 });
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });

  it("is reproducible at a fixed depth (pure function of state)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-B" });
    const a = alphaBetaCommand(s, s.activeSeat, { depth: 3 });
    const b = alphaBetaCommand(s, s.activeSeat, { depth: 3 });
    expect(a).toEqual(b);
  });

  // Strength validation; slower — runs only with AI_STRENGTH_TESTS=1. Fully deterministic
  // (alpha-beta and greedy are pure; runMatches uses fixed seeds), so the result is stable.
  it.skipIf(!process.env.AI_STRENGTH_TESTS)(
    "depth-3 alpha-beta beats the greedy baseline over a seeded series",
    () => {
      const res = runMatches(new AlphaBetaBot({ depth: 3 }), new GreedyBot(), {
        games: 12,
        seedPrefix: "ab3-vs-greedy-gate"
      });
      expect(res.aWins).toBeGreaterThanOrEqual(9); // ≥75% for alpha-beta(A)
    },
    120_000
  );
});
