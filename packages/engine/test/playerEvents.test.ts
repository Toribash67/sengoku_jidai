import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { resolveCommand } from "../src/resolve.js";
import { playerEvents, playerView } from "../src/view.js";
import type { GameEvent } from "../src/commands.js";
import type { GameState } from "../src/state.js";

function game(): GameState {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  return s;
}

describe("playerEvents per-seat projection", () => {
  it("passes public events through unchanged for both seats", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(playerEvents(r.events, "red")).toEqual(r.events);
    expect(playerEvents(r.events, "black")).toEqual(r.events);
  });

  it("drops event types that are not explicitly marked public (fail closed)", () => {
    const secret = { type: "deckPeeked", cards: ["ambush"] } as unknown as GameEvent;
    const passed: GameEvent = { type: "passed", seat: "red" };
    expect(playerEvents([passed, secret], "red")).toEqual([passed]);
  });

  it("card draw events never reveal which cards were drawn", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    const drawn = r.nextState.players.red.hand;
    expect(drawn.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(playerEvents(r.events, "black"));
    for (const card of drawn) {
      expect(serialized).not.toContain(card);
    }
  });
});

describe("playerView hides hidden information", () => {
  it("never includes the opponent's hand cards", () => {
    const s = game();
    s.deck = [];
    s.discard = [];
    s.players.red.hand = [];
    s.players.black.hand = ["ambush"];
    const view = playerView(s, "red");
    expect(JSON.stringify(view)).not.toContain("ambush");
    expect(view.opponentHandCount).toBe(1);
  });

  it("never includes deck order", () => {
    const s = game();
    s.players.red.hand = [];
    s.players.black.hand = [];
    s.discard = [];
    s.deck = ["ambush"];
    expect(JSON.stringify(playerView(s, "red"))).not.toContain("ambush");
  });
});
