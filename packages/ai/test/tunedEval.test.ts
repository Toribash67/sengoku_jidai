import { describe, expect, it } from "vitest";
import { createInitialState, type GameState, type OperationCard } from "@sengoku-jidai/engine";
import { evaluate, DEFAULT_WEIGHTS, TUNED_WEIGHTS } from "../src/eval.js";
import { parseBotSpec } from "../src/botRegistry.js";

function withHand(state: GameState, cards: OperationCard[]): GameState {
  return { ...state, players: { ...state.players, red: { ...state.players.red, hand: cards } } };
}

describe("tuned (per-round) weights", () => {
  const start = createInitialState({ gameId: "tuned", seed: "tuned" });

  it("is antisymmetric between the seats", () => {
    expect(evaluate(start, "red", TUNED_WEIGHTS)).toBeCloseTo(
      -evaluate(start, "black", TUNED_WEIGHTS),
      9
    );
  });

  it("values the first card at that round's card weight", () => {
    for (const round of [1, 2, 3, 4]) {
      const base = withHand({ ...start, round }, []);
      const one = withHand(base, ["ambush"]);
      const gain = evaluate(one, "red", TUNED_WEIGHTS) - evaluate(base, "red", TUNED_WEIGHTS);
      expect(gain).toBeCloseTo(TUNED_WEIGHTS.byRound![round - 1]!.card, 9);
    }
  });

  it("values a card more than the hand-set weights do, from round 2 on", () => {
    const base = withHand({ ...start, round: 2 }, []);
    const one = withHand(base, ["ambush"]);
    const tuned = evaluate(one, "red", TUNED_WEIGHTS) - evaluate(base, "red", TUNED_WEIGHTS);
    const legacy = evaluate(one, "red", DEFAULT_WEIGHTS) - evaluate(base, "red", DEFAULT_WEIGHTS);
    expect(tuned).toBeGreaterThan(legacy);
  });

  it("uses the last round's weights beyond the table", () => {
    const late = withHand({ ...start, round: 9 }, ["ambush"]);
    const four = withHand({ ...start, round: 4 }, ["ambush"]);
    expect(evaluate(late, "red", TUNED_WEIGHTS)).toBeCloseTo(
      evaluate(four, "red", TUNED_WEIGHTS),
      9
    );
  });

  it("leaves the hand-set weights untouched", () => {
    expect(DEFAULT_WEIGHTS.byRound).toBeUndefined();
  });

  it("still scores a finished game as a win or loss", () => {
    const won: GameState = { ...start, status: "complete", winner: "red" };
    expect(evaluate(won, "red", TUNED_WEIGHTS)).toBe(TUNED_WEIGHTS.terminal);
    expect(evaluate(won, "black", TUNED_WEIGHTS)).toBe(-TUNED_WEIGHTS.terminal);
  });
});

describe("bot specs with weights", () => {
  it("accepts weights=tuned for the searching bots", () => {
    expect(parseBotSpec("expecti:depth=1,weights=tuned").name).toBe("expecti");
    expect(parseBotSpec("alphabeta:depth=1,weights=tuned").name).toBe("alphabeta");
    expect(parseBotSpec("alphabeta:depth=1,weights=default").name).toBe("alphabeta");
  });

  it("rejects an unknown weight set", () => {
    expect(() => parseBotSpec("expecti:weights=vibes")).toThrow(/weights/);
  });
});
