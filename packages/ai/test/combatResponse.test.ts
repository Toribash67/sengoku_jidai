import { describe, expect, it } from "vitest";
import {
  createInitialState,
  resolveCommand,
  legalCommandsForState,
  getMap
} from "@sengoku-jidai/engine";
import { combatResponse } from "../src/heuristics.js";
import { evaluate } from "../src/eval.js";
import { alphaBetaCommand } from "../src/bots/alphabeta.js";
import { greedyCommand } from "../src/bots/greedy.js";
import { onTheClock } from "../src/onclock.js";

type State = ReturnType<typeof createInitialState>;

/** Unwrap an accepted command result's next state (throws if the command was rejected). */
function nx(r: ReturnType<typeof resolveCommand>): State {
  if (r.status !== "accepted") throw new Error("command rejected");
  return r.nextState;
}

/** Drive greedy self-games and collect `awaiting-roll` LAND-advance combats (where Ambush is
 *  legal), with "ambush" forced into the defender's hand. */
function collectDefenceWithAmbush(n: number): { state: State; seat: "red" | "black" }[] {
  const out: { state: State; seat: "red" | "black" }[] = [];
  for (let g = 0; g < 40 && out.length < n; g++) {
    let state = createInitialState({ gameId: `cr${g}`, seed: `cr-${g}` });
    for (let i = 0; i < 4000 && state.status === "active" && out.length < n; i++) {
      const seat = onTheClock(state);
      if (!seat) break;
      // Force a land advance into an enemy tile when one is available, to open a defence combat.
      if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
        const atk = (legalCommandsForState(state, seat).moves ?? []).find((m) => {
          const t = state.areas[m.targetAreaId];
          return m.type === "advance" && t && t.owner && t.owner !== seat && t.units.troop > 0;
        });
        if (atk && atk.sources[0]) {
          const r = resolveCommand(
            state,
            { seat },
            {
              type: "advance",
              spaceId: atk.spaceId,
              moves: [{ from: atk.sources[0].areaId, count: atk.sources[0].max }]
            }
          );
          if (
            r.status === "accepted" &&
            r.nextState.pendingCombat?.kind === "advance" &&
            r.nextState.pendingCombat.phase === "awaiting-roll"
          ) {
            const def = r.nextState.pendingCombat.responsibleSeat;
            const withCard = {
              ...r.nextState,
              players: {
                ...r.nextState.players,
                [def]: { ...r.nextState.players[def], hand: ["ambush", "mobilise"] }
              }
            } as State;
            out.push({ state: withCard, seat: def });
            state = r.nextState;
            continue;
          }
        }
      }
      const r = resolveCommand(state, { seat }, greedyCommand(state, seat));
      if (r.status !== "accepted") break;
      state = r.nextState;
    }
  }
  return out;
}

/** Monte-Carlo expected eval (defender perspective) of resolving the pending defence roll, with or
 *  without Ambush. Numeric rngState per iteration (a non-numeric seed collapses to one roll). */
function mcResolveValue(state: State, seat: "red" | "black", ambush: boolean, N = 4000): number {
  const pc = state.pendingCombat!;
  let sum = 0;
  for (let k = 0; k < N; k++) {
    const s = { ...state, rngState: String(500000 + k) } as State;
    const rolled = resolveCommand(
      s,
      { seat: pc.responsibleSeat },
      {
        type: "combatRoll",
        pendingId: pc.id,
        ...(ambush ? { card: "ambush" as const } : {})
      }
    );
    if (rolled.status !== "accepted") throw new Error("roll rejected");
    const done = resolveCommand(
      rolled.nextState,
      { seat: pc.responsibleSeat },
      {
        type: "combatResolve",
        pendingId: pc.id
      }
    );
    if (done.status !== "accepted") throw new Error("resolve rejected");
    sum += evaluate(done.nextState, seat);
  }
  return sum / N;
}

const playsAmbush = (cmd: ReturnType<typeof combatResponse>): boolean =>
  cmd?.type === "combatRoll" && (cmd as { card?: string }).card === "ambush";

/** Drive self-games, force a Shell while holding ship_strike, and roll+resolve it; collect the
 *  states where the engine then offers the ship_strike follow-up decision (attacker on the clock). */
