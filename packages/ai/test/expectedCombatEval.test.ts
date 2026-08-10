import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand, legalCommandsForState } from "@sengoku-jidai/engine";
import { evaluate } from "../src/eval.js";
import { RandomBot } from "../src/bots/random.js";
import { createAiRng } from "../src/rng.js";
import { onTheClock } from "../src/onclock.js";

/** Drive with RandomBot until an advance/sail opens a pendingCombat, returning that state
 *  and the responsible/attacker seat. */
function reachPendingCombat() {
  let state = createInitialState({ gameId: "ec", seed: "ec-3" });
  const bot = new RandomBot(createAiRng(3));
  for (let i = 0; i < 4000 && state.status === "active"; i++) {
    const seat = onTheClock(state);
    if (!seat) break;
    // Prefer to CREATE a combat: if a clean deploy turn has an advance into an enemy tile, take it.
    if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
      const legal = legalCommandsForState(state, seat);
      const atk = (legal.moves ?? []).find((m) => {
        const t = state.areas[m.targetAreaId];
        return t && t.owner && t.owner !== seat && t.units.troop + t.units.ship > 0;
      });
      if (atk && atk.sources[0]) {
        const cmd = {
          type: atk.type,
          spaceId: atk.spaceId,
          moves: [{ from: atk.sources[0].areaId, count: atk.sources[0].max }]
        };
        const r = resolveCommand(state, { seat }, cmd);
        if (r.status === "accepted" && r.nextState.pendingCombat) return { state: r.nextState, seat };
        if (r.status === "accepted") {
          state = r.nextState;
          continue;
        }
      }
    }
    const cmd = bot.chooseCommand(state, seat);
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") throw new Error("illegal");
    state = r.nextState;
  }
  throw new Error("no pendingCombat reached");
}

describe("expected-combat evaluation", () => {
  it("matches a Monte-Carlo average of the real engine resolution", () => {
    const { state, seat } = reachPendingCombat();
    const pc = state.pendingCombat!;
    const expected = evaluate(state, seat);

    // Monte-Carlo: resolve the SAME pending combat many times via the public combat commands
    // (no ambush card played), averaging the eval of the resolved board.
    const N = 4000;
    let sum = 0;
    for (let k = 0; k < N; k++) {
      // rngState must be numeric (nextFloat does Number(state)); a non-numeric template like
      // `mc-${k}` coerces to NaN → 0 for every k, collapsing the MC sample to a single die
      // roll. Use a varying numeric seed so each iteration draws independently.
      let s = { ...state, rngState: String(10000 + k) } as typeof state;
      const rolled = resolveCommand(s, { seat: pc.responsibleSeat }, { type: "combatRoll", pendingId: pc.id });
      if (rolled.status !== "accepted") throw new Error("expected combatRoll to be accepted");
      s = rolled.nextState;
      const resolvedRes = resolveCommand(
        s,
        { seat: pc.responsibleSeat },
        { type: "combatResolve", pendingId: pc.id }
      );
      if (resolvedRes.status !== "accepted") throw new Error("expected combatResolve to be accepted");
      sum += evaluate(resolvedRes.nextState, seat);
    }
    const mc = sum / N;
    // Tolerance covers MC sampling error (few distinct outcomes → small variance).
    expect(Math.abs(expected - mc)).toBeLessThan(0.75);
  });
});
