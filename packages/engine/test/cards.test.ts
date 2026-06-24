import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import type { GameState } from "../src/state.js";
import { resolveCommand } from "../src/resolve.js";

function game(): GameState {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  return s;
}

describe("Plan draws cards", () => {
  it("a normal Plan draws 2 cards from the top of the deck", () => {
    const s = game();
    const before = [...s.players.red.deck];
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toEqual(before.slice(0, 2));
    expect(r.nextState.players.red.deck).toHaveLength(6);
    const drew = r.events.find((e) => e.type === "cardsDrawn");
    expect(drew && drew.type === "cardsDrawn" ? drew.count : 0).toBe(2);
  });

  it("the initiative Plan draws only 1 card", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-a" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toHaveLength(1);
    expect(r.nextState.players.red.deck).toHaveLength(7);
  });

  it("War Room grants +1 card", () => {
    const s = game();
    s.bonuses = { tile9: "warRoom" }; // red supplies its HQ
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toHaveLength(3); // 2 + 1 War Room
  });

  it("reshuffles the discard pile into the deck when the deck runs short", () => {
    const s = game();
    s.players.red.deck = ["ambush"];
    s.players.red.discard = ["mobilise", "commandeer"];
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" }); // draw 2
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // Drew "ambush", then deck empty -> reshuffle the 2 discards -> draw 1 more.
    expect(r.nextState.players.red.hand).toHaveLength(2);
    expect(r.nextState.players.red.deck).toHaveLength(1);
    expect(r.nextState.players.red.discard).toHaveLength(0);
  });
});
