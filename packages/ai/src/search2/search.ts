import {
  legalCommandsForState,
  resolveCommand,
  type Command,
  type GameState,
  type OperationCard
} from "@sengoku-jidai/engine";
import type { SeatId } from "../types.js";
import {
  deployCandidates,
  keyedDeployCandidates,
  moveArchetypes,
  type KeyedCommand
} from "../candidates.js";
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
  /** Move-ordering memory (see OrderMemo); absent → every option is generated and sorted. */
  order?: OrderMemo;
}

/**
 * What earlier parts of the search learned about which option to try first. Working out a
 * position's options is cheap; playing each one out and scoring the result — which is what
 * sorting them needs — is where the time goes. When the first option tried is good enough to
 * end the node (it usually is), the rest never need playing out. Two guesses at that option:
 *  - `best`: the option that came out on top at this same point of the previous, shallower pass;
 *  - `killers`: the options that ended sibling positions the same number of steps from the root.
 * A guess only changes the order options are tried in, never the value the search arrives at.
 */
export interface OrderMemo {
  best: Map<number, string>;
  /** Indexed by the node's remaining depth; cleared between passes. */
  killers: string[][];
  ids: Map<string, number>;
}

/** Refutations remembered per level. */
const KILLERS = 4;

export function newOrderMemo(): OrderMemo {
  return { best: new Map(), killers: [], ids: new Map() };
}

/** An option is searched one step shallower when it comes this late in the order and leads to
 *  no battle, at nodes with at least this much depth left; if it then looks better than what
 *  the earlier options achieved, it is searched again in full. */
const LATE = 3;
const REDUCE_FROM = 3;

