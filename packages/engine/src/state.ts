import type { GameMode, GameStatus, SeatId } from "./types.js";
import type { BonusType, RulesConfig } from "./rules.js";

/** Unit kinds. `siege` exists for the Fortress map and is always 0 in Rivers. */
export type UnitType = "troop" | "ship" | "siege";
export type UnitCounts = Record<UnitType, number>;

/** Round phases. */
export type Phase = "deploy" | "recall";

/** Why the game ended (null while active). */
export type EndReason = "hqEliminated" | "victoryPoints";

/** Operation card — no effects ship until the cards phase. */
export type OperationCard = never;

/** A choice offered by a pending decision (future cards seam). */
export interface PendingChoice {
  id: string;
  label: string;
}

/** A decision the engine is waiting on before any other command (future cards). */
export interface PendingDecision {
  id: string;
  seat: SeatId;
  prompt: string;
  choices: PendingChoice[];
}

/**
 * A combat the engine has paused on, waiting for the responsible seat to trigger the roll
 * (the defence die for advance/sail; the attacker's dice for bombard/shell). While set, no
 * other command is legal. Combat is public, so the view exposes it to both seats. The seam
 * for card-driven reroll/extra-dice (future) is a sub-phase added here later.
 */
export interface PendingCombat {
  id: string;
  kind: "advance" | "sail" | "bombard" | "shell";
  attacker: SeatId;
  defender: SeatId;
  /** Who rolls: the defender for advance/sail, the attacker for bombard/shell. */
  responsibleSeat: SeatId;
  /** Target area whose garrison is at stake. */
  area: string;
  /** Combat only ever moves troops (land) or ships (water), never siege. */
  unit: "troop" | "ship";
  /** advance/sail: incoming attacker units held off-board until the roll resolves. */
  attackers?: number;
  /** advance/sail: defender units present when combat began. */
  defenders?: number;
  /** bombard/shell: number of dice the attacker will roll. */
  dice?: number;
}

/** Full per-player unit pools in Rivers (siege unused). Frozen: it's a shared singleton. */
export const RIVERS_UNIT_POOL: Readonly<UnitCounts> = Object.freeze({
  troop: 25,
  ship: 10,
  siege: 0
});

/** Interim starting garrison: troops placed in each player's HQ at setup. */
export const HQ_STARTING_TROOPS = 5;

/** A fresh, independent all-zero unit-counts object. */
export function zeroUnits(): UnitCounts {
  return { troop: 0, ship: 0, siege: 0 };
}

/**
 * Dynamic per-area state. Control IS `owner` (a player controls an area when
 * `owner === seat`); supply is always derived, never stored. At rest an area is
 * single-owner; transient both-sides states exist only inside command resolution.
 */
export interface AreaRuntime {
  owner: SeatId | null;
  units: UnitCounts;
}

export interface PlayerState {
  /** Self-identifying so a `PlayerState` is meaningful without its map key. */
  seat: SeatId;
  reserve: UnitCounts;
  /** `total` commanders; `standby` are passed-out and unavailable until next round. */
  commanders: { total: number; standby: number };
  hand: OperationCard[];
  /** Whether this seat has passed this round. */
  passed: boolean;
}

/**
 * The full dynamic game state (schemaVersion 2). Static facts (adjacency, HQs,
 * stars, bonus slots) live in the MapDefinition; only what changes lives here.
 */
export interface GameState {
  schemaVersion: 2;
  gameId: string;
  mapId: string;
  rules: RulesConfig;
  mode: GameMode;
  status: GameStatus; // "setup" | "active" | "complete" | "abandoned"

  round: number;
  phase: Phase;
  initiative: SeatId; // deploys first this round; VP tiebreak
  activeSeat: SeatId; // whose turn within deploy

  rngState: string;

  players: Record<SeatId, PlayerState>;
  areas: Record<string, AreaRuntime>;
  actionSpaces: Record<string, SeatId | null>; // populated in Plan 3
  bonuses: Record<string, BonusType>; // bonus-slot areaId -> assigned bonus (3 entries)

  /** Monotonic version; bumped once per accepted command. Read by server persistence. */
  revision: number;

  pendingDecision: PendingDecision | null; // unused by actions in v1; populated only by future cards
  pendingCombat: PendingCombat | null; // set while a combat awaits its roll; blocks all other commands
  winner: SeatId | null;
  endReason: EndReason | null;
}
