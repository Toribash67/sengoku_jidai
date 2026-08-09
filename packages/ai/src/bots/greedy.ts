import { resolveCommand } from "@sengoku-jidai/engine";
import type { Bot, Command, GameState, SeatId } from "../types.js";
import { resolvePending } from "../heuristics.js";
import { deployCandidates } from "../candidates.js";
import { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "../eval.js";

/** Best immediate deploy by one-ply evaluation. Pending combat/decisions resolve via
 *  heuristics. Deterministic: ties keep the first-seen (candidate order is stable). */
export function greedyCommand(
  state: GameState,
  seat: SeatId,
  weights: EvalWeights = DEFAULT_WEIGHTS
): Command {
  const pending = resolvePending(state, seat);
  if (pending) return pending;

  const candidates = deployCandidates(state, seat);
  if (candidates.length === 0) return { type: "pass" };

  let best: Command = candidates[0]!;
  let bestValue = -Infinity;
  for (const cmd of candidates) {
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") continue;
    const value = evaluate(r.nextState, seat, weights);
    if (value > bestValue) {
      bestValue = value;
      best = cmd;
    }
  }
  return best;
}

/** 1-ply greedy baseline bot (also the ISMCTS rollout policy). */
export class GreedyBot implements Bot {
  constructor(private readonly weights: EvalWeights = DEFAULT_WEIGHTS) {}

  chooseCommand(state: GameState, seat: SeatId): Command {
    return greedyCommand(state, seat, this.weights);
  }
}