/** Identity of the position reached from `path` by the option with signature `key`. */
function step(path: number, key: string, memo: OrderMemo): number {
  let id = memo.ids.get(key);
  if (id === undefined) {
    id = memo.ids.size + 1;
    memo.ids.set(key, id);
  }
  return (Math.imul(path ^ id, 0x9e3779b1) + id) >>> 0;
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
  ctx: SearchCtx,
  path = 0
): number {
  if (ctx.deadline > 0 && Date.now() >= ctx.deadline) throw new SearchTimeout();
  if (state.status !== "active") return evaluate(state, ctx.viewer, ctx.weights);

  if (state.pendingCombat) return chanceValue(state, absent, depth, alpha, beta, ctx, path);

  if (state.pendingDecision) {
    const seat = state.pendingDecision.seat;
    const maximizing = seat === ctx.viewer;
    let value = maximizing ? -Infinity : Infinity;
    let i = 0;
    for (const next of decisionChildren(state, ctx)) {
      const at = Math.imul(path + ++i, 0x85ebca6b) >>> 0;
      const v = searchValue(next.state, absent, depth, -Infinity, Infinity, ctx, at);
      value = maximizing ? Math.max(value, v) : Math.min(value, v);
    }
    return Number.isFinite(value) ? value : evaluate(state, ctx.viewer, ctx.weights);
  }

  if (depth <= 0) return evaluate(state, ctx.viewer, ctx.weights);

  const mover = state.activeSeat;
  const cands = keyedDeployCandidates(state, mover);
  const maximizing = mover === ctx.viewer;
  // The opponent's step: their hand is placeholders, so the options are their card-free ones; the
  // cards they might hold are weighed in by probability: follow-ups per option, deploy-time cards
  // as a penalty on the whole step. The penalty is a constant, so pruning carries on around it.
  const threats = !maximizing && ctx.features.opponentDeployThreats && depth === ctx.threatDepth;
  const memo = ctx.features.orderMemory ? ctx.order : undefined;
  const reduce = ctx.features.reductions && depth >= REDUCE_FROM;

  let lo = alpha;
  let hi = beta;
  let penalty = 0;
  let value = maximizing ? -Infinity : Infinity;
  let bestKey: string | undefined;
  /** Search one option; true when it ends the node. */
  let seen = 0;
  const visit = (k: KeyedChild): boolean => {
    const at = memo ? step(path, k.key, memo) : 0;
    const below = (d: number): number =>
      maximizing
        ? childValue(k, absent, d, lo, hi, ctx, at)
        : opponentChildValue(state, mover, k, absent, d, lo, hi, ctx, at);
    let v: number;
    if (reduce && seen++ >= LATE && isQuiet(k.state)) {
      v = below(depth - 2);
      if (maximizing ? v > lo : v < hi) v = below(depth - 1);
    } else v = below(depth - 1);
    if (maximizing ? v > value : v < value) {
      value = v;
      bestKey = k.key;
    }
    if (maximizing) lo = Math.max(lo, value);
    else hi = Math.min(hi, value);
    if (hi > lo) return false;
    if (memo) {
      const killers = (memo.killers[depth] ??= []);
      const was = killers.indexOf(k.key);
      if (was !== 0) {
        if (was > 0) killers.splice(was, 1);
        killers.unshift(k.key);
        if (killers.length > KILLERS) killers.pop();
      }
    }
    return true;
  };
  const finish = (): number => {
    if (memo && bestKey !== undefined) memo.best.set(path, bestKey);
    return Number.isFinite(value) ? value - penalty : evaluate(state, ctx.viewer, ctx.weights);
  };

  // The guesses first, each played out on its own. The threat penalty needs every option's
  // static value, so a node that has one skips this.
  const tried: string[] = [];
  if (memo && !threats) {
    const hints = [memo.best.get(path), ...(memo.killers[depth] ?? [])];
    for (const key of hints) {
      if (key === undefined || tried.includes(key)) continue;
      const cand = cands.find((c) => c.key === key);
      if (!cand) continue;
      tried.push(key);
      const [kid] = children(state, mover, [cand], ctx);
      if (kid && visit(kid)) return finish();
    }
  }

  const rest = tried.length ? cands.filter((c) => !tried.includes(c.key)) : cands;
  const kids = children(state, mover, rest, ctx);
  const dir = maximizing ? -1 : 1;
  kids.sort((x, y) => dir * (x.shallow - y.shallow));
  if (threats && kids.length > 0) {
    penalty = threatPenalty(state, mover, kids, absent, ctx);
    lo += penalty;
    hi += penalty;
  }
  for (const k of kids) if (visit(k)) break;
  return finish();
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
    const plays = keyed(
      deployCandidates(holding, mover).filter((c) => "card" in c && c.card === card)
    );
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
  ctx: SearchCtx,
  path: number
): number {
  const card = ctx.features.followUps ? FOLLOW_UP_CARD[k.cmd.type] : undefined;
  const prob = card ? holdProbability(state, mover, card, absent) : 0;
  const holding = card && prob > 0 ? grantCard(state, mover, card) : null;
  if (!holding) return childValue(k, absent, depth, alpha, beta, ctx, path);
  const [granted] = children(holding, mover, [k], ctx);
  if (!granted) return childValue(k, absent, depth, alpha, beta, ctx, path);
  const plain = childValue(k, absent, depth, -Infinity, Infinity, ctx, path);
  const withCard = childValue(granted, absent, depth, -Infinity, Infinity, ctx, path ^ 0x5bd1e995);
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
  ctx: SearchCtx,
  path: number
): number {
  const outs = battleOutcomes(state, absent, ctx);
  if (ctx.fullBattles > 0) {
    const below: SearchCtx = { ...ctx, fullBattles: ctx.fullBattles - 1 };
    let value = 0;
    let i = 0;
    for (const o of outs) {
      const at = Math.imul(path + ++i, 0xc2b2ae35) >>> 0;
      value += o.prob * searchValue(o.state, o.absent, depth, -Infinity, Infinity, below, at);
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
  return (
    searchValue(likely.state, likely.absent, depth, alpha - shift, beta - shift, ctx, path) + shift
  );
}

type KeyedChild = Child;

interface Child {
  cmd: Command;
  key: string;
  state: GameState;
  /** Static value of `state` for the viewer: move ordering, and the value itself at a leaf. */
  shallow: number;
}

const isQuiet = (state: GameState): boolean => !state.pendingCombat && !state.pendingDecision;

/** A quiet leaf is worth its static value; anything else is searched. */
function childValue(
  k: Child,
  absent: Absent,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx,
  path = 0
): number {
  if (depth <= 0 && isQuiet(k.state)) return k.shallow;
  return searchValue(k.state, absent, depth, alpha, beta, ctx, path);
}

/** The mover's deploy options with their resulting states, best-first for the mover. */
function deployChildren(state: GameState, mover: SeatId, ctx: BattleCtx): Child[] {
  const kids = children(state, mover, keyedDeployCandidates(state, mover), ctx);
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
  return children(state, pd.seat, keyed(cmds), ctx);
}

function children(
  state: GameState,
  seat: SeatId,
  cmds: readonly KeyedCommand[],
  ctx: BattleCtx
): Child[] {
  const kids: Child[] = [];
  for (const { cmd, key } of cmds) {
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") continue;
    kids.push({
      cmd,
      key,
      state: r.nextState,
      shallow: evaluate(r.nextState, ctx.viewer, ctx.weights)
    });
  }
  return kids;
}

const keyed = (cmds: readonly Command[]): KeyedCommand[] =>
  cmds.map((cmd) => ({ cmd, key: JSON.stringify(cmd) }));

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
    threatMemo: new WeakMap(),
    order: newOrderMemo()
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
    ctx.order!.killers = [];
    const reduce = ctx.features.reductions && depth >= REDUCE_FROM;
    let bestCmd = kids[0]!.cmd;
    let bestValue = -Infinity;
    let a = -Infinity;
    let seen = 0;
    for (const k of kids) {
      const at = step(0, k.key, ctx.order!);
      let v: number;
      if (reduce && seen++ >= LATE && isQuiet(k.state)) {
        v = childValue(k, none, depth - 2, a, Infinity, ctx, at);
        if (v > a) v = childValue(k, none, depth - 1, a, Infinity, ctx, at);
      } else v = childValue(k, none, depth - 1, a, Infinity, ctx, at);
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
