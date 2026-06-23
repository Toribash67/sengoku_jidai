import { getMap } from "./maps/registry.js";
import { gameBoard } from "./board.js";
import { suppliedAreas } from "./supply.js";
import { victoryPoints } from "./scoring.js";
import {
  advanceSources,
  available,
  sailReachable,
  reinforceTargets,
  embarkTargets,
  bombardTargets,
  shellTargets,
  supportTypeOccupied
} from "./legality.js";
import { suppliesBonus } from "./validate.js";
import { buildActionSpaces } from "./actionSpaces.js";
import type { ActionSpace } from "./actionSpaces.js";
import type { AreaKind, MapDefinition } from "./maps/riversMap.js";
import type { EndReason, GameState, PendingDecision, Phase, UnitCounts } from "./state.js";
import type { GameMode, GameStatus, SeatId } from "./types.js";
import type { ActionType, BonusType } from "./rules.js";
import type { GameEvent } from "./commands.js";

/** Events as seen by a player. Identity in v1 (perfect information); the seam stays
 *  so future hidden-information redaction has a single choke point. */
export type PlayerGameEvent = GameEvent;

export interface PlayerAreaView {
  id: string;
  kind: AreaKind;
  owner: SeatId | null;
  units: UnitCounts;
  valueStars: 0 | 1 | 2;
  /** Seat that currently supplies this area (at most one at rest), else null. */
  suppliedBy: SeatId | null;
}

export interface LegalMove {
  /** Linked action space to deploy into: "advance-<land>" | "sail-<sea>". */
  spaceId: string;
  type: "advance" | "sail";
  /** Linked land (advance) or sea (sail) the units move INTO. */
  targetAreaId: string;
  /** Legal source areas; `max` is the units there minus one (a source keeps one unit). */
  sources: { areaId: string; max: number }[];
}

/** An offered Bombard or Shell: deploy into the linked space, then pick one enemy target.
 *  Bombard is linked to a supplied water and hits adjacent enemy land; Shell is linked to
 *  a supplied land and hits adjacent enemy water. */
export interface LegalStrike {
  /** Linked action space: "bombard-<sea>" | "shell-<land>". */
  spaceId: string;
  type: "bombard" | "shell";
  /** The supplied water (bombard) or land (shell) the space is linked to. */
  linkedAreaId: string;
  /** Enemy-held areas that may be targeted. */
  targets: string[];
  /** Dice that would be rolled: ships in the linked water (+1 with Pirate Haven) for
   *  bombard; always two for shell. Informational for the UI. */
  dice: number;
}

/** An offered Reinforce (troops) or Embark (ships). These are support spaces with no
 *  linked board tile; `targets` are the areas units may be placed into. */
export interface LegalPlacement {
  /** Support action space: "reinforce-a" | "embark-b" | ... */
  spaceId: string;
  type: "reinforce" | "embark";
  unit: "troop" | "ship";
  /** Areas the seat may place units into. */
  targets: string[];
  /** Units this space allows placing (its amount, +2 for Reinforce with Barracks). */
  pool: number;
  /** Units the seat has in reserve; the placeable total is `min(pool, reserve)`. */
  reserve: number;
}

/** An offered Plan: a support space (no linked tile) that yields a card and, for the one
 *  initiative space, next round's initiative. */
export interface LegalPlan {
  /** Support action space: "plan-a" | "plan-b". */
  spaceId: string;
  /** True for the single Plan space that seizes next-round initiative. */
  initiative: boolean;
}

export interface LegalSpace {
  spaceId: string;
  type: ActionType;
  /** Linked board area for linked actions; null for support spaces. */
  areaId: string | null;
  /** Deployability flag only: the space is free and the viewer could deploy a
   *  commander here now. This is NOT a full per-action criteria check — a deployable
   *  space may still reject the specific action (e.g. no legal move exists). Richer
   *  per-action criteria live in the typed action lists below. */
  legal: boolean;
}

