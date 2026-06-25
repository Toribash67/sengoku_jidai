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
import type {
  EndReason,
  GameState,
  OperationCard,
  PendingCombat,
  PendingDecision,
  Phase,
  UnitCounts
} from "./state.js";
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

/** A held operation card the seat could play right now, with the (card-modified) options it
 *  unlocks. The web seeds an order composer from the matching field, then attaches the card to
 *  the command. Only cards in hand with at least one legal option appear. */
export interface LegalCardPlay {
  card: OperationCard;
  action: "advance" | "sail" | "reinforce" | "embark" | "bombard";
  /** advance/sail (ground_assault, river_assault, counterattack). */
  moves?: LegalMove[];
  /** reinforce (mobilise: +2 pool) / embark (commandeer: +1 pool, contested targets). */
  placements?: LegalPlacement[];
  /** bombard (shore_strike: +2 dice). */
  strikes?: LegalStrike[];
  /** ground_assault/river_assault: max reserve units (0–2) addable to the move-in. */
  bonusMax?: number;
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
  /** Operation cards in hand that can be played now, with their card-modified options. */
  cardPlays: LegalCardPlay[];
  /** True when a combat is paused awaiting its roll and this seat is the one who rolls. */
  canRollCombat: boolean;
  /** True when the dice are rolled and this seat may continue (apply the casualties). */
  canResolveCombat: boolean;
  /** True when this seat may discard a card to reroll (dice rolled and hand non-empty). */
  canRerollCombat: boolean;
  /** True when this seat may play Ambush (+2 dice) on the pending defence roll. */
  canAmbush: boolean;
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
  /** The viewer's own cards (hidden from the opponent). */
  hand: OperationCard[];
  /** How many cards the opponent holds (count only — identities are hidden). */
  opponentHandCount: number;
  areas: PlayerAreaView[];
  bonuses: Record<string, BonusType>;
  actionSpaces: Record<string, SeatId | null>;
  victoryPoints: Record<SeatId, number>;
  pendingDecision: PendingDecision | null;
  /** A combat awaiting its roll, if any. Public to both seats (the matchup is not hidden);
   *  `responsibleSeat` says who rolls. Null when no combat is pending. */
  pendingCombat: PendingCombat | null;
  /** Sea battles staged by a multi-target Commandeer awaiting resolution (public, like
   *  `pendingCombat`). Empty unless several battles are queued. */
  combatQueue: PendingCombat[];
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
    hand: [...state.players[viewerSeat].hand],
    opponentHandCount: state.players[viewerSeat === "red" ? "black" : "red"].hand.length,
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
    pendingCombat: state.pendingCombat,
    combatQueue: state.combatQueue,
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
    state.pendingCombat === null &&
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
    plans: canDeploy ? enumeratePlans(state, seat, map, catalog) : [],
    cardPlays: canDeploy ? enumerateCardPlays(state, seat, map, catalog) : [],
    canRollCombat:
      state.pendingCombat !== null &&
      state.pendingCombat.responsibleSeat === seat &&
      state.pendingCombat.phase === "awaiting-roll",
    canResolveCombat:
      state.pendingCombat !== null &&
      state.pendingCombat.responsibleSeat === seat &&
      state.pendingCombat.phase === "rolled",
    canRerollCombat:
      state.pendingCombat !== null &&
      state.pendingCombat.responsibleSeat === seat &&
      state.pendingCombat.phase === "rolled" &&
      state.players[seat].hand.length > 0,
    canAmbush:
      state.pendingCombat !== null &&
      state.pendingCombat.responsibleSeat === seat &&
      state.pendingCombat.phase === "awaiting-roll" &&
      state.pendingCombat.kind === "advance" &&
      state.players[seat].hand.includes("ambush")
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

/** Operation cards the seat holds that can be played now, each carrying its card-modified
 *  options. Built from the same legality helpers as the base lists, with the card's modifier
 *  applied. A card with no legal option is omitted so the UI never offers an unplayable card. */
function enumerateCardPlays(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: ActionSpace[]
): LegalCardPlay[] {
  const hand = new Set(state.players[seat].hand);
  const plays: LegalCardPlay[] = [];
  const reserve = state.players[seat].reserve;

  if (hand.has("ground_assault") && reserve.troop > 0) {
    const moves = enumerateMoves(state, seat, map, catalog).filter((m) => m.type === "advance");
    if (moves.length > 0) {
      plays.push({
        card: "ground_assault",
        action: "advance",
        moves,
        bonusMax: Math.min(2, reserve.troop)
      });
    }
  }
  if (hand.has("river_assault") && reserve.ship > 0) {
    const moves = enumerateMoves(state, seat, map, catalog).filter((m) => m.type === "sail");
    if (moves.length > 0) {
      plays.push({
        card: "river_assault",
        action: "sail",
        moves,
        bonusMax: Math.min(2, reserve.ship)
      });
    }
  }
  if (hand.has("shore_strike")) {
    const strikes = enumerateStrikes(state, seat, map, catalog)
      .filter((s) => s.type === "bombard")
      .map((s) => ({ ...s, dice: s.dice + 2 }));
    if (strikes.length > 0) plays.push({ card: "shore_strike", action: "bombard", strikes });
  }
  if (hand.has("mobilise")) {
    const placements = enumeratePlacements(state, seat, map, catalog)
      .filter((p) => p.type === "reinforce")
      .map((p) => ({ ...p, pool: p.pool + 2 }));
    if (placements.length > 0) plays.push({ card: "mobilise", action: "reinforce", placements });
  }
  if (hand.has("commandeer")) {
    const placements = enumerateCommandeerPlacements(state, seat, map, catalog);
    if (placements.length > 0) plays.push({ card: "commandeer", action: "embark", placements });
  }
  if (hand.has("counterattack")) {
    const moves = enumerateCounterattackMoves(state, seat, map, catalog);
    if (moves.length > 0) plays.push({ card: "counterattack", action: "advance", moves });
  }
  return plays;
}

/** Embark placements as Commandeer sees them: +1 pool and opponent-controlled port water
 *  included as targets (one such target may be contested per Embark). */
function enumerateCommandeerPlacements(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: ActionSpace[]
): LegalPlacement[] {
  const reserve = state.players[seat].reserve.ship;
  if (reserve <= 0) return [];
  if (supportTypeOccupied(map, state, seat, "embark")) return [];
  const targets = [...embarkTargets(map, state, seat, true)];
  if (targets.length === 0) return [];
  const out: LegalPlacement[] = [];
  for (const space of catalog) {
    if (space.type !== "embark") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes("embark")) continue;
    out.push({
      spaceId: space.id,
      type: "embark",
      unit: "ship",
      targets,
      pool: space.amount! + 1,
      reserve
    });
  }
  return out;
}

