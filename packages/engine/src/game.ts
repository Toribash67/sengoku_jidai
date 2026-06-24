import { emptyActionSpaceOccupancy } from "./actionSpaces.js";
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
  type PlayerState,
  type UnitCounts,
  type UnitType
} from "./state.js";

/**
 * Interim starting navies: ships placed in the sea tile above each player's base on
 * the Rivers map. Like {@link HQ_STARTING_TROOPS} this is interim setup hardcoded to
 * the Rivers tile ids; a future map-driven field can supersede it. Areas not present
 * on the active map are simply skipped.
 */
const STARTING_NAVIES: Record<string, { seat: SeatId; ships: number }> = {
  tile14: { seat: "red", ships: 3 },
  tile18: { seat: "black", ships: 3 }
};

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

  // One bonus is drawn per slot, so the ruleset must offer at least as many
  // bonuses as the map has slots (Rivers: 3 slots from a pool of 5).
  if (map.bonusSlots.length > rules.bonusSet.length) {
    throw new Error(
      `Map ${mapId} has ${map.bonusSlots.length} bonus slots but ruleset ${rules.rulesetId} offers only ${rules.bonusSet.length} bonuses`
    );
  }

  let rngState = createRngState(options.seed);

  // TODO (Plan 3): thread a GameEvent[] collector through here and emit a labeled
  // `randomDraw` event (purpose, before/after rngState, outcome) for each draw
  // below, per spec §5 RNG discipline. Deferred until the event pipeline exists.

  // (1) shuffle the bonus pool and assign one to each fixed slot, in slot order.
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

  // Build areas, garrisoning each HQ and the starting navy above each base.
  const areas: Record<string, AreaRuntime> = {};
  for (const area of Object.values(map.areas)) {
    const navy = STARTING_NAVIES[area.id];
    if (area.hq !== null) {
      areas[area.id] = { owner: area.hq, units: { ...zeroUnits(), troop: HQ_STARTING_TROOPS } };
    } else if (navy) {
      areas[area.id] = { owner: navy.seat, units: { ...zeroUnits(), ship: navy.ships } };
    } else {
      areas[area.id] = { owner: null, units: zeroUnits() };
    }
  }

  // Reserve = the full pool minus whatever was placed on the board for that seat.
  // Deriving it (rather than subtracting a fixed garrison) keeps it correct for
  // any starting deployment or HQ count a future map might use.
  const deployed = (seat: SeatId): UnitCounts => {
    const total = zeroUnits();
    for (const a of Object.values(areas)) {
      if (a.owner !== seat) continue;
      for (const k of Object.keys(total) as UnitType[]) total[k] += a.units[k];
    }
    return total;
  };

  const makePlayer = (seat: SeatId): PlayerState => {
    const placed = deployed(seat);
    return {
      seat,
      reserve: {
        troop: RIVERS_UNIT_POOL.troop - placed.troop,
        ship: RIVERS_UNIT_POOL.ship - placed.ship,
        siege: RIVERS_UNIT_POOL.siege - placed.siege
      },
      commanders: { total: rules.commandersPerPlayer, standby: 0 },
      hand: [],
      passed: false
    };
  };

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
    actionSpaces: emptyActionSpaceOccupancy(map),
    bonuses,
    revision: 0,
    pendingDecision: null,
    pendingCombat: null,
    winner: null,
    endReason: null
  };
}
