import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";
import { GreedyBot, greedyCommand } from "../src/bots/greedy.js";
import { runMatches } from "../src/match.js";

describe("GreedyBot", () => {
  it("returns an engine-accepted command", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cmd = greedyCommand(s, s.activeSeat);
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });

  it("is deterministic (same state -> same command)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(greedyCommand(s, s.activeSeat)).toEqual(greedyCommand(s, s.activeSeat));
  });

  it("beats RandomBot by a wide margin over a seeded series", () => {
    const greedy = new GreedyBot();
    const random = new RandomBot(createAiRng(99));
    const res = runMatches(greedy, random, { games: 20, seedPrefix: "g-vs-r" });
    expect(res.aWins).toBeGreaterThanOrEqual(15); // ≥75% for greedy(A)
  });
});
