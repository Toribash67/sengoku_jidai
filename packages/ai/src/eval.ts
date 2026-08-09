import {
  gameBoard,
  getMap,
  suppliedAreas,
  type BonusType,
  type GameState,
  type MapDefinition,
  type SeatId
} from "@sengoku-jidai/engine";
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
export function evaluate(state: GameState, seat: SeatId, weights: EvalWeights = DEFAULT_WEIGHTS): number {
  const enemy: SeatId = seat === "red" ? "black" : "red";
  if (state.status === "complete") {
    if (state.winner === seat) return weights.terminal;
    if (state.winner === enemy) return -weights.terminal;
    return 0;
  }
  const map = getMap(state.mapId);
  return rawScore(state, map, seat, weights) - rawScore(state, map, enemy, weights);
}