/** Advance moves Counterattack unlocks: into Advance spaces the opponent's commander occupies,
 *  where a legal advance still exists. */
function enumerateCounterattackMoves(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: ActionSpace[]
): LegalMove[] {
  const board = gameBoard(state);
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const moves: LegalMove[] = [];
  for (const space of catalog) {
    if (space.type !== "advance") continue;
    if (state.actionSpaces[space.id] !== enemy) continue;
    if (!state.rules.enabledActions.includes("advance")) continue;
    const target = space.areaId!;
    if (state.areas[target]?.owner === seat) continue;
    const sources = [...advanceSources(map, board, seat, target)]
      .map((areaId) => ({ areaId, max: (state.areas[areaId]?.units.troop ?? 0) - 1 }))
      .filter((s) => s.max >= 1);
    if (sources.length > 0) {
      moves.push({ spaceId: space.id, type: "advance", targetAreaId: target, sources });
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
  if (state.pendingCombat) {
    const pc = state.pendingCombat;
    if (pc.responsibleSeat !== viewer) {
      return `Waiting for ${pc.responsibleSeat} to resolve combat.`;
    }
    if (pc.phase === "rolled") {
      return "Review the roll, then continue.";
    }
    return pc.kind === "advance" || pc.kind === "sail"
      ? "Roll the defence die."
      : `Roll to ${pc.kind}.`;
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
