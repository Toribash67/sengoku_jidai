import { resolveCommand, type Command, type GameState, type SeatId } from "@sengoku-jidai/engine";
import type { Bot } from "../types.js";
import { onTheClock } from "../onclock.js";
import { resolvePending } from "../heuristics.js";
import { deployCandidates } from "../candidates.js";
import { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "../eval.js";

/** Depth-limited alpha-beta over the deploy tree. All values are in ROOT-seat perspective
 *  (evaluate() is antisymmetric), so a node maximizes when the seat on the clock is the root
 *  seat and minimizes otherwise. Deterministic — a pure function of the state — so it is
 *  reproducible and needs no RNG seed.
 *
 *  Combat handling: a battle is resolved THROUGH the search via the fixed heuristic (one roll off
 *  the state's own `rngState`), so the line continues and the opponent gets to respond. This
 *  matters — scoring an attack at a pendingCombat *leaf* instead truncates it before the reply,
 *  an asymmetry that made deeper search play WORSE than 1-ply greedy (measured). Resolving through
 *  fixes it (depth 2–3 beat greedy 9/10). Known simplification: the single roll is one plausible
 *  outcome, not the dice *expectation*; a later version can expand combat as an expectiminimax
 *  chance node (average over `rollTotalDistribution`) for variance-robust attack valuation. */

export interface AlphaBetaOptions {
  /** Fixed search depth in plies (commander deployments). Deterministic. */
  depth?: number;
  /** Wall-clock budget; iterative-deepening returns the deepest completed ply's choice. */
  deadlineMs?: number;
  /** Hard ceiling for iterative deepening. */
  maxDepth?: number;
  weights?: EvalWeights;
}

/** Resolve any pending combat/decision with the fixed heuristic so we land on a clean deploy or a
 *  terminal state — see the combat-handling note above for why combat is resolved through here. */
function settle(state: GameState): GameState {
  let cur = state;
  let guard = 0;
  while (cur.status === "active" && (cur.pendingDecision || cur.pendingCombat)) {
    const seat = cur.pendingCombat ? cur.pendingCombat.responsibleSeat : cur.pendingDecision!.seat;
    const cmd = resolvePending(cur, seat);
    if (!cmd) break;
    const r = resolveCommand(cur, { seat }, cmd);
    if (r.status !== "accepted") break;
    cur = r.nextState;
    if (++guard > 1000) break;
  }
  return cur;
}

function isLeaf(state: GameState): boolean {
  return state.status !== "active" || onTheClock(state) === null;
}

/** Children of a deploy node: (command, resolved+settled next state, immediate root-seat eval).
 *  Sorted best-first for the mover to sharpen alpha-beta pruning. */
function orderedChildren(
  state: GameState,
  mover: SeatId,
  rootSeat: SeatId,
  weights: EvalWeights
): { cmd: Command; next: GameState; shallow: number }[] {
  const kids: { cmd: Command; next: GameState; shallow: number }[] = [];
  for (const cmd of deployCandidates(state, mover)) {
    const r = resolveCommand(state, { seat: mover }, cmd);
    if (r.status !== "accepted") continue;
    const next = settle(r.nextState);
    kids.push({ cmd, next, shallow: evaluate(next, rootSeat, weights) });
  }
  // Maximizer wants high root-seat value first; minimizer wants low first.
  const dir = mover === rootSeat ? -1 : 1;
  kids.sort((a, b) => dir * (a.shallow - b.shallow));
  return kids;
}

/** Thrown to unwind a search that ran past its wall-clock deadline; the caller keeps the last
 *  fully-completed depth's move, so partial (unfair, biased) results are never used. */
class SearchTimeout extends Error {}

function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  rootSeat: SeatId,
  weights: EvalWeights,
  deadline: number
): number {
  if (deadline > 0 && Date.now() >= deadline) throw new SearchTimeout();
  if (isLeaf(state) || depth <= 0) return evaluate(state, rootSeat, weights);
  const mover = onTheClock(state)!;
  const maximizing = mover === rootSeat;
  const kids = orderedChildren(state, mover, rootSeat, weights);
  if (kids.length === 0) return evaluate(state, rootSeat, weights);

  // At the last ply, children are leaves — their shallow eval is the value; pick the extreme.
  if (depth === 1) {
    let best = kids[0]!.shallow;
    for (const k of kids) best = maximizing ? Math.max(best, k.shallow) : Math.min(best, k.shallow);
    return best;
  }

  let value = maximizing ? -Infinity : Infinity;
  let a = alpha;
  let b = beta;
  for (const k of kids) {
    const v = negamax(k.next, depth - 1, a, b, rootSeat, weights, deadline);
    if (maximizing) {
      if (v > value) value = v;
      if (value > a) a = value;
    } else {
      if (v < value) value = v;
      if (value < b) b = value;
    }
    if (b <= a) break; // prune
  }
  return value;
}

/** Best root deploy command by alpha-beta. Ties keep the first-seen (candidate order stable). */
export function alphaBetaCommand(
  state: GameState,
  seat: SeatId,
  opts: AlphaBetaOptions = {}
): Command {
  const pending = resolvePending(state, seat);
  if (pending) return pending;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;

  const root = settle(state);
  const mover = onTheClock(root);
  if (mover !== seat || isLeaf(root)) return { type: "pass" };
  const kids = orderedChildren(root, seat, seat, weights);
  if (kids.length === 0) return { type: "pass" };
  if (kids.length === 1) return kids[0]!.cmd;

  const searchTo = (depth: number, deadline: number): Command => {
    let bestCmd = kids[0]!.cmd;
    let bestVal = -Infinity;
    let a = -Infinity;
    for (const k of kids) {
      const v =
        depth <= 1 ? k.shallow : negamax(k.next, depth - 1, a, Infinity, seat, weights, deadline);
      if (v > bestVal) {
        bestVal = v;
        bestCmd = k.cmd;
      }
      if (v > a) a = v;
    }
    return bestCmd;
  };

  if (opts.depth !== undefined) return searchTo(opts.depth, 0); // fixed depth: no time abort

  // Iterative deepening against a wall-clock deadline: keep the deepest COMPLETED ply's move; a
  // depth that overruns throws SearchTimeout and its partial result is discarded.
  const deadline = Date.now() + (opts.deadlineMs ?? 1000);
  const maxDepth = opts.maxDepth ?? 20;
  let best = kids[0]!.cmd;
  for (let d = 1; d <= maxDepth; d++) {
    try {
      best = searchTo(d, deadline);
    } catch (e) {
      if (e instanceof SearchTimeout) break;
      throw e;
    }
    if (Date.now() >= deadline) break;
  }
  return best;
}

/** Alpha-beta bot. Pass `depth` for reproducible tests, `deadlineMs` for a wall-clock budget. */
export class AlphaBetaBot implements Bot {
  constructor(private readonly opts: AlphaBetaOptions = {}) {}
  chooseCommand(state: GameState, seat: SeatId): Command {
    return alphaBetaCommand(state, seat, this.opts);
  }
}
