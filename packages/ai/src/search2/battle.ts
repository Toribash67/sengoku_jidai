import {
  expectedRollTotal,
  getMap,
  resolveCommand,
  type Command,
  type GameState,
  type OperationCard
} from "@sengoku-jidai/engine";
import type { SeatId } from "../types.js";
import { rollTotalDistribution } from "../combatOdds.js";
import { evaluate, type EvalWeights } from "../eval.js";
import { cardToSpend } from "./cardRank.js";
import type { Features } from "./features.js";
import { HIDDEN } from "./hidden.js";

/**
 * The battle resolver. A battle is a small chance process with a few choices in it — dice are
 * thrown, the roller may discard a card to rethrow — and this module works it out exactly,
 * returning the short list of ways it can end with their probabilities.
 *
 * Dice are never thrown here: each possible total is forced onto the pending combat and applied
 * with the engine's own `combatResolve`, so captures, caps, HQ elimination and the turn tail stay
 * the engine's job and the state's rng is never read.
 */

export interface BattleCtx {
  /** The seat the AI plays: its cards are known, the other seat's are placeholders. */
  viewer: SeatId;
  weights: EvalWeights;
  features: Features;
}

export interface Outcome {
  prob: number;
  /** The battle is resolved in this state (this pendingCombat is gone). */
  state: GameState;
  /** Card kinds the opponent is assumed not to hold, from here on down this line. */
  absent: ReadonlySet<OperationCard>;
}

type Absent = ReadonlySet<OperationCard>;

/** Every way the pending combat can end, from whatever phase it is in. */
export function battleOutcomes(state: GameState, absent: Absent, ctx: BattleCtx): Outcome[] {
  const pc = state.pendingCombat!;
  if (pc.phase === "awaiting-cover") return merge(state, coverStep(state, absent, ctx));
  if (pc.phase === "rolled") {
    const nDice = pc.rolls?.length ?? 1;
    const outs = afterTotal(state, pc.total ?? 0, nDice, ctx.features.rerollCap, absent, ctx);
    return merge(state, outs);
  }
  return merge(state, throwDice(state, baseDice(state), ctx.features.rerollCap, absent, ctx));
}

/** Dice the responsible seat throws before any card: one defence die (plus the fort's) for an
 *  Advance/Sail, the attacker's dice for a strike. */
function baseDice(state: GameState): number {
  const pc = state.pendingCombat!;
  if (pc.kind === "advance" || pc.kind === "sail") {
    const fort = pc.kind === "advance" && getMap(state.mapId).areas[pc.area]?.fort === true;
    return 1 + (fort ? 1 : 0);
  }
  return pc.dice ?? 1;
}

/** Throw `nDice` and let the roller keep or rethrow each total. */
function throwDice(
  state: GameState,
  nDice: number,
  rerollsLeft: number,
  absent: Absent,
  ctx: BattleCtx
): Outcome[] {
  const faces = state.rules.diceFaces;
  const dist = ctx.features.diceDistribution
    ? rollTotalDistribution(faces, nDice)
    : [{ total: expectedRollTotal(faces, nDice), prob: 1 }];
  const reroll = rerollOption(state, nDice, rerollsLeft, absent, ctx);
  const out: Outcome[] = [];
  for (const { total, prob } of dist) {
    out.push(...scale(keepOrReroll(state, total, reroll, absent, ctx), prob));
  }
  return out;
}

/** The dice already show `total`: keep it or rethrow. */
function afterTotal(
  state: GameState,
  total: number,
  nDice: number,
  rerollsLeft: number,
  absent: Absent,
  ctx: BattleCtx
): Outcome[] {
  return keepOrReroll(
    state,
    total,
    rerollOption(state, nDice, rerollsLeft, absent, ctx),
    absent,
    ctx
  );
}

interface RerollOption {
  card: OperationCard;
  outcomes: Outcome[];
  /** Expected value of rethrowing, from the roller's seat. */
  value: number;
}

/** What rethrowing would give the roller, or null when they cannot (or the search may not).
 *  Independent of the total being replaced, so it is computed once per throw. */
