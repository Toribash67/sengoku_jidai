import {
  conflictOutcome,
  gameBoard,
  getMap,
  suppliedAreas,
  type BonusType,
  type GameState,
  type MapDefinition,
  type SeatId
} from "@sengoku-jidai/engine";
import { rollTotalDistribution } from "./combatOdds.js";
import { hqDistances, tileBaseValue, type TileValueWeights } from "./geometry.js";

export interface EvalWeights {
  vp: number;
  bonus: Record<BonusType, number>;
  tile: TileValueWeights;
  /** Multiplier applied to controlled-but-unsupplied tiles (0.2 = "big discount, not zero"). */
  unsuppliedFactor: number;
  card: number;
  /** Per catapult on a land the seat holds (Fortress): what the Siege threat adds on top of the
   *  catapult's worth as a troop. Scaled by supply like every other tile term. */
  catapult: number;
  initiative: number;
  /** Magnitude of a terminal win/loss. */
  terminal: number;
  /** Weights fitted to game outcomes, one set per round (index round − 1; later rounds use the
   *  last). When present they replace every term above except `unsuppliedFactor`, `catapult`
   *  and `terminal`. */
  byRound?: readonly RoundWeights[];
}

/** One round's fitted weights. The score is in units of 1/20 of the log-odds of winning. */
export interface RoundWeights {
  /** Per star on a supplied / an unsupplied tile. */
  star: number;
  starUnsupplied: number;
  bonus: Record<BonusType, number>;
  /** Per tile: presence × closeness to the enemy HQ (the old military term's proximity part). */
  proximity: number;
  /** Times √(cards in hand). */
  card: number;
  initiative: number;
  /** Per unit standing next to the enemy HQ. */
  hqPressure: number;
  /** Per commander still to deploy this round. */
  commander: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  vp: 10,
  bonus: { barracks: 3, warRoom: 3, pirateHaven: 2, shipyard: 2, hiddenBase: 2, armoury: 2 },
  catapult: 1,
  tile: { star: 2, bonusSlot: 1.5, proximity: 1 },
  unsuppliedFactor: 0.2,
  card: 1.5,
  initiative: 1,
  terminal: 1000
};

/** First round of fitted weights: logistic regression on who won 2,000 Rivers games between the
 *  search bots playing with the hand-set weights (2026-11-14; see docs/superpowers/results). Kept
 *  as a sparring version. Negative fits are clamped to 0; the Armoury never
 *  appears in Rivers, so it takes the mean of the other bonuses. */
export const TUNED_WEIGHTS_V1: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  byRound: [
    {
      star: 1.54,
      starUnsupplied: 0,
      bonus: {
        barracks: 0.7,
        warRoom: 1.4,
        pirateHaven: 0,
        shipyard: 4.71,
        hiddenBase: 0,
        armoury: 1.36
      },
      proximity: 7.49,
      card: 2.32,
      initiative: 7.3,
      hqPressure: 0,
      commander: 4.35
    },
    {
      star: 1.55,
      starUnsupplied: 3.84,
      bonus: {
        barracks: 1.43,
        warRoom: 2.74,
        pirateHaven: 2.21,
        shipyard: 5.59,
        hiddenBase: 3.58,
        armoury: 3.11
      },
      proximity: 12.3,
      card: 7.39,
      initiative: 1.54,
      hqPressure: 4.85,
      commander: 8.38
    },
    {
      star: 3.42,
      starUnsupplied: 7.11,
      bonus: {
        barracks: 0,
        warRoom: 0,
        pirateHaven: 0,
        shipyard: 0.64,
        hiddenBase: 0.07,
        armoury: 0.14
      },
      proximity: 15.51,
      card: 7.88,
      initiative: 0.78,
      hqPressure: 5.02,
      commander: 11.54
    },
    {
      star: 8.64,
      starUnsupplied: 9.5,
      bonus: {
        barracks: 0,
        warRoom: 0,
        pirateHaven: 0,
        shipyard: 0.66,
        hiddenBase: 0,
        armoury: 0.13
      },
      proximity: 13.84,
      card: 8.07,
      initiative: 1.28,
      hqPressure: 3.26,
      commander: 17.27
    }
  ]
};

/** Second round: the same fit over 4,000 games — the first 2,000 plus 2,000 played by the bots
 *  using TUNED_WEIGHTS_V1. Same clamping. */
