import { getMap } from "./maps/registry.js";
import { riversMapId } from "./maps/riversMap.js";
import { createRngState, nextFloat, shuffle } from "./rng.js";
import { riversRuleset } from "./rules.js";
import type { BonusType, RulesConfig } from "./rules.js";
import type { GameMode, SeatId } from "./types.js";
import {
  HQ_STARTING_TROOPS,
  RIVERS_UNIT_POOL,
  zeroUnits,
  type AreaRuntime,
  type GameState,
  type PlayerState
} from "./state.js";

export interface GameSetupOptions {
  gameId: string;
  /** Seed string; identical seeds replay identically. */
  seed: string;
  mode?: GameMode;
  mapId?: string;
  rules?: RulesConfig;
}

/**
 * Build the opening Rivers position deterministically from a seed.
 *
 * RNG draw order (must stay stable for replay): (1) shuffle bonuses and assign
 * 3 to the map's slots, (2) pick the initiative holder.
 */
export function createInitialState(options: GameSetupOptions): GameState {
  const mapId = options.mapId ?? riversMapId;
  const rules = options.rules ?? riversRuleset;
  const map = getMap(mapId);

  if (map.bonusSlots.length !== 3) {
    throw new Error(`Map ${mapId} must define exactly 3 bonus slots`);
  }
  if (rules.bonusSet.length < 3) {
    throw new Error(`Ruleset ${rules.rulesetId} must offer at least 3 bonuses`);
  }

  let rngState = createRngState(options.seed);

  // (1) shuffle the bonus pool, take 3, assign to the fixed slots.
  const shuffled = shuffle(rngState, rules.bonusSet);
  rngState = shuffled.state;
  const bonuses: Record<string, BonusType> = {};
  map.bonusSlots.forEach((areaId, i) => {
    bonuses[areaId] = shuffled.value[i]!;
  });

  // (2) pick the initiative holder.
  const draw = nextFloat(rngState);
  rngState = draw.state;
  const initiative: SeatId = draw.value < 0.5 ? "red" : "black";

  // Build areas, garrisoning each HQ.
  const areas: Record<string, AreaRuntime> = {};
  for (const area of Object.values(map.areas)) {
    areas[area.id] =
      area.hq !== null
        ? { owner: area.hq, units: { ...zeroUnits(), troop: HQ_STARTING_TROOPS } }
        : { owner: null, units: zeroUnits() };
  }

  const makePlayer = (seat: SeatId): PlayerState => ({
    seat,
    reserve: { ...RIVERS_UNIT_POOL, troop: RIVERS_UNIT_POOL.troop - HQ_STARTING_TROOPS },
    commanders: { total: rules.commandersPerPlayer, standby: 0 },
    hand: [],
    passed: false
  });

  return {
    schemaVersion: 2,
    gameId: options.gameId,
    mapId,
    rules,
    mode: options.mode ?? "hotseat",
    status: "active",
    round: 1,
    phase: "deploy",
    initiative,
    activeSeat: initiative,
    rngState,
    players: { red: makePlayer("red"), black: makePlayer("black") },
    areas,
    actionSpaces: {},
    bonuses,
    winner: null,
    endReason: null
  };
}
