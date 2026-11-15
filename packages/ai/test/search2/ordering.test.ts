import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand, type GameState } from "@sengoku-jidai/engine";
import { parseBotSpec } from "../../src/botRegistry.js";
import { ExpectiBot } from "../../src/bots/expecti.js";
import { GreedyBot } from "../../src/bots/greedy.js";
import { TUNED_WEIGHTS } from "../../src/eval.js";
import { onTheClock } from "../../src/onclock.js";
import type { SeatId } from "../../src/types.js";

/** Quiet positions a few moves into greedy games. */
function positions(): { state: GameState; seat: SeatId }[] {
  const greedy = new GreedyBot();
  const out: { state: GameState; seat: SeatId }[] = [];
  for (const seed of ["order-1", "order-2"]) {
    for (const plies of [3, 11, 19]) {
      let state = createInitialState({ gameId: "order", seed });
      const busy = (s: GameState) => Boolean(s.pendingCombat || s.pendingDecision);
      for (let i = 0; (i < plies || busy(state)) && state.status === "active"; i++) {
        const seat = onTheClock(state)!;
        const r = resolveCommand(state, { seat }, greedy.chooseCommand(state, seat));
        if (r.status !== "accepted") throw new Error("setup move rejected");
        state = r.nextState;
      }
      const seat = onTheClock(state);
      if (seat && state.status === "active") out.push({ state, seat });
    }
  }
  return out;
}

describe("move-ordering memory", () => {
  it("changes how fast the search runs, never what it chooses", () => {
    const exact = { reductions: false };
    const withMemory = new ExpectiBot({ depth: 3, weights: TUNED_WEIGHTS, features: exact });
    const without = new ExpectiBot({
      depth: 3,
      weights: TUNED_WEIGHTS,
      features: { ...exact, orderMemory: false }
    });
    const ps = positions();
    expect(ps.length).toBeGreaterThan(3);
    for (const { state, seat } of ps) {
      expect(withMemory.chooseCommand(state, seat)).toEqual(without.chooseCommand(state, seat));
    }
  });
});

describe("reduced search of late options", () => {
  it("leaves a search too shallow to reduce untouched", () => {
    const on = new ExpectiBot({ depth: 2, weights: TUNED_WEIGHTS });
    const off = new ExpectiBot({
      depth: 2,
      weights: TUNED_WEIGHTS,
      features: { reductions: false }
    });
    for (const { state, seat } of positions()) {
      expect(on.chooseCommand(state, seat)).toEqual(off.chooseCommand(state, seat));
    }
  });

  it("can be switched off from a bot spec, together with the ordering memory", () => {
    expect(() => parseBotSpec("expecti:depth=1,off=reductions+orderMemory").make()).not.toThrow();
  });
});
