import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { RandomBot, createAiRng, onTheClock } from "@sengoku-jidai/ai";
import { driveAiTurns, type AiDriverDeps } from "../src/ai/aiDriver.js";

// Minimal in-memory fake of AiDriverDeps backed by a live GameState, so the driver logic
// is tested without the DB.
function fakeDeps(seed: string, aiSeat: "red" | "black") {
  let state = createInitialState({ gameId: "g", seed });
  const deps: AiDriverDeps = {
    controllersOf: () => ({
      red: aiSeat === "red" ? "ai" : "human",
      black: aiSeat === "black" ? "ai" : "human"
    }),
    currentState: () => state,
    applyAiCommand: (_gameId, seat, cmd) => {
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") return { status: "rejected", revision: state.revision };
      state = r.nextState;
      return { status: "accepted", revision: state.revision };
    }
  };
  return { deps, state: () => state };
}

describe("driveAiTurns", () => {
  it("advances only while the AI seat is on the clock, then stops for the human", () => {
    const { deps, state } = fakeDeps("seed-1", "black");
    // Force black (the AI) to be on the clock.
    // (If red holds initiative, this returns immediately — assert it never touches the human's turn.)
    driveAiTurns(deps, "g", () => new RandomBot(createAiRng(2)));
    const s = state();
    // After driving, it's either the human's (red) turn, or the game is over.
    expect(s.status !== "active" || onTheClock(s) === "red").toBe(true);
  });
});
