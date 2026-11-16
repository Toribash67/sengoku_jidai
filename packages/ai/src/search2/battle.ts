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
import { holdProbability } from "./belief.js";
import { HIDDEN, grantCard } from "./hidden.js";

/**
 * The battle resolver. A battle is a small chance process with a few choices in it — dice are
 * thrown, the defender may add Ambush dice, the roller may discard a card to rethrow, a sieged
 * defender may Take Cover — and this module works it out exactly, returning the short list of
 * ways it can end with their probabilities.
 *
 * The AI's own cards are known, so its choices are plain choices. The opponent's are not: where
 * they could play a card, the outcomes split by the counted probability that they hold it, and a
 * holder is assumed to play it whenever that is better for them.
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
  if (pc.phase === "awaiting-cover") return merge(state, coverStep(state, absent, ctx).outcomes);
  if (pc.phase === "rolled") {
    const nDice = pc.rolls?.length ?? 1;
    const outs = afterTotal(state, pc.total ?? 0, nDice, ctx.features.rerollCap, absent, ctx);
    return merge(state, outs);
  }
  return merge(state, rollStep(state, absent, ctx).outcomes);
}

/** The command for the seat on the clock in a pending combat (which must be `ctx.viewer`):
 *  roll with or without Ambush, rethrow or accept, take cover or not. Unlike the look-ahead, a
 *  real reroll is not capped: this is asked again after every throw. */
export function battleDecision(state: GameState, ctx: BattleCtx): Command {
  const pc = state.pendingCombat!;
  const none: Absent = new Set<OperationCard>();
  if (pc.phase === "awaiting-roll") {
    const ambush = rollStep(state, none, ctx).played;
    return { type: "combatRoll", pendingId: pc.id, ...(ambush ? { card: "ambush" as const } : {}) };
  }
  if (pc.phase === "awaiting-cover") {
    const cover = coverStep(state, none, ctx).played;
    return {
      type: "combatResolve",
      pendingId: pc.id,
      ...(cover ? { card: "take_cover" as const } : {})
    };
  }
  const nDice = pc.rolls?.length ?? 1;
  const live: BattleCtx = { ...ctx, features: { ...ctx.features, rerolls: true } };
  const reroll = rerollOption(state, nDice, Math.max(1, ctx.features.rerollCap), none, live);
  if (reroll) {
    const keep = applyTotal(state, pc.total ?? 0, none, ctx);
    if (reroll.value > expected(keep, pc.responsibleSeat, ctx)) {
      return { type: "combatReroll", pendingId: pc.id, card: reroll.card };
    }
  }
  return { type: "combatResolve", pendingId: pc.id };
}

interface Step {
  outcomes: Outcome[];
  /** True when `ctx.viewer` is the one choosing here and chooses to play the card. */
  played: boolean;
}

/** The first throw, with the defender's Ambush option on an Advance. */
function rollStep(state: GameState, absent: Absent, ctx: BattleCtx): Step {
  const pc = state.pendingCombat!;
  const cap = ctx.features.rerollCap;
  const nDice = baseDice(state);
  const without = throwDice(state, nDice, cap, absent, ctx);
  if (pc.kind !== "advance") return { outcomes: without, played: false };
  const defender = pc.responsibleSeat;
  const model = ctx.features.opponentAmbush;
  return cardStep(state, defender, "ambush", model, absent, ctx, without, (s) =>
    throwDice(discard(s, defender, "ambush"), nDice + 2, cap, absent, ctx)
  );
}

/** A point where `seat` may play `card`. `without` is what happens if they do not; `withCard`
 *  works out what happens if they do, from a state in which they certainly hold it. */
function cardStep(
  state: GameState,
  seat: SeatId,
  card: OperationCard,
  modelOpponent: boolean,
  absent: Absent,
  ctx: BattleCtx,
  without: Outcome[],
  withCard: (holding: GameState) => Outcome[]
): Step {
  const hand = state.players[seat].hand;
  if (seat === ctx.viewer) {
    if (!hand.includes(card)) return { outcomes: without, played: false };
    const played = withCard(state);
    return expected(played, seat, ctx) > expected(without, seat, ctx)
      ? { outcomes: played, played: true }
      : { outcomes: without, played: false };
  }
  if (!modelOpponent) return { outcomes: without, played: false };
  const p = holdProbability(state, seat, card, absent);
  const holding = p <= 0 ? null : hand.includes(card) ? state : grantCard(state, seat, card);
  if (!holding) return { outcomes: without, played: false };
  const played = withCard(holding);
  // A holder plays only when it is strictly better for them; otherwise holding or not looks the
  // same from here, so nothing is learned about their hand.
  if (expected(played, seat, ctx) <= expected(without, seat, ctx)) {
    return { outcomes: without, played: false };
  }
  if (p >= 1) return { outcomes: played, played: false };
  const notHeld = without.map((o) => ({ ...o, absent: new Set([...o.absent, card]) }));
  return { outcomes: [...scale(played, p), ...scale(notHeld, 1 - p)], played: false };
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
    return coverStep(next, absent, ctx).outcomes;
  }
  return [{ prob: 1, state: next, absent }];
}

/** A siege waiting on the defender's Take Cover answer. */
function coverStep(state: GameState, absent: Absent, ctx: BattleCtx): Step {
  const pc = state.pendingCombat!;
  const defender = pc.responsibleSeat;
  const accept: Outcome[] = [
    { prob: 1, state: send(state, { type: "combatResolve", pendingId: pc.id }), absent }
  ];
  if (!ctx.features.takeCover) return { outcomes: accept, played: false };
  return cardStep(state, defender, "take_cover", true, absent, ctx, accept, (s) => [
    {
      prob: 1,
      state: send(s, { type: "combatResolve", pendingId: pc.id, card: "take_cover" }),
      absent
    }
  ]);
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
