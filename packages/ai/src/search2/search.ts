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
import { holdProbability } from "./belief.js";
import { grantCard } from "./hidden.js";
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
  /** Battles still to be expanded outcome-by-outcome on this line; later ones are folded. */
  fullBattles: number;
  /** Deploy-threat penalties already worked out for a position (see threatPenalty). */
  threatMemo?: WeakMap<GameState, number>;
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

  if (state.pendingCombat) return chanceValue(state, absent, depth, alpha, beta, ctx);

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
  if (mover === ctx.viewer) {
    let value = -Infinity;
    let a = alpha;
    for (const k of kids) {
      value = Math.max(value, childValue(k, absent, depth - 1, a, beta, ctx));
      a = Math.max(a, value);
      if (beta <= a) break; // prune
    }
    return value;
  }

  // The opponent's step. Their hand is placeholders, so `kids` are their card-free options; the
  // cards they might hold are weighed in by probability: follow-ups per option, deploy-time cards
  // as a penalty on the whole step. The penalty is a constant, so pruning carries on around it.
  const penalty =
    ctx.features.opponentDeployThreats && depth === ctx.threatDepth
      ? threatPenalty(state, mover, kids, absent, ctx)
      : 0;
  const floor = alpha + penalty;
  let b = beta + penalty;
  let value = Infinity;
  for (const k of kids) {
    value = Math.min(value, opponentChildValue(state, mover, k, absent, depth - 1, floor, b, ctx));
    b = Math.min(b, value);
    if (b <= floor) break; // prune
  }
  return value - penalty;
}

/** Cards the opponent plays as a commander deploys. */
const DEPLOY_CARDS: readonly OperationCard[] = [
  "ground_assault",
  "river_assault",
  "mobilise",
  "commandeer",
  "counterattack",
  "shore_strike",
  "volley"
];

/**
 * How much worse this opponent step is for the viewer because of the deploy-time cards the
 * opponent might hold. For each kind: the probability they hold it, times how much their best
 * play of it beats their best card-free option — both judged by static value one deployment
 * deep, so the cost does not grow with search depth. Never more than the worst single threat.
 * Memoised per position: the root's children are revisited at every iteration depth.
 */
function threatPenalty(
  state: GameState,
  mover: SeatId,
  kids: Child[],
  absent: Absent,
  ctx: SearchCtx
): number {
  const memo = absent.size === 0 ? ctx.threatMemo : undefined;
  const known = memo?.get(state);
  if (known !== undefined) return known;
  const plain = kids[0]!.shallow; // best-first for the opponent: their best card-free option
  let weighed = 0;
  let worst = 0;
  for (const card of DEPLOY_CARDS) {
    if (state.players[mover].hand.includes(card)) continue; // a real card: already in `kids`
    const prob = holdProbability(state, mover, card, absent);
    if (prob <= 0) continue;
    const holding = grantCard(state, mover, card);
    if (!holding) continue;
    const plays = deployCandidates(holding, mover).filter((c) => "card" in c && c.card === card);
    let gap = 0;
    for (const k of children(holding, mover, plays, ctx)) gap = Math.max(gap, plain - k.shallow);
    weighed += prob * gap;
    worst = Math.max(worst, gap);
  }
  const penalty = Math.min(weighed, worst);
  memo?.set(state, penalty);
  return penalty;
}

/** Strikes whose resolution offers the attacker a follow-up, and the card that offers it. */
const FOLLOW_UP_CARD: Partial<Record<Command["type"], OperationCard>> = {
  shell: "ship_strike",
  siege: "siege_assault"
};

/** Value of one opponent option. A Shell or Siege may be followed by a Ship Strike or Siege
 *  Assault if they hold that card: mix the plain result with the result of the same command
 *  played while holding it (the engine then raises the follow-up offer by itself). */
function opponentChildValue(
  state: GameState,
  mover: SeatId,
  k: Child,
  absent: Absent,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx
): number {
  const card = ctx.features.followUps ? FOLLOW_UP_CARD[k.cmd.type] : undefined;
  const prob = card ? holdProbability(state, mover, card, absent) : 0;
  const holding = card && prob > 0 ? grantCard(state, mover, card) : null;
  if (!holding) return childValue(k, absent, depth, alpha, beta, ctx);
  const [granted] = children(holding, mover, [k.cmd], ctx);
  if (!granted) return childValue(k, absent, depth, alpha, beta, ctx);
  const plain = childValue(k, absent, depth, -Infinity, Infinity, ctx);
  const withCard = childValue(granted, absent, depth, -Infinity, Infinity, ctx);
  return (1 - prob) * plain + prob * Math.min(plain, withCard);
}

/**
 * A battle. The first `fullBattles` on a line are expanded: every outcome is searched and the
 * values averaged. That multiplies the tree below by the number of outcomes, so deeper battles
 * are folded instead: only the most likely outcome is searched, and the others are accounted for
 * by how much the exact expected static value differs from that outcome's static value. The
 * dice and the cards are priced either way; only the continuation is approximated.
 */
function chanceValue(
  state: GameState,
  absent: Absent,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx
): number {
  const outs = battleOutcomes(state, absent, ctx);
  if (ctx.fullBattles > 0) {
    const below: SearchCtx = { ...ctx, fullBattles: ctx.fullBattles - 1 };
    let value = 0;
    for (const o of outs) {
      value += o.prob * searchValue(o.state, o.absent, depth, -Infinity, Infinity, below);
    }
    return value;
  }
  let expected = 0;
  let likely: (typeof outs)[number] | null = null;
  let likelyStatic = 0;
  for (const o of outs) {
    const v = evaluate(o.state, ctx.viewer, ctx.weights);
    expected += o.prob * v;
    if (o.state.status === "active" && (likely === null || o.prob > likely.prob)) {
      likely = o;
      likelyStatic = v;
    }
  }
  if (!likely) return expected; // every outcome ends the game
  const shift = expected - likelyStatic;
  return searchValue(likely.state, likely.absent, depth, alpha - shift, beta - shift, ctx) + shift;
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
    threatDepth: -1,
    fullBattles: 0,
    threatMemo: new WeakMap()
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
    const ctx: SearchCtx = {
      ...base,
      deadline,
      threatDepth: depth - 1,
      fullBattles: base.features.fullBattles
    };
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