function rerollOption(
  state: GameState,
  nDice: number,
  rerollsLeft: number,
  absent: Absent,
  ctx: BattleCtx
): RerollOption | null {
  if (!ctx.features.rerolls || rerollsLeft <= 0) return null;
  const roller = state.pendingCombat!.responsibleSeat;
  const card = rerollCard(state, roller, ctx);
  if (card === null) return null;
  const outcomes = throwDice(discard(state, roller, card), nDice, rerollsLeft - 1, absent, ctx);
  return { card, outcomes, value: expected(outcomes, roller, ctx) };
}

/** The roller keeps `total` unless rethrowing is strictly better for them. */
function keepOrReroll(
  state: GameState,
  total: number,
  reroll: RerollOption | null,
  absent: Absent,
  ctx: BattleCtx
): Outcome[] {
  const keep = applyTotal(state, total, absent, ctx);
  if (!reroll) return keep;
  const roller = state.pendingCombat!.responsibleSeat;
  return reroll.value > expected(keep, roller, ctx) ? reroll.outcomes : keep;
}

/** The card a roller gives up to rethrow: the AI spends its least useful card; the opponent is
 *  assumed to spend one we know nothing about before one this line has pinned down. */
function rerollCard(state: GameState, roller: SeatId, ctx: BattleCtx): OperationCard | null {
  const hand = state.players[roller].hand;
  if (roller !== ctx.viewer && hand.includes(HIDDEN)) return HIDDEN;
  return cardToSpend(hand);
}

/** Land `total` on the board through the engine. */
function applyTotal(state: GameState, total: number, absent: Absent, ctx: BattleCtx): Outcome[] {
  const pc = state.pendingCombat!;
  const rolled: GameState = {
    ...state,
    pendingCombat: { ...pc, phase: "rolled", total, rolls: [total] }
  };
  const next = send(rolled, { type: "combatResolve", pendingId: pc.id });
  if (next.pendingCombat?.id === pc.id && next.pendingCombat.phase === "awaiting-cover") {
    return coverStep(next, absent, ctx);
  }
  return [{ prob: 1, state: next, absent }];
}

/** A siege waiting on the defender's Take Cover answer: the defender takes the damage. */
function coverStep(state: GameState, absent: Absent, _ctx: BattleCtx): Outcome[] {
  const pc = state.pendingCombat!;
  return [{ prob: 1, state: send(state, { type: "combatResolve", pendingId: pc.id }), absent }];
}

/** Issue `cmd` as the combat's responsible seat; a rejection is a resolver bug. */
function send(state: GameState, cmd: Command): GameState {
  const r = resolveCommand(state, { seat: state.pendingCombat!.responsibleSeat }, cmd);
  if (r.status !== "accepted") {
    throw new Error(`battle resolver: ${cmd.type} rejected (${r.reason.code})`);
  }
  return r.nextState;
}

/** A copy of `state` with one `card` moved from `seat`'s hand to the discard pile. */
function discard(state: GameState, seat: SeatId, card: OperationCard): GameState {
  const hand = state.players[seat].hand;
  const i = hand.indexOf(card);
  if (i < 0) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...state.players[seat], hand: [...hand.slice(0, i), ...hand.slice(i + 1)] }
    },
    discard: [...state.discard, card]
  };
}

function expected(outs: Outcome[], seat: SeatId, ctx: BattleCtx): number {
  let v = 0;
  for (const o of outs) v += o.prob * evaluate(o.state, seat, ctx.weights);
  return v;
}

function scale(outs: Outcome[], factor: number): Outcome[] {
  return factor === 1 ? outs : outs.map((o) => ({ ...o, prob: o.prob * factor }));
}

/** Sum the probabilities of outcomes that ended the same way: same result on the contested
 *  area, same cards left and spent, same assumptions. Keeps first-seen order. */
function merge(before: GameState, outs: Outcome[]): Outcome[] {
  const area = before.pendingCombat!.area;
  const merged = new Map<string, Outcome>();
  for (const o of outs) {
    if (o.prob <= 0) continue;
    const key = JSON.stringify([
      o.state.areas[area],
      o.state.players.red.hand,
      o.state.players.black.hand,
      o.state.discard,
      [...o.absent].sort()
    ]);
    const seen = merged.get(key);
    if (seen) seen.prob += o.prob;
    else merged.set(key, { ...o });
  }
  return [...merged.values()];
}