function collectShipStrikeDecisions(n: number): { state: State; seat: "red" | "black" }[] {
  const out: { state: State; seat: "red" | "black" }[] = [];
  for (let g = 0; g < 60 && out.length < n; g++) {
    let state = createInitialState({ gameId: `ss${g}`, seed: `ss-${g}` });
    for (let i = 0; i < 4000 && state.status === "active" && out.length < n; i++) {
      const seat = onTheClock(state);
      if (!seat) break;
      if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
        const shell = (legalCommandsForState(state, seat).strikes ?? []).find(
          (s) => s.type === "shell" && s.targets.length > 0
        );
        if (shell) {
          const withCard = {
            ...state,
            rngState: "12345",
            players: {
              ...state.players,
              [seat]: { ...state.players[seat], hand: ["ship_strike", "mobilise"] }
            }
          } as State;
          const s = resolveCommand(
            withCard,
            { seat },
            {
              type: "shell",
              spaceId: shell.spaceId,
              targetAreaId: shell.targets[0]!
            }
          );
          if (s.status === "accepted" && s.nextState.pendingCombat) {
            const pc = s.nextState.pendingCombat;
            const rolled = resolveCommand(
              s.nextState,
              { seat },
              {
                type: "combatRoll",
                pendingId: pc.id
              }
            );
            if (rolled.status === "accepted") {
              const done = resolveCommand(
                rolled.nextState,
                { seat },
                {
                  type: "combatResolve",
                  pendingId: pc.id
                }
              );
              if (
                done.status === "accepted" &&
                done.nextState.pendingDecision?.kind === "shipStrike" &&
                done.nextState.pendingDecision.seat === seat
              ) {
                out.push({ state: done.nextState, seat });
              }
            }
          }
        }
      }
      const r = resolveCommand(state, { seat }, greedyCommand(state, seat));
      if (r.status !== "accepted") break;
      state = r.nextState;
    }
  }
  return out;
}

/** Drive self-games to `awaiting-roll` NON-fort land defences (1 defence die), with spare cards
 *  forced into the responsible seat's hand so a reroll is affordable. The test injects a concrete
 *  `total` to build the `rolled` state, so both a bad and a good roll are exercised deterministically. */
function collectAwaitingDefences(n: number): { state: State; seat: "red" | "black" }[] {
  const out: { state: State; seat: "red" | "black" }[] = [];
  for (let g = 0; g < 60 && out.length < n; g++) {
    let state = createInitialState({ gameId: `rr${g}`, seed: `rr-${g}` });
    for (let i = 0; i < 4000 && state.status === "active" && out.length < n; i++) {
      const seat = onTheClock(state);
      if (!seat) break;
      if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
        const atk = (legalCommandsForState(state, seat).moves ?? []).find((m) => {
          const t = state.areas[m.targetAreaId];
          return m.type === "advance" && t && t.owner && t.owner !== seat && t.units.troop > 0;
        });
        if (atk && atk.sources[0]) {
          const r = resolveCommand(
            state,
            { seat },
            {
              type: "advance",
              spaceId: atk.spaceId,
              moves: [{ from: atk.sources[0].areaId, count: atk.sources[0].max }]
            }
          );
          const pc = r.status === "accepted" ? r.nextState.pendingCombat : null;
          if (
            r.status === "accepted" &&
            pc?.kind === "advance" &&
            pc.phase === "awaiting-roll" &&
            getMap(r.nextState.mapId).areas[pc.area]?.fort !== true
          ) {
            const def = pc.responsibleSeat;
            out.push({
              state: {
                ...r.nextState,
                players: {
                  ...r.nextState.players,
                  [def]: { ...r.nextState.players[def], hand: ["mobilise", "commandeer"] }
                }
              } as State,
              seat: def
            });
            state = r.nextState;
            continue;
          }
        }
      }
      const r = resolveCommand(state, { seat }, greedyCommand(state, seat));
      if (r.status !== "accepted") break;
      state = r.nextState;
    }
  }
  return out;
}

/** Turn an awaiting-roll defence into a `rolled` state with a concrete 1-die `total`. */
const withTotal = (state: State, total: number): State => {
  const pc = state.pendingCombat!;
  return { ...state, pendingCombat: { ...pc, phase: "rolled", total, rolls: [total] } };
};

const rerolls = (cmd: ReturnType<typeof combatResponse>): boolean => cmd?.type === "combatReroll";

