import {
  legalCommandsForState,
  resolveCommand,
  type Command,
  type GameState,
  type OperationCard
} from "@sengoku-jidai/engine";
import type { SeatId } from "../types.js";
import { deployCandidates, moveArchetypes } from "../candidates.js";
import { DEFAULT_WEIGHTS, evaluate } from "../eval.js";
import { battleDecision, battleOutcomes, type BattleCtx } from "./battle.js";
import { DEFAULT_FEATURES, type ExpectiOptions } from "./features.js";

/**
 * The look-ahead. Three kinds of step:
 *  - the AI chooses: take the best option;
 *  - the opponent chooses: take the option worst for the AI;
 *  - chance (a battle): the probability-weighted average over the battle resolver's outcomes.
 *
 * Every value is from `ctx.viewer`'s side. States are OBSERVED states (see hidden.ts): the
 * opponent's cards are placeholders, so nothing here can read hidden information.
 */

export interface SearchCtx extends BattleCtx {
  /** Wall-clock time (ms) after which the search unwinds; 0 = no deadline. */
  deadline: number;
  /** The `depth` value at which an opponent deploy step counts as "the immediate reply" for
   *  opponent card threats. The root sets it to d − 1 while searching depth d; −1 disables it. */
  threatDepth: number;
}

type Absent = ReadonlySet<OperationCard>;

/** Thrown to unwind a search that ran past its deadline; the caller keeps the last fully
 *  completed depth's move, so a partial (biased) result is never used. */
class SearchTimeout extends Error {}

/** Value of `state` for `ctx.viewer`. `depth` counts the deployments still to be searched;
 *  battles and follow-up decisions are always played out and do not consume depth. */