export const TUNED_WEIGHTS: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  byRound: [
    {
      star: 2.47,
      starUnsupplied: 4.62,
      bonus: {
        barracks: 8.69,
        warRoom: 9.4,
        pirateHaven: 6.94,
        shipyard: 11.96,
        hiddenBase: 7.32,
        armoury: 8.86
      },
      proximity: 16.32,
      card: 5.47,
      initiative: 0,
      hqPressure: 0,
      commander: 10.86
    },
    {
      star: 1.18,
      starUnsupplied: 5.92,
      bonus: {
        barracks: 4.43,
        warRoom: 6.45,
        pirateHaven: 5.51,
        shipyard: 9.71,
        hiddenBase: 7.02,
        armoury: 6.62
      },
      proximity: 13.19,
      card: 7.93,
      initiative: 0,
      hqPressure: 4.51,
      commander: 10.33
    },
    {
      star: 2.72,
      starUnsupplied: 7.04,
      bonus: {
        barracks: 0,
        warRoom: 3.24,
        pirateHaven: 2.89,
        shipyard: 6.08,
        hiddenBase: 3.49,
        armoury: 3.14
      },
      proximity: 13.95,
      card: 8.38,
      initiative: 0,
      hqPressure: 4.1,
      commander: 11.64
    },
    {
      star: 7.98,
      starUnsupplied: 8.43,
      bonus: {
        barracks: 0,
        warRoom: 1.05,
        pirateHaven: 0,
        shipyard: 5.29,
        hiddenBase: 0.83,
        armoury: 1.43
      },
      proximity: 12.46,
      card: 6.0,
      initiative: 1.35,
      hqPressure: 3.18,
      commander: 17.57
    }
  ]
};

/** Concave presence curve: rewards having a unit at all, with diminishing returns per
 *  extra unit (bounded anyway by the 5/3 per-tile caps). */
function presence(units: number): number {
  return units <= 0 ? 0 : 1 + Math.log2(units);
}

/** Diminishing value of holding more cards. */
function cardValue(hand: number): number {
  return hand <= 0 ? 0 : Math.sqrt(hand);
}

/** Per-seat raw score. Positive is good for `seat`. */
function rawScore(state: GameState, map: MapDefinition, seat: SeatId, w: EvalWeights): number {
  if (w.byRound) return fittedScore(state, map, seat, w, w.byRound);
  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);
  let score = 0;

  for (const [id, rt] of Object.entries(state.areas)) {
    if (rt.owner !== seat) continue;
    const units = rt.units.troop + rt.units.ship; // catapults are counted among the troops
    if (units <= 0) continue; // owned ⟺ has units here; skip defensively
    const sf = supplied.has(id) ? 1 : w.unsuppliedFactor;
    score += w.catapult * Math.min(rt.units.siege, rt.units.troop) * sf; // 0 in Rivers
    const area = map.areas[id]!;
    score += w.vp * area.valueStars * sf; // VP payoff — flat in unit count
    const bonusType = state.bonuses[id];
    if (bonusType) score += w.bonus[bonusType] * sf; // bonus payoff — flat
    score += tileBaseValue(map, seat, id, w.tile) * presence(units) * sf; // military — scales
  }

  score += w.card * cardValue(state.players[seat].hand.length);
  if (state.initiative === seat) score += w.initiative;
  return score;
}

/** Per-seat raw score under the fitted per-round weights. */
function fittedScore(
  state: GameState,
  map: MapDefinition,
  seat: SeatId,
  w: EvalWeights,
  byRound: readonly RoundWeights[]
): number {
  const r = byRound[Math.min(Math.max(state.round, 1), byRound.length) - 1]!;
  const supplied = suppliedAreas(map, gameBoard(state), seat);
  const enemyHq = hqDistances(map, seat === "red" ? "black" : "red");
  let score = 0;

  for (const [id, rt] of Object.entries(state.areas)) {
    if (rt.owner !== seat) continue;
    const units = rt.units.troop + rt.units.ship;
    if (units <= 0) continue;
    const sup = supplied.has(id);
    const sf = sup ? 1 : w.unsuppliedFactor;
    score += w.catapult * Math.min(rt.units.siege, rt.units.troop) * sf; // 0 in Rivers
    score += (sup ? r.star : r.starUnsupplied) * map.areas[id]!.valueStars;
    const bonusType = state.bonuses[id];
    if (bonusType && sup) score += r.bonus[bonusType];
    const d = enemyHq.get(id);
    if (d !== undefined) score += (r.proximity * presence(units) * sf) / (d + 1);
    if (d === 1) score += r.hqPressure * units;
  }

  const p = state.players[seat];
  let occupied = 0;
  for (const owner of Object.values(state.actionSpaces)) if (owner === seat) occupied++;
  score +=
    r.commander *
    (p.commanders.total - occupied - p.commanders.standby - p.commanders.counterattacks);
  score += r.card * cardValue(p.hand.length);
  if (state.initiative === seat) score += r.initiative;
  return score;
}

