import { describe, expect, it } from "vitest";
import { createInitialState } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { determinize } from "../src/determinize.js";

function totalCards(state: ReturnType<typeof createInitialState>) {
  const counts: Record<string, number> = {};
  const add = (c: string) => (counts[c] = (counts[c] ?? 0) + 1);
  state.players.red.hand.forEach(add);
  state.players.black.hand.forEach(add);
  state.deck.forEach(add);
  state.discard.forEach(add);
  return counts;
}

describe("determinize", () => {
  it("preserves the seat's own hand and all hand sizes and the full card multiset", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    // Give both players some cards to make the test meaningful.
    s.players.red.hand = ["ambush", "mobilise"];
    s.players.black.hand = ["ground_assault"];
    s.deck = s.deck.slice(3);
    const before = totalCards(s);

    const d = determinize(s, "red", createAiRng(5));
    expect(d.players.red.hand).toEqual(["ambush", "mobilise"]); // own hand untouched
    expect(d.players.black.hand).toHaveLength(1); // opponent hand SIZE preserved
    expect(d.deck).toHaveLength(s.deck.length);
    expect(totalCards(d)).toEqual(before); // conserves the 24-card multiset
  });

  it("does not mutate the input state", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    s.players.black.hand = ["ambush"];
    const deckBefore = [...s.deck];
    determinize(s, "red", createAiRng(1));
    expect(s.deck).toEqual(deckBefore);
    expect(s.players.black.hand).toEqual(["ambush"]);
  });
});
