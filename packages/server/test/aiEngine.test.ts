import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { loadConfig } from "../src/config.js";
import { aiCommandPicker } from "../src/ai/aiEngine.js";

describe("choosing the AI engine", () => {
  it("defaults to the deployed bot with the hand-set weights", () => {
    const config = loadConfig({});
    expect(config.aiBot).toBe("alphabeta");
    expect(config.aiWeights).toBe("default");
  });

  it("reads AI_BOT and AI_WEIGHTS", () => {
    const config = loadConfig({ AI_BOT: "expecti", AI_WEIGHTS: "tuned" });
    expect(config.aiBot).toBe("expecti");
    expect(config.aiWeights).toBe("tuned");
  });

  it("rejects an unknown bot or weight set", () => {
    expect(() => loadConfig({ AI_BOT: "stockfish" })).toThrow();
    expect(() => loadConfig({ AI_WEIGHTS: "vibes" })).toThrow();
  });

  for (const bot of ["alphabeta", "expecti"] as const) {
    for (const weights of ["default", "tuned"] as const) {
      it(`${bot} with ${weights} weights returns a legal opening command`, async () => {
        const state = createInitialState({ gameId: "engine", seed: "engine" });
        const seat = state.activeSeat;
        const cmd = await aiCommandPicker({ bot, weights })(state, seat, 200);
        expect(resolveCommand(state, { seat }, cmd).status).toBe("accepted");
      });
    }
  }
});
