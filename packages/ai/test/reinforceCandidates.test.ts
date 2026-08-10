import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand, legalCommandsForState } from "@sengoku-jidai/engine";
import { greedyCommand } from "../src/bots/greedy.js";
import { evaluate } from "../src/eval.js";
import { onTheClock } from "../src/onclock.js";

/**
 * Regression for the over-passing bug: `deployCandidates` only offered reinforce/embark into the
 * single highest-star tile, ignoring capacity. When that tile was at its unit cap the candidate
 * was a no-op that tied with pass, so the bot passed even though reinforcing a different owned
 * tile would strictly improve the position. Root-cause invariant tested here:
 *
 *   If some legal reinforce/embark placement raises the one-ply eval above pass, the bot must
 *   not pass on a clean deploy turn.
 *
 * The "legal reinforcement" delta is computed straight from `legalCommandsForState` (engine
 * level), independent of the candidate generator under test.
 */
function bestLegalReinforceDelta(
  state: ReturnType<typeof createInitialState>,
  seat: "red" | "black",
  passEval: number
): { delta: number; where: string } {
  const legal = legalCommandsForState(state, seat);
  let best = 0;
  let where = "none";
  for (const pl of legal.placements ?? []) {
    const placeable = Math.min(pl.pool, pl.reserve);
    if (placeable <= 0) continue;
    for (const target of pl.targets) {
      const cmd = {
        type: pl.type,
        spaceId: pl.spaceId,
        placements: [{ area: target, count: placeable }]
      };
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") continue;
      const delta = evaluate(r.nextState, seat) - passEval;
      if (delta > best) {
        best = delta;
        where = `${pl.type}->${target}`;
      }
    }
  }
  return { delta: best, where };
}

describe("deployCandidates offers beneficial reinforcements (no over-passing)", () => {
  it("greedy never passes when a legal reinforcement would beat pass", () => {
    let state = createInitialState({ gameId: "reinforce-regression", seed: "repro-7" });
    const violations: string[] = [];

    for (let i = 0; i < 4000 && state.status === "active"; i++) {
      const seat = onTheClock(state);
      if (!seat) break;

      if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
        const passResult = resolveCommand(state, { seat }, { type: "pass" });
        if (passResult.status !== "accepted") throw new Error("pass rejected on clean deploy turn");
        const passEval = evaluate(passResult.nextState, seat);
        const { delta, where } = bestLegalReinforceDelta(state, seat, passEval);
        if (delta > 0.5 && greedyCommand(state, seat).type === "pass") {
          violations.push(
            `round ${state.round} ${seat}: passed but ${where} gives +${delta.toFixed(2)}`
          );
        }
      }

      const cmd = greedyCommand(state, seat);
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") throw new Error(`illegal ${JSON.stringify(cmd)}`);
      state = r.nextState;
    }

    expect(violations, violations.slice(0, 8).join("\n")).toEqual([]);
  });
});

/**
 * Regression for the over-passing-on-attacks bug: before `evaluate()` valued a pendingCombat
 * state via the probability-weighted expected-combat path (Task 3), a likely-winning attack
 * looked no better than pass to the one-ply greedy search (a raw post-move score that ignored
 * the still-pending fight), so the bot sat still even when it strictly outnumbered a capturable
 * enemy tile. Root-cause invariant tested here:
 *
 *   If some legal advance/sail where the attacker strictly outnumbers the defender on an
 *   enemy-owned tile raises the one-ply eval (now via expected-combat value) above pass, the
 *   bot must not pass on a clean deploy turn.
 *
 * The "winning attack" delta is computed straight from `legalCommandsForState` (engine level),
 * independent of the candidate generator under test — mirroring `bestLegalReinforceDelta` above.
 */
function bestWinningAttackDelta(
  state: ReturnType<typeof createInitialState>,
  seat: "red" | "black",
  passEval: number
): { delta: number; where: string } {
  const legal = legalCommandsForState(state, seat);
  let best = 0;
  let where = "none";
  for (const mv of legal.moves ?? []) {
    const target = state.areas[mv.targetAreaId];
    if (!target || !target.owner || target.owner === seat) continue; // enemy-owned only
    const defenders = target.units.troop + target.units.ship;
    if (defenders <= 0) continue;
    for (const src of mv.sources) {
      const attackers = src.max;
      if (attackers <= defenders) continue; // only "clearly winning" attacks: strictly outnumber
      const cmd = {
        type: mv.type,
        spaceId: mv.spaceId,
        moves: [{ from: src.areaId, count: attackers }]
      };
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") continue;
      const delta = evaluate(r.nextState, seat) - passEval;
      if (delta > best) {
        best = delta;
        where = `${mv.type}->${mv.targetAreaId} from ${src.areaId} (${attackers}v${defenders})`;
      }
    }
  }
  return { delta: best, where };
}

describe("greedy does not over-pass on winning attacks (expected-combat eval)", () => {
  it("greedy never passes when a clearly-winning attack would beat pass", () => {
    let state = createInitialState({ gameId: "attack-regression", seed: "repro-7" });
    const violations: string[] = [];
    let winningAttackTurns = 0;

    for (let i = 0; i < 4000 && state.status === "active"; i++) {
      const seat = onTheClock(state);
      if (!seat) break;

      if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
        const passResult = resolveCommand(state, { seat }, { type: "pass" });
        if (passResult.status !== "accepted") throw new Error("pass rejected on clean deploy turn");
        const passEval = evaluate(passResult.nextState, seat);
        const { delta, where } = bestWinningAttackDelta(state, seat, passEval);
        if (delta > 1.0) {
          winningAttackTurns++;
          if (greedyCommand(state, seat).type === "pass") {
            violations.push(
              `round ${state.round} ${seat}: passed but winning attack ${where} gives +${delta.toFixed(2)}`
            );
          }
        }
      }

      const cmd = greedyCommand(state, seat);
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") throw new Error(`illegal ${JSON.stringify(cmd)}`);
      state = r.nextState;
    }

    // Guard against a vacuous pass: the seed must actually surface at least one
    // winning-attack-vs-pass situation, or this test proves nothing.
    expect(winningAttackTurns).toBeGreaterThan(0);
    expect(violations, violations.slice(0, 8).join("\n")).toEqual([]);
  });
});
