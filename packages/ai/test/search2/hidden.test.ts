import { describe, expect, it } from "vitest";
import { createInitialState, createRngState, legalCommandsForState } from "@sengoku-jidai/engine";
import { HIDDEN, grantCard, isRealCard, observe } from "../../src/search2/hidden.js";

const base = () => {
  const s = createInitialState({ gameId: "g", seed: "obs" });
  s.players.red.hand = ["ambush", "mobilise"];
  s.players.black.hand = ["ambush", "commandeer", "ship_strike"];
  return s;
};

describe("observe", () => {
  it("hides the opponent's cards, the deck order and the rng", () => {
    const o = observe(base(), "red");
    expect(o.players.red.hand).toEqual(["ambush", "mobilise"]);
    expect(o.players.black.hand).toEqual([HIDDEN, HIDDEN, HIDDEN]);
    expect(o.deck).toHaveLength(base().deck.length);
    expect(o.deck.every((c) => c === HIDDEN)).toBe(true);
  });

  it("is identical for states that differ only in hidden information", () => {
    const a = base();
    const b = base();
    b.players.black.hand = ["mobilise", "mobilise", "river_assault"];
    b.deck = [...b.deck].reverse();
    b.rngState = createRngState("other");
    expect(observe(a, "red")).toEqual(observe(b, "red"));
  });

  it("does not mutate its input", () => {
    const s = base();
    const before = structuredClone(s);
    observe(s, "red");
    expect(s).toEqual(before);
  });
});

describe("grantCard", () => {
  it("turns one placeholder into a real card", () => {
    const o = observe(base(), "red");
    const g = grantCard(o, "black", "ambush")!;
    expect(g.players.black.hand.filter((c) => c === "ambush")).toHaveLength(1);
    expect(g.players.black.hand).toHaveLength(3);
    expect(o.players.black.hand).toEqual([HIDDEN, HIDDEN, HIDDEN]);
    expect(grantCard(o, "red", "ambush")).toBeNull(); // red's own hand has no placeholders
  });
});

describe("placeholders", () => {
  it("offer the engine no card plays", () => {
    const o = observe(base(), "red");
    expect(legalCommandsForState(o, "black").cardPlays).toEqual([]);
  });

  it("are told apart from real cards", () => {
    expect(isRealCard(HIDDEN)).toBe(false);
    expect(isRealCard("ambush")).toBe(true);
  });
});
