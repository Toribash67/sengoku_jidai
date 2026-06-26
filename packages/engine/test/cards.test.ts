import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import type { GameState } from "../src/state.js";
import { resolveCommand } from "../src/resolve.js";
import { RIVERS_CARD_COPIES, RIVERS_CARDS, RIVERS_DECK } from "../src/cards.js";

function game(): GameState {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  return s;
}

describe("Plan draws cards", () => {
  it("a normal Plan draws 2 cards from the top of the shared deck", () => {
    const s = game();
    const before = [...s.deck];
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toEqual(before.slice(0, 2));
    expect(r.nextState.deck).toHaveLength(22);
    const drew = r.events.find((e) => e.type === "cardsDrawn");
    expect(drew && drew.type === "cardsDrawn" ? drew.count : 0).toBe(2);
  });

  it("the initiative Plan draws only 1 card", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-a" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toHaveLength(1);
    expect(r.nextState.deck).toHaveLength(23);
  });

  it("War Room grants +1 card", () => {
    const s = game();
    s.bonuses = { tile9: "warRoom" }; // red supplies its HQ
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toHaveLength(3); // 2 + 1 War Room
  });

  it("is a shared pile: red's draw is consumed for black too", () => {
    const s = game();
    const before = [...s.deck];
    const r1 = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r1.status).toBe("accepted");
    if (r1.status !== "accepted") return;
    // Black draws next from the SAME pile using plan-a (plan-b is occupied by red).
    // It gets cards starting from where red left off.
    const s2 = r1.nextState;
    s2.initiative = "black";
    s2.activeSeat = "black";
    const r2 = resolveCommand(s2, { seat: "black" }, { type: "plan", spaceId: "plan-a" });
    expect(r2.status).toBe("accepted");
    if (r2.status !== "accepted") return;
    expect(r2.nextState.players.black.hand).toEqual(before.slice(2, 3));
    expect(r2.nextState.deck).toHaveLength(21);
  });
});

describe("RIVERS_DECK", () => {
  it("holds RIVERS_CARD_COPIES (3) copies of every kind, 24 cards total", () => {
    expect(RIVERS_CARD_COPIES).toBe(3);
    expect(RIVERS_DECK).toHaveLength(RIVERS_CARDS.length * RIVERS_CARD_COPIES);
    expect(RIVERS_DECK).toHaveLength(24);
    for (const kind of RIVERS_CARDS) {
      expect(RIVERS_DECK.filter((c) => c === kind)).toHaveLength(RIVERS_CARD_COPIES);
    }
  });
});
