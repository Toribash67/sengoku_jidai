import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import type { SeatId } from "@sengoku-jidai/engine";
import { RandomBot, createAiRng, onTheClock } from "@sengoku-jidai/ai";
import { driveAiTurns, type AiDriverDeps } from "../src/ai/aiDriver.js";

// Minimal in-memory fake of AiDriverDeps backed by a live GameState, so the driver logic
// is tested without the DB. The AI seat is derived from whoever holds initiative for the
// given seed, so the fake always exercises a real AI turn rather than accidentally
// starting with a human on the clock.
function fakeDeps(seed: string) {
  let state = createInitialState({ gameId: "g", seed });
  const aiSeat = onTheClock(state)!; // whoever moves first IS the AI
  const human: SeatId = aiSeat === "red" ? "black" : "red";
  const deps: AiDriverDeps = {
    controllersOf: () => ({ [aiSeat]: "ai", [human]: "human" }) as Record<SeatId, "human" | "ai">,
    currentState: () => state,
    applyAiCommand: (_gameId, seat, cmd) => {
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") return { status: "rejected", revision: state.revision };
      state = r.nextState;
      return { status: "accepted", revision: state.revision };
    }
  };
  return { deps, aiSeat, human, get: () => state };
}

describe("driveAiTurns", () => {
  it("drives the AI seat's turn(s) then stops for the human (or game over)", () => {
    const f = fakeDeps("seed-1");
    const startRev = f.get().revision;
    driveAiTurns(f.deps, "g", () => new RandomBot(createAiRng(2)));
    const s = f.get();
    expect(s.revision).toBeGreaterThan(startRev); // AI actually moved >= 1 step
    // After driving, it's either the human's turn, or the game is over.
    expect(s.status !== "active" || onTheClock(s) === f.human).toBe(true);
  });
});
