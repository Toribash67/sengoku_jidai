import { resolveCommand, type Command, type GameState, type SeatId } from "@sengoku-jidai/engine";
import type { Bot } from "./types.js";
import { createAiRng, seedFromString, type AiRng } from "./rng.js";
import { onTheClock } from "./onclock.js";
import { resolvePending } from "./heuristics.js";
import { deployCandidates } from "./candidates.js";
import { greedyCommand } from "./bots/greedy.js";
import { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "./eval.js";
import { determinize } from "./determinize.js";

export interface IsmctsOptions {
  iterations?: number;
  deadlineMs?: number;
  rng: AiRng;
  depthCap?: number;
  exploration?: number;
  weights?: EvalWeights;
}

interface Edge {
  cmd: Command;
  n: number;
  w: number; // sum of values in ROOT-seat perspective
  child: Node | null;
}

interface Node {
  n: number;
  edges: Edge[] | null; // null until expanded (lazy: needs the node's state)
}

/** The optimization seam: every search transition goes through here. Throws on an
 *  illegal command (a search bug). Swap the body for copy-on-write later. */
function applyForSearch(state: GameState, seat: SeatId, cmd: Command): GameState {
  const r = resolveCommand(state, { seat }, cmd);
  if (r.status !== "accepted") {
    throw new Error(`search illegal command ${JSON.stringify(cmd)}: ${r.reason.code}`);
  }
  return r.nextState;
}

/** Resolve pending combat/decisions via heuristics until the state is a clean deploy or
 *  the game ends. Combat dice consume the (already-perturbed) working RNG, so outcomes
 *  differ per determinization. */
function autoAdvance(state: GameState): GameState {
  let cur = state;
  let guard = 0;
  while (cur.status === "active") {
    const clock = onTheClock(cur);
    if (!clock) break;
    if (cur.pendingCombat || cur.pendingDecision) {
      const cmd = resolvePending(cur, clock)!;
      cur = applyForSearch(cur, clock, cmd);
      if (++guard > 10_000) throw new Error("autoAdvance did not terminate");
      continue;
    }
    break;
  }
  return cur;
}

function perturbRng(state: GameState, rng: AiRng): GameState {
  return { ...state, rngState: String(Math.floor(rng.next() * 0x1_0000_0000)) };
}

function ucbSelect(node: Node, mover: SeatId, rootSeat: SeatId, c: number, rng: AiRng): Edge {
  const logN = Math.log(node.n + 1);
  let best: Edge | null = null;
  let bestScore = -Infinity;
  for (const e of node.edges!) {
    if (e.n === 0) return e; // try every edge at least once
    const mean = e.w / e.n; // root-seat perspective
    const exploit = mover === rootSeat ? mean : -mean;
    const score = exploit + c * Math.sqrt(logN / e.n) + rng.next() * 1e-9; // tiny tie-break
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best!;
}

/** Greedy rollout to terminal or depth cap; returns value in ROOT-seat perspective. */
function rollout(
  state: GameState,
  rootSeat: SeatId,
  weights: EvalWeights,
  depth: number,
  depthCap: number
): number {
  let cur = autoAdvance(state);
  let d = depth;
  while (cur.status === "active" && d < depthCap) {
    const seat = onTheClock(cur)!;
    const cmd = greedyCommand(cur, seat, weights);
    cur = autoAdvance(applyForSearch(cur, seat, cmd));
    d++;
  }
  return evaluate(cur, rootSeat, weights);
}

/** One ISMCTS descent. Returns the leaf value in ROOT-seat perspective. */
function descend(
  node: Node,
  state: GameState,
  rootSeat: SeatId,
  rng: AiRng,
  weights: EvalWeights,
  depth: number,
  depthCap: number,
  c: number
): number {
  const cur = autoAdvance(state);
  if (cur.status !== "active" || depth >= depthCap) {
    return evaluate(cur, rootSeat, weights);
  }
  const mover = onTheClock(cur)!;

  if (node.edges === null) {
    node.edges = deployCandidates(cur, mover).map((cmd) => ({ cmd, n: 0, w: 0, child: null }));
    if (node.edges.length === 0) node.edges = [{ cmd: { type: "pass" }, n: 0, w: 0, child: null }];
  }

  const edge = ucbSelect(node, mover, rootSeat, c, rng);
  // Edges are cached on the node and replayed across iterations, but autoAdvance resolves
  // combat with the (perturbed) working RNG, so board state at this node — and therefore a
  // cached command's legality (e.g. a supply chain a shell/bombard depends on) — can differ
  // between iterations even at the same tree position. Fall back to `pass`, which
  // deployCandidates always includes whenever a node was expandable, so it stays legal here.
  let next: GameState;
  try {
    next = applyForSearch(cur, mover, edge.cmd);
  } catch {
    next = applyForSearch(cur, mover, { type: "pass" });
  }

  let value: number;
  if (edge.n === 0) {
    edge.child = { n: 0, edges: null };
    value = rollout(next, rootSeat, weights, depth + 1, depthCap);
  } else {
    value = descend(edge.child!, next, rootSeat, rng, weights, depth + 1, depthCap, c);
  }

  edge.n++;
  edge.w += value;
  node.n++;
  return value;
}

/** Run ISMCTS and return the most-visited root deploy command. Pending nodes short-circuit
 *  to the heuristic policy. */
export function chooseCommandIsmcts(state: GameState, seat: SeatId, opts: IsmctsOptions): Command {
  const pending = resolvePending(state, seat);
  if (pending) return pending;

  const candidates = deployCandidates(state, seat);
  if (candidates.length <= 1) return candidates[0] ?? { type: "pass" };

  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const depthCap = opts.depthCap ?? 40;
  const c = opts.exploration ?? 1.4;
  const root: Node = { n: 0, edges: candidates.map((cmd) => ({ cmd, n: 0, w: 0, child: null })) };

  const useIterations = opts.iterations !== undefined;
  const deadline = useIterations ? 0 : Date.now() + (opts.deadlineMs ?? 1000);
  let i = 0;
  while (useIterations ? i < opts.iterations! : Date.now() < deadline) {
    const d = perturbRng(determinize(state, seat, opts.rng), opts.rng);
    descend(root, d, seat, opts.rng, weights, 0, depthCap, c);
    i++;
  }

  // Most-visited root edge (robust choice); ties -> first (candidate order stable).
  let best = root.edges![0]!;
  for (const e of root.edges!) if (e.n > best.n) best = e;
  return best.cmd;
}

/** The AI opponent. For reproducible tests pass `iterations` + `seed`; for production pass
 *  `deadlineMs`. A fresh RNG is derived per decision from `seed + state.revision`. */
export class IsmctsBot implements Bot {
  constructor(
    private readonly opts: {
      iterations?: number;
      deadlineMs?: number;
      seed?: string;
      depthCap?: number;
      exploration?: number;
      weights?: EvalWeights;
    }
  ) {}

  chooseCommand(state: GameState, seat: SeatId): Command {
    const rng = createAiRng(seedFromString(`${this.opts.seed ?? "ai"}:${state.revision}:${seat}`));
    return chooseCommandIsmcts(state, seat, {
      iterations: this.opts.iterations,
      deadlineMs: this.opts.deadlineMs,
      rng,
      depthCap: this.opts.depthCap,
      exploration: this.opts.exploration,
      weights: this.opts.weights
    });
  }
}
