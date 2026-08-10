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
import { tileBaseValue, type TileValueWeights } from "./geometry.js";

export interface EvalWeights {
  vp: number;
  bonus: Record<BonusType, number>;
  tile: TileValueWeights;
  /** Multiplier applied to controlled-but-unsupplied tiles (0.2 = "big discount, not zero"). */
  unsuppliedFactor: number;
  card: number;
  initiative: number;
  /** Magnitude of a terminal win/loss. */
  terminal: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  vp: 10,
  bonus: { barracks: 3, warRoom: 3, pirateHaven: 2, shipyard: 2, hiddenBase: 2, armoury: 2 },
  tile: { star: 2, bonusSlot: 1.5, proximity: 1 },
  unsuppliedFactor: 0.2,
  card: 1.5,
  initiative: 1,
  terminal: 1000
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
  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);
  let score = 0;

  for (const [id, rt] of Object.entries(state.areas)) {
    if (rt.owner !== seat) continue;
    const units = rt.units.troop + rt.units.ship; // siege is 0 in Rivers
    if (units <= 0) continue; // owned ⟺ has units here; skip defensively
    const sf = supplied.has(id) ? 1 : w.unsuppliedFactor;
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
 *  a defence die; ambush/reroll cards are not modelled (documented simplification). */
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

  // bombard / shell: the rolled total removes that many enemy units (no capture).
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
  if (target.units.troop === 0 && target.units.ship === 0) target.owner = null;
  return { ...state, areas: { ...state.areas, [pc.area]: target }, pendingCombat: null };
}