export function searchValue(
  state: GameState,
  absent: Absent,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx
): number {
  if (ctx.deadline > 0 && Date.now() >= ctx.deadline) throw new SearchTimeout();
  if (state.status !== "active") return evaluate(state, ctx.viewer, ctx.weights);

  if (state.pendingCombat) {
    let value = 0;
    for (const o of battleOutcomes(state, absent, ctx)) {
      value += o.prob * searchValue(o.state, o.absent, depth, -Infinity, Infinity, ctx);
    }
    return value;
  }

  if (state.pendingDecision) {
    const seat = state.pendingDecision.seat;
    const maximizing = seat === ctx.viewer;
    let value = maximizing ? -Infinity : Infinity;
    for (const next of decisionChildren(state, ctx)) {
      const v = searchValue(next.state, absent, depth, -Infinity, Infinity, ctx);
      value = maximizing ? Math.max(value, v) : Math.min(value, v);
    }
    return Number.isFinite(value) ? value : evaluate(state, ctx.viewer, ctx.weights);
  }

  if (depth <= 0) return evaluate(state, ctx.viewer, ctx.weights);

  const mover = state.activeSeat;
  const kids = deployChildren(state, mover, ctx);
  if (kids.length === 0) return evaluate(state, ctx.viewer, ctx.weights);
  const maximizing = mover === ctx.viewer;
  let value = maximizing ? -Infinity : Infinity;
  let a = alpha;
  let b = beta;
  for (const k of kids) {
    const v = childValue(k, absent, depth - 1, a, b, ctx);
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

interface Child {
  cmd: Command;
  state: GameState;
  /** Static value of `state` for the viewer: move ordering, and the value itself at a leaf. */
  shallow: number;
}

/** A quiet leaf is worth its static value; anything else is searched. */
function childValue(
  k: Child,
  absent: Absent,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx
): number {
  const quiet = !k.state.pendingCombat && !k.state.pendingDecision;
  if (depth <= 0 && quiet) return k.shallow;
  return searchValue(k.state, absent, depth, alpha, beta, ctx);
}

/** The mover's deploy options with their resulting states, best-first for the mover. */
function deployChildren(state: GameState, mover: SeatId, ctx: BattleCtx): Child[] {
  const kids = children(state, mover, deployCandidates(state, mover), ctx);
  const dir = mover === ctx.viewer ? -1 : 1;
  return kids.sort((x, y) => dir * (x.shallow - y.shallow));
}

/** The answers to a pending decision: its listed choices, plus — for a Siege Assault offer —
 *  the advances it allows. With follow-ups switched off, a declinable offer is declined. */
function decisionChildren(state: GameState, ctx: BattleCtx): Child[] {
  const pd = state.pendingDecision!;
  const followUp = pd.kind === "shipStrike" || pd.kind === "siegeAssault";
  const decline = pd.choices.find((c) => c.id === "decline");
  const choices = followUp && decline && !ctx.features.followUps ? [decline] : pd.choices;
  const cmds: Command[] = choices.map((choice) => ({
    type: "choosePendingDecision",
    pendingId: pd.id,
    choice
  }));
  if (pd.kind === "siegeAssault" && ctx.features.followUps) {
    const offer = legalCommandsForState(state, pd.seat).siegeAssault;
    if (offer) cmds.push(...moveArchetypes(state, pd.seat, offer, "siege_assault"));
  }
  return children(state, pd.seat, cmds, ctx);
}

function children(state: GameState, seat: SeatId, cmds: Command[], ctx: BattleCtx): Child[] {
  const kids: Child[] = [];
  for (const cmd of cmds) {
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") continue;
    kids.push({ cmd, state: r.nextState, shallow: evaluate(r.nextState, ctx.viewer, ctx.weights) });
  }
  return kids;
}

/** Pick `seat`'s command from an OBSERVED state. Fixed `depth` is a pure function of the
 *  observation; otherwise iterative deepening runs until `deadlineMs` and the deepest completed
 *  depth's choice is returned (the greedy choice if not even depth 1 completes). */
export function chooseCommand(
  observed: GameState,
  seat: SeatId,
  opts: ExpectiOptions = {}
): Command {
  const base: SearchCtx = {
    viewer: seat,
    weights: opts.weights ?? DEFAULT_WEIGHTS,
    features: { ...DEFAULT_FEATURES, ...opts.features },
    deadline: 0,
    threatDepth: -1
  };
  const none: Absent = new Set<OperationCard>();
  if (observed.status !== "active") return { type: "pass" };

  const pc = observed.pendingCombat;
  if (pc) return pc.responsibleSeat === seat ? battleDecision(observed, base) : { type: "pass" };

  const pd = observed.pendingDecision;
  if (pd) {
    if (pd.seat !== seat) return { type: "pass" };
    let best: Command | null = null;
    let bestValue = -Infinity;
    for (const k of decisionChildren(observed, base)) {
      const v = searchValue(k.state, none, 0, -Infinity, Infinity, base);
      if (v > bestValue) {
        bestValue = v;
        best = k.cmd;
      }
    }
    return best ?? { type: "choosePendingDecision", pendingId: pd.id, choice: pd.choices[0]! };
  }

  if (observed.activeSeat !== seat) return { type: "pass" };
  const kids = deployChildren(observed, seat, base);
  if (kids.length === 0) return { type: "pass" };
  if (kids.length === 1) return kids[0]!.cmd;

  const searchTo = (depth: number, deadline: number): Command => {
    const ctx: SearchCtx = { ...base, deadline, threatDepth: depth - 1 };
    let bestCmd = kids[0]!.cmd;
    let bestValue = -Infinity;
    let a = -Infinity;
    for (const k of kids) {
      const v = childValue(k, none, depth - 1, a, Infinity, ctx);
      if (v > bestValue) {
        bestValue = v;
        bestCmd = k.cmd;
      }
      if (v > a) a = v;
    }
    return bestCmd;
  };

  if (opts.depth !== undefined) return searchTo(Math.max(1, opts.depth), 0);

  const deadline = Date.now() + (opts.deadlineMs ?? 5000);
  const maxDepth = opts.maxDepth ?? 20;
  let best = kids[0]!.cmd; // best-first by static value: the greedy choice
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
