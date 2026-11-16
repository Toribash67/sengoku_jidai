import { describe, expect, it } from "vitest";
import { createInitialState, deckFor, type OperationCard } from "@sengoku-jidai/engine";
import { grantCard, observe } from "../../src/search2/hidden.js";
import { holdProbability, unseenPool } from "../../src/search2/belief.js";

// Rivers: 24 cards, 3 Ambush. Opponent holds n placeholders, nothing else seen.
const obs = (n: number, discard: OperationCard[] = []) => {
  const s = createInitialState({ gameId: "g", seed: "b" });
  s.players.red.hand = [];
  s.players.black.hand = Array<OperationCard>(n).fill("mobilise"); // identities vanish in observe
  s.discard = discard;
  return observe(s, "red");
};
const none = new Set<OperationCard>();

describe("unseenPool", () => {
  it("is the full deck minus every real card in view", () => {
    const s = obs(4, ["ambush"]);
    s.players.red.hand = ["ambush", "mobilise"];
    const pool = unseenPool(s);
    expect(pool.ambush).toBe(1);
    expect(pool.mobilise).toBe(2);
    expect(pool.commandeer).toBe(3);
    expect(Object.values(pool).reduce((a, b) => a + (b ?? 0), 0)).toBe(21);
  });
});

describe("holdProbability", () => {
  it("matches the hypergeometric value", () => {
    // 1 − C(21,4)/C(24,4) = 1 − 5985/10626
    expect(holdProbability(obs(4), "black", "ambush", none)).toBeCloseTo(1 - 5985 / 10626, 10);
  });

  it("rises with hand size", () => {
    const p = [0, 1, 2, 3, 4].map((n) => holdProbability(obs(n), "black", "ambush", none));
    expect(p[0]).toBe(0);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThan(p[i - 1]!);
  });

  it("is 0 once every copy is in the discard pile", () => {
    const s = obs(4, ["ambush", "ambush", "ambush"]);
    expect(holdProbability(s, "black", "ambush", none)).toBe(0);
  });

  it("is 0 for a kind marked absent and 1 for a granted card", () => {
    expect(holdProbability(obs(4), "black", "ambush", new Set(["ambush"]))).toBe(0);
    const granted = grantCard(obs(4), "black", "ambush")!;
    expect(holdProbability(granted, "black", "ambush", none)).toBe(1);
  });

  it("is 0 for a card that is not in this ruleset's deck", () => {
    expect(holdProbability(obs(4), "black", "take_cover", none)).toBe(0);
  });

  it("never returns NaN when the hand is larger than what is unseen", () => {
    const s = obs(4);
    s.discard = deckFor("rivers").slice(0, 22) as OperationCard[]; // 2 unseen, 4 placeholders
    const p = holdProbability(s, "black", "ambush", none);
    expect(Number.isNaN(p)).toBe(false);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
