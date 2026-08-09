import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { chooseCommandIsmcts, IsmctsBot } from "../src/ismcts.js";
import { GreedyBot } from "../src/bots/greedy.js";
import { runMatches } from "../src/match.js";

describe("chooseCommandIsmcts", () => {
  it("returns an engine-accepted command", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cmd = chooseCommandIsmcts(s, s.activeSeat, { iterations: 50, rng: createAiRng(1) });
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });

  it("is reproducible for a fixed seed + iteration count", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const a = chooseCommandIsmcts(s, s.activeSeat, { iterations: 80, rng: createAiRng(7) });
    const b = chooseCommandIsmcts(s, s.activeSeat, { iterations: 80, rng: createAiRng(7) });
    expect(a).toEqual(b);
  });

  // Strength/win-rate validation; slow (~12 min) — runs only with AI_STRENGTH_TESTS=1.
  it.skipIf(!process.env.AI_STRENGTH_TESTS)(
    "beats the greedy baseline over a seeded series",
    () => {
      const ismcts = new IsmctsBot({ iterations: 120, seed: "ai" });
      const greedy = new GreedyBot();
      const res = runMatches(ismcts, greedy, { games: 12, seedPrefix: "mcts-vs-greedy" });
      expect(res.aWins).toBeGreaterThanOrEqual(8); // ≥~65% for ISMCTS(A)
    }
  );
});