/** Antisymmetric position value for `seat` (seat − opponent). Terminal states short-circuit. */
export function evaluate(
  state: GameState,
  seat: SeatId,
  weights: EvalWeights = DEFAULT_WEIGHTS
): number {
  const enemy: SeatId = seat === "red" ? "black" : "red";
  if (state.status === "complete") {
    if (state.winner === seat) return weights.terminal;
    if (state.winner === enemy) return -weights.terminal;
    return 0;
  }
  if (state.pendingCombat) return expectedCombatValue(state, seat, weights);
  const map = getMap(state.mapId);
  return rawScore(state, map, seat, weights) - rawScore(state, map, enemy, weights);
}

/** Probability-weighted eval over the defence-roll distribution of the pending combat. The
 *  resolved boards have no pendingCombat, so evaluate() recurses exactly one level. Fort adds
 *  a defence die; ambush/reroll cards are not modelled (documented simplification). Assumes
 *  state.combatQueue is empty (always true at any AI eval call site): pendingCombat is set
 *  either directly by advance/sail/bombard/shell (which never touch combatQueue) or by
 *  advanceCombatQueue, which promotes a queued battle only when the queue drains to empty. The
 *  one state with pendingCombat set AND combatQueue non-empty is a multi-target Commandeer
 *  resolved via a selectCombat decision, which the search never reaches (candidate generation
 *  never plays an operation card). If ever violated, the effect is a mild under-count, never a
 *  mutation or crash. */
function expectedCombatValue(state: GameState, seat: SeatId, weights: EvalWeights): number {
  const pc = state.pendingCombat!;
  const faces = state.rules.diceFaces;

  if (pc.kind === "advance" || pc.kind === "sail") {
    const fort = pc.kind === "advance" && getMap(state.mapId).areas[pc.area]?.fort === true;
    const dist = rollTotalDistribution(faces, 1 + (fort ? 1 : 0));
    let acc = 0;
    for (const { total, prob } of dist) {
      const o = conflictOutcome(total, pc.attackers ?? 0, pc.defenders ?? 0);
      acc += prob * evaluate(resolveAdvanceBoard(state, pc, o), seat, weights);
    }
    return acc;
  }

  // A siege awaiting the defender's Take Cover answer: the roll is known; value it as thrown
  // (the cover discount is the defender's choice and is priced by combatResponse).
  if (pc.phase === "awaiting-cover") {
    return evaluate(resolveStrikeBoard(state, pc, pc.total ?? 0), seat, weights);
  }

  // bombard / shell / siege: the rolled total removes that many enemy units (no capture).
  // Shell's Ship Strike and Siege's Take Cover / Siege Assault (card-gated) are not modelled.
  const dist = rollTotalDistribution(faces, pc.dice ?? 1);
  let acc = 0;
  for (const { total, prob } of dist) {
    acc += prob * evaluate(resolveStrikeBoard(state, pc, total), seat, weights);
  }
  return acc;
}

/** Shallow rebuild of the board after an advance/sail resolves to `o`. Mirrors the ownership
 *  rule in engine actions.ts applyPendingCombat: attacker captures with the survivors, else the
 *  defender holds, else mutual annihilation leaves the tile neutral. */
function resolveAdvanceBoard(
  state: GameState,
  pc: NonNullable<GameState["pendingCombat"]>,
  o: { attackersLeft: number; defendersLeft: number }
): GameState {
  const src = state.areas[pc.area]!;
  const target = { ...src, units: { ...src.units } };
  if (o.attackersLeft > 0) {
    target.owner = pc.attacker;
    target.units[pc.unit] = o.attackersLeft;
  } else if (o.defendersLeft > 0) {
    target.units[pc.unit] = o.defendersLeft; // defender still owns
  } else {
    target.owner = null;
    target.units[pc.unit] = 0;
  }
  return { ...state, areas: { ...state.areas, [pc.area]: target }, pendingCombat: null };
}

/** Shallow rebuild after a bombard/shell removes `total` enemy units (mirrors removeUnits:
 *  losses to reserve — unscored — and an emptied tile goes neutral). */
function resolveStrikeBoard(
  state: GameState,
  pc: NonNullable<GameState["pendingCombat"]>,
  total: number
): GameState {
  const src = state.areas[pc.area]!;
  const target = { ...src, units: { ...src.units } };
  target.units[pc.unit] = Math.max(0, target.units[pc.unit] - total);
  target.units.siege = Math.min(target.units.siege, target.units.troop); // catapults lost last
  if (target.units.troop === 0 && target.units.ship === 0) target.owner = null;
  return { ...state, areas: { ...state.areas, [pc.area]: target }, pendingCombat: null };
}