describe("combatResponse: reroll", () => {
  it("rerolls exactly when the expected re-throw beats the current roll (vs Monte-Carlo)", () => {
    const defences = collectAwaitingDefences(6);
    expect(defences.length).toBeGreaterThan(0);
    // Exercise a bad (0) and a good (2) defence roll for each collected defence.
    const cases = defences.flatMap(({ state, seat }) => [
      { state: withTotal(state, 0), seat },
      { state: withTotal(state, 2), seat }
    ]);
    let rerolled = 0;
    for (const { state, seat } of cases) {
      const pc = state.pendingCombat!;
      const current = evaluate(
        nx(resolveCommand(state, { seat }, { type: "combatResolve", pendingId: pc.id })),
        seat
      );
      // MC of one reroll (spends a card) then resolve.
      const N = 4000;
      let sum = 0;
      for (let k = 0; k < N; k++) {
        const s = { ...state, rngState: String(800000 + k) } as State;
        const rr = resolveCommand(
          s,
          { seat },
          {
            type: "combatReroll",
            pendingId: pc.id,
            card: "mobilise"
          }
        );
        if (rr.status !== "accepted") throw new Error("reroll rejected");
        const done = resolveCommand(
          rr.nextState,
          { seat },
          {
            type: "combatResolve",
            pendingId: pc.id
          }
        );
        sum += evaluate(nx(done), seat);
      }
      const rerollMc = sum / N;
      const truth = rerollMc > current;
      expect(
        rerolls(combatResponse(state, seat)),
        `reroll=${rerollMc.toFixed(2)} current=${current.toFixed(2)}`
      ).toBe(truth);
      if (truth) rerolled++;
    }
    // Non-vacuous: at least one collected roll must be bad enough to be worth a reroll.
    expect(rerolled).toBeGreaterThan(0);
  });
});

describe("combatResponse: ship_strike", () => {
  it("answers the ship_strike decision with the highest-eval choice (takes a beneficial 2nd Shell)", () => {
    const cases = collectShipStrikeDecisions(4);
    expect(cases.length).toBeGreaterThan(0);
    let tookAShell = 0;
    for (const { state, seat } of cases) {
      const pd = state.pendingDecision!;
      // Independent ground truth: the choice that maximizes the one-ply eval.
      let best = pd.choices[0]!;
      let bestV = -Infinity;
      for (const choice of pd.choices) {
        const r = resolveCommand(
          state,
          { seat },
          {
            type: "choosePendingDecision",
            pendingId: pd.id,
            choice
          }
        );
        if (r.status !== "accepted") continue;
        const v = evaluate(r.nextState, seat);
        if (v > bestV) {
          bestV = v;
          best = choice;
        }
      }
      const cmd = combatResponse(state, seat);
      expect(cmd?.type).toBe("choosePendingDecision");
      expect((cmd as { choice?: { id: string } }).choice?.id).toBe(best.id);
      if (best.id !== "decline") tookAShell++;
    }
    // Non-vacuous: at least one collected case must favour taking the second Shell.
    expect(tookAShell).toBeGreaterThan(0);
  });
});

describe("combatResponse is deterministic", () => {
  it("returns the same command on repeated calls (pure function of state)", () => {
    const cases = collectDefenceWithAmbush(4);
    expect(cases.length).toBeGreaterThan(0);
    for (const { state, seat } of cases) {
      expect(combatResponse(state, seat)).toEqual(combatResponse(state, seat));
    }
  });
});

describe("the deployed bot uses combatResponse for its actual (root) combat responses", () => {
  it("alpha-beta plays a beneficial Ambush at the root (not the no-card heuristic)", () => {
    const favorable = collectDefenceWithAmbush(6).find(({ state, seat }) =>
      playsAmbush(combatResponse(state, seat))
    );
    expect(favorable, "no ambush-favorable defence collected").toBeDefined();
    const { state, seat } = favorable!;
    const ab = alphaBetaCommand(state, seat, { depth: 2 });
    expect(ab.type).toBe("combatRoll");
    expect((ab as { card?: string }).card).toBe("ambush");
  });
});

describe("combatResponse: ambush", () => {
  it("plays Ambush exactly when it beats not playing it (vs a Monte-Carlo ground truth)", () => {
    const cases = collectDefenceWithAmbush(6);
    expect(cases.length).toBeGreaterThan(0);
    let played = 0;
    for (const { state, seat } of cases) {
      const withA = mcResolveValue(state, seat, true);
      const withoutA = mcResolveValue(state, seat, false);
      const truthPlay = withA > withoutA; // card cost is captured by the hand term in eval
      const actual = playsAmbush(combatResponse(state, seat));
      expect(actual, `MC with=${withA.toFixed(2)} without=${withoutA.toFixed(2)}`).toBe(truthPlay);
      if (truthPlay) played++;
    }
    // Non-vacuous: at least one collected case must actually favour Ambush.
    expect(played).toBeGreaterThan(0);
  });
});
