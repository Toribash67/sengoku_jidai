import { getMap } from "./maps/registry.js";
import { gameBoard } from "./board.js";
import { suppliedAreas } from "./supply.js";
import { victoryPoints } from "./scoring.js";
import { advanceSources, available, sailReachable } from "./legality.js";
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

export interface LegalSpace {
  spaceId: string;
  type: ActionType;
  /** Linked board area for linked actions; null for support spaces. */
  areaId: string | null;
  /** Deployability flag only: the space is free and the viewer could deploy a
   *  commander here now. This is NOT a full per-action criteria check — a deployable
   *  space may still reject the specific action (e.g. no legal move exists). Richer
   *  per-action target enumeration is deferred to the interactive-UI phase. */
  legal: boolean;
}

export interface LegalCommandSummary {
  activeSeat: SeatId;
  spaces: LegalSpace[];
  canPass: boolean;
  moves: LegalMove[];
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
    moves: canDeploy ? enumerateMoves(state, seat, map, catalog) : []
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