export interface LegalCommandSummary {
  activeSeat: SeatId;
  spaces: LegalSpace[];
  canPass: boolean;
  /** Advance/Sail movements, each with its legal sources. */
  moves: LegalMove[];
  /** Bombard/Shell ranged attacks, each with its enemy targets. */
  strikes: LegalStrike[];
  /** Reinforce/Embark placements, each with its targets and pool. */
  placements: LegalPlacement[];
  /** Plan deployments. */
  plans: LegalPlan[];
}

export interface PlayerGameView {
  schemaVersion: 2;
  gameId: string;
  mapId: string;
  mode: GameMode;
  status: GameStatus;
  round: number;
  phase: Phase;
  initiative: SeatId;
  activeSeat: SeatId;
  viewerSeat: SeatId;
  prompt: string;
  areas: PlayerAreaView[];
  bonuses: Record<string, BonusType>;
  actionSpaces: Record<string, SeatId | null>;
  victoryPoints: Record<SeatId, number>;
  pendingDecision: PendingDecision | null;
  winner: SeatId | null;
  endReason: EndReason | null;
  legal: LegalCommandSummary;
}

export function playerView(state: GameState, viewerSeat: SeatId): PlayerGameView {
  const map = getMap(state.mapId);
  const board = gameBoard(state);

  // Which seat supplies each area (at most one at rest).
  const suppliedBySeat: Record<string, SeatId> = {};
  for (const seat of ["red", "black"] as const) {
    for (const areaId of suppliedAreas(map, board, seat)) {
      suppliedBySeat[areaId] = seat;
    }
  }

  const areas: PlayerAreaView[] = Object.entries(state.areas).map(([id, runtime]) => {
    const mapArea = map.areas[id];
    if (!mapArea) {
      throw new Error(`State area "${id}" has no map definition (mapId: ${state.mapId}).`);
    }
    return {
      id,
      kind: mapArea.kind,
      owner: runtime.owner,
      units: { ...runtime.units },
      valueStars: mapArea.valueStars,
      suppliedBy: suppliedBySeat[id] ?? null
    };
  });

  return {
    schemaVersion: 2,
    gameId: state.gameId,
    mapId: state.mapId,
    mode: state.mode,
    status: state.status,
    round: state.round,
    phase: state.phase,
    initiative: state.initiative,
    activeSeat: state.activeSeat,
    viewerSeat,
    prompt: buildPrompt(state, viewerSeat),
    areas,
    bonuses: { ...state.bonuses },
    actionSpaces: { ...state.actionSpaces },
    victoryPoints: {
      red: victoryPoints(map, board, "red"),
      black: victoryPoints(map, board, "black")
    },
    pendingDecision:
      state.pendingDecision && state.pendingDecision.seat === viewerSeat
        ? state.pendingDecision
        : null,
    winner: state.winner,
    endReason: state.endReason,
    legal: legalCommandsForState(state, viewerSeat)
  };
}

export function legalCommandsForState(state: GameState, seat: SeatId): LegalCommandSummary {
  const map = getMap(state.mapId);
  const catalog = buildActionSpaces(map);
  // Shared deployability gate for every space and for pass.
  const canDeploy =
    state.status === "active" &&
    state.phase === "deploy" &&
    state.activeSeat === seat &&
    state.pendingDecision === null &&
    available(state, seat) > 0;

  const spaces: LegalSpace[] = catalog.map((space) => ({
    spaceId: space.id,
    type: space.type,
    areaId: space.areaId,
    legal: canDeploy && state.actionSpaces[space.id] === null
  }));

  return {
    activeSeat: state.activeSeat,
    spaces,
    canPass: canDeploy,
    moves: canDeploy ? enumerateMoves(state, seat, map, catalog) : [],
    strikes: canDeploy ? enumerateStrikes(state, seat, map, catalog) : [],
    placements: canDeploy ? enumeratePlacements(state, seat, map, catalog) : [],
    plans: canDeploy ? enumeratePlans(state, seat, map, catalog) : []
  };
}

/** Movement targets the seat can deploy into now, each with its legal sources and the
 *  max units each source can spare (units there - 1; a source must keep one unit). */
