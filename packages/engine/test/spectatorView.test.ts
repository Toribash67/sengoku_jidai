import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { playerEvents, spectatorEvents, spectatorView } from "../src/view.js";
import type { GameEvent } from "../src/commands.js";
import type { GameState } from "../src/state.js";

function game(): GameState {
  const s = createInitialState({ gameId: "g", seed: "seed-S" });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  return s;
}

describe("spectatorView", () => {
  it("hides both hands and reports counts", () => {
    const s = game();
    s.players.red.hand = ["ambush", "mobilise"];
    s.players.black.hand = ["commandeer"];
    const v = spectatorView(s);
    expect(v.spectator).toBe(true);
    expect(v.viewerSeat).toBe("red");
    expect(v.hand).toEqual([]);
    expect(v.handCounts).toEqual({ red: 2, black: 1 });
    expect(v.opponentHandCount).toBe(1);
    expect(v.legal.cardPlays).toEqual([]);
    expect(v.pendingDecision).toBeNull();
    const json = JSON.stringify(v);
    for (const card of ["ambush", "mobilise", "commandeer"]) {
      expect(json).not.toContain(card);
    }
  });

  it("never exposes either seat's pending decision", () => {
    for (const seat of ["red", "black"] as const) {
      const s = game();
      s.pendingDecision = { id: "d1", seat, prompt: "secret prompt", choices: [] };
      const v = spectatorView(s);
      expect(v.pendingDecision).toBeNull();
      expect(v.prompt).toBe(seat === "red" ? "Red is deciding." : "Black is deciding.");
    }
  });

  it("offers no legal actions", () => {
    const v = spectatorView(game());
    expect(v.legal.activeSeat).toBe("red");
    expect(v.legal.canPass).toBe(false);
    expect(v.legal.spaces).toEqual([]);
    expect(v.legal.moves).toEqual([]);
    expect(v.legal.strikes).toEqual([]);
    expect(v.legal.placements).toEqual([]);
    expect(v.legal.plans).toEqual([]);
    expect(v.legal.cardPlays).toEqual([]);
    expect(v.legal.canRollCombat).toBe(false);
    expect(v.legal.canResolveCombat).toBe(false);
    expect(v.legal.canRerollCombat).toBe(false);
    expect(v.legal.canAmbush).toBe(false);
    expect(v.legal.canTakeCover).toBe(false);
    expect(v.legal.siegeAssault).toBeNull();
    expect(v.prompt).toBe("Round 1: Red is giving orders.");
  });

  it("words the prompt for combat, complete and abandoned games", () => {
    for (const seat of ["red", "black"] as const) {
      const s = game();
      const pc = { responsibleSeat: seat, area: "tile1" } as unknown as GameState["pendingCombat"];
      s.pendingCombat = pc;
      const v = spectatorView(s);
      expect(v.prompt).toBe(
        seat === "red" ? "Red is resolving combat." : "Black is resolving combat."
      );
      expect(v.pendingCombat).toEqual(pc);
    }
    const done = game();
    done.status = "complete";
    done.winner = "red";
    expect(spectatorView(done).prompt).toBe("Game over — Red wins.");
    done.winner = "black";
    expect(spectatorView(done).prompt).toBe("Game over — Black wins.");
    done.winner = null;
    expect(spectatorView(done).prompt).toBe("Game over.");
    const gone = game();
    gone.status = "abandoned";
    expect(spectatorView(gone).prompt).toBe("Game abandoned.");
  });

  it("leaks no rng/deck state", () => {
    const json = JSON.stringify(spectatorView(game()));
    expect(json).not.toContain("rngState");
    expect(json).not.toContain("deck");
  });
});

describe("spectatorEvents", () => {
  it("keeps only events visible to both seats", () => {
    const list: GameEvent[] = [
      { type: "passed", seat: "red" },
      { type: "deckPeeked", cards: ["ambush"] } as unknown as GameEvent,
      { type: "passed", seat: "black" }
    ];
    const expected = playerEvents(list, "red").filter(
      (e) => playerEvents([e], "black").length === 1
    );
    expect(expected.length).toBe(2);
    expect(spectatorEvents(list)).toEqual(expected);
  });
});
