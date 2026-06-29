import { emptyActionSpaceOccupancy } from "./actionSpaces.js";
import { RIVERS_DECK } from "./cards.js";
import { getMap } from "./maps/registry.js";
import { riversMapId } from "./maps/riversMap.js";
import { createRngState, nextFloat, shuffle } from "./rng.js";
import { riversRuleset } from "./rules.js";
import type { BonusType, RulesConfig } from "./rules.js";
import type { GameMode, SeatId } from "./types.js";
import {
  RIVERS_UNIT_POOL,
  zeroUnits,
  type AreaRuntime,
  type GameState,
  type OperationCard,
  type PlayerState,
  type UnitCounts,
  type UnitType
} from "./state.js";

/**
 * Interim starting deployment for the Rivers map: the units each player begins with on the
 * board, keyed by tile id. Black mirrors Red across the board's 180° symmetry
 * (tile1↔tile5, tile9↔tile13 HQ, tile10↔tile12, tile14↔tile18, tile19↔tile21). Hardcoded to
 * the Rivers tile ids; a future map-driven field can supersede it. Areas absent from the
 * active map are skipped, and each player's reserve is derived from this (pool − deployed).
 */
const RIVERS_STARTING_UNITS: Record<string, { seat: SeatId; troop?: number; ship?: number }> = {
  // Red
  tile1: { seat: "red", troop: 2 },
  tile9: { seat: "red", troop: 3 }, // Red HQ
  tile10: { seat: "red", troop: 2 },
  tile14: { seat: "red", ship: 3 },
  tile19: { seat: "red", troop: 3 },
  // Black — mirror of Red
  tile5: { seat: "black", troop: 2 },
  tile13: { seat: "black", troop: 3 }, // Black HQ
  tile12: { seat: "black", troop: 2 },
  tile18: { seat: "black", ship: 3 },
  tile21: { seat: "black", troop: 3 }
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

  // (3) shuffle the single shared operation-card deck (only when the ruleset uses cards).
  // Appended AFTER the bonus + initiative draws so those outcomes are unchanged.
  let deck: OperationCard[] = [];
  if (rules.cards) {
    const shuffledDeck = shuffle(rngState, RIVERS_DECK);
    rngState = shuffledDeck.state;
    deck = shuffledDeck.value;
  }

  // Build areas from the starting deployment. An HQ tile is owned by its faction even if a
  // future deployment leaves it ungarrisoned; otherwise ownership follows the deploying seat.
  const areas: Record<string, AreaRuntime> = {};
  for (const area of Object.values(map.areas)) {
    const start = (map.startingDeployment ?? RIVERS_STARTING_UNITS)[area.id];
    const units = zeroUnits();
    if (start) {
      units.troop = start.troop ?? 0;
      units.ship = start.ship ?? 0;
    }
    areas[area.id] = { owner: area.hq ?? start?.seat ?? null, units };
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
      commanders: { total: rules.commandersPerPlayer, standby: 0, counterattacks: 0 },
      hand: [],
      passed: false
    };
  };

  return {
    schemaVersion: 3,
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
    deck,
    discard: [],
    areas,
    actionSpaces: emptyActionSpaceOccupancy(map),
    bonuses,
    revision: 0,
    pendingDecision: null,
    pendingCombat: null,
    combatQueue: [],
    winner: null,
    endReason: null
  };
}