function enumerateMoves(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: ActionSpace[]
): LegalMove[] {
  const board = gameBoard(state);
  const moves: LegalMove[] = [];
  for (const space of catalog) {
    if (space.type !== "advance" && space.type !== "sail") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes(space.type)) continue;
    const target = space.areaId!;
    if (state.areas[target]?.owner === seat) continue;
    const unit = space.type === "advance" ? "troop" : "ship";
    const reachable =
      space.type === "advance"
        ? advanceSources(map, board, seat, target)
        : sailReachable(map, board, seat, target);
    const sources = [...reachable]
      .map((areaId) => ({ areaId, max: (state.areas[areaId]?.units[unit] ?? 0) - 1 }))
      .filter((s) => s.max >= 1);
    if (sources.length > 0) {
      moves.push({ spaceId: space.id, type: space.type, targetAreaId: target, sources });
    }
  }
  return moves;
}

/** Bombard/Shell strikes the seat can deploy now: the linked area must be supplied and
 *  have at least one enemy target, and (for Bombard) at least one die to roll. */
function enumerateStrikes(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: ActionSpace[]
): LegalStrike[] {
  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const strikes: LegalStrike[] = [];
  for (const space of catalog) {
    if (space.type !== "bombard" && space.type !== "shell") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes(space.type)) continue;
    const linked = space.areaId!;
    if (!supplied.has(linked)) continue;
    // Land areas hold only troops, sea only ships, so an enemy-owned adjacent area always
    // holds the unit this strike removes.
    const targets = (
      space.type === "bombard" ? bombardTargets(map, linked) : shellTargets(map, linked)
    ).filter((id) => state.areas[id]?.owner === enemy);
    if (targets.length === 0) continue;
    const dice =
      space.type === "bombard"
        ? state.areas[linked]!.units.ship + (suppliesBonus(state, seat, "pirateHaven") ? 1 : 0)
        : 2;
    if (dice < 1) continue;
    strikes.push({ spaceId: space.id, type: space.type, linkedAreaId: linked, targets, dice });
  }
  return strikes;
}

/** Reinforce/Embark placements the seat can deploy now: the support type is unused this
 *  round, there is somewhere to place, and the reserve is non-empty. */
function enumeratePlacements(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: ActionSpace[]
): LegalPlacement[] {
  const board = gameBoard(state);
  const placements: LegalPlacement[] = [];
  for (const space of catalog) {
    if (space.type !== "reinforce" && space.type !== "embark") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes(space.type)) continue;
    if (supportTypeOccupied(map, state, seat, space.type)) continue;
    const unit = space.type === "reinforce" ? "troop" : "ship";
    const reserve = state.players[seat].reserve[unit];
    if (reserve <= 0) continue;
    const targets =
      space.type === "reinforce"
        ? [...reinforceTargets(map, board, seat)]
        : [...embarkTargets(map, state, seat)];
    if (targets.length === 0) continue;
    const barracks = space.type === "reinforce" && suppliesBonus(state, seat, "barracks");
    const pool = space.amount! + (barracks ? 2 : 0);
    placements.push({ spaceId: space.id, type: space.type, unit, targets, pool, reserve });
  }
  return placements;
}

/** Plan deployments the seat can make now: every free Plan space, unless a Plan space is
 *  already used this round. */
function enumeratePlans(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: ActionSpace[]
): LegalPlan[] {
  if (supportTypeOccupied(map, state, seat, "plan")) return [];
  const plans: LegalPlan[] = [];
  for (const space of catalog) {
    if (space.type !== "plan") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes("plan")) continue;
    plans.push({ spaceId: space.id, initiative: space.initiative ?? false });
  }
  return plans;
}

export function playerEvents(events: GameEvent[]): PlayerGameEvent[] {
  return events;
}

function buildPrompt(state: GameState, viewer: SeatId): string {
  if (state.status === "abandoned") {
    return "Game abandoned.";
  }
  if (state.status === "complete") {
    return state.winner ? `Game over — ${state.winner} wins.` : "Game over.";
  }
  if (state.pendingDecision) {
    return state.pendingDecision.seat === viewer
      ? state.pendingDecision.prompt
      : `Waiting for ${state.pendingDecision.seat}.`;
  }
  return state.activeSeat === viewer
    ? `Round ${state.round}: deploy a commander or pass.`
    : `Waiting for ${state.activeSeat}.`;
}
