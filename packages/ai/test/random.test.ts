import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";

describe("RandomBot", () => {
  it("always returns an engine-accepted command", () => {
    const bot = new RandomBot(createAiRng(1));
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cmd = bot.chooseCommand(s, s.activeSeat);
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });
});
