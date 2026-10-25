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
  siegeTargets,
  supportTypeOccupied
} from "./legality.js";
import { suppliesBonus } from "./validate.js";
import { siegeAssaultMoves } from "./actions.js";
import { footTroops } from "./state.js";
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

/** Events as seen by a player. Same shape as GameEvent; `playerEvents` is the single
 *  choke point that decides which events a seat may see. */
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
  /** Legal source areas; `max` is the units there minus one (a source keeps one unit).
   *  `siegeMax` (advance, Siege rulesets): catapults there that may move with them. */
  sources: { areaId: string; max: number; siegeMax?: number }[];
}

/** An offered Bombard, Shell or Siege: deploy into the linked space, then pick one enemy
 *  target. Bombard is linked to a supplied water and hits adjacent enemy land; Shell is linked
 *  to a supplied land and hits adjacent enemy water; Siege is linked to a supplied land holding
 *  catapults and hits adjacent enemy land. */
export interface LegalStrike {
  /** Linked action space: "bombard-<sea>" | "shell-<land>" | "siege-<land>". */
  spaceId: string;
  type: "bombard" | "shell" | "siege";
  /** The supplied water (bombard) or land (shell) the space is linked to. */
  linkedAreaId: string;
  /** Enemy-held areas that may be targeted. */
  targets: string[];
  /** Dice that would be rolled: ships in the linked water (+1 with Pirate Haven) for
   *  bombard; always two for shell; catapults in the linked land (+1 with Armoury) for siege.
   *  Informational for the UI. */
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
  /** Units the seat can place from reserve; the placeable total is `min(pool, reserve)`. */
  reserve: number;
  /** Reinforce (Siege rulesets): how many of the placed troops may be catapults — the
   *  space's catapult allowance capped by catapults in reserve. Absent when none. */
  siegeMax?: number;
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
  action: "advance" | "sail" | "reinforce" | "embark" | "bombard" | "siege";
  /** advance/sail (ground_assault, river_assault, counterattack). */
  moves?: LegalMove[];
  /** reinforce (mobilise: +2 pool) / embark (commandeer: +1 pool, contested targets). */
  placements?: LegalPlacement[];
  /** bombard (shore_strike: +2 dice) / siege (volley: +2 dice). */
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
  /** True when the dice are rolled and this seat may continue (apply the casualties) — or,
   *  for a siege's defender in `awaiting-cover`, accept the damage without Take Cover. */
  canResolveCombat: boolean;
  /** True when this seat may discard a card to reroll (dice rolled and hand non-empty). */
  canRerollCombat: boolean;
  /** True when this seat may play Ambush (+2 dice) on the pending defence roll. */
  canAmbush: boolean;
  /** True when this seat defends a siege in `awaiting-cover` and holds Take Cover. */
  canTakeCover: boolean;
  /** The Advance a pending Siege Assault offer allows (answered by an `advance` on its space
   *  with the `siege_assault` card), or null when no such offer is open for this seat. */
  siegeAssault: LegalMove | null;
}

export interface PlayerGameView {
  schemaVersion: 2;
  gameId: string;
  mapId: string;
  /** The ruleset this game plays (e.g. "rivers", "fortress"): picks card art and Siege UI. */
  rulesetId: string;
  mode: GameMode;
  status: GameStatus;
  round: number;
  /** The final round after which victory points are scored (from the ruleset). */
  maxRounds: number;
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
  /** Commanders each seat can still deploy this round (from `available`). */
  commandersRemaining: Record<SeatId, number>;
  /** Total commanders each seat deploys per round (pip count). */
  commandersTotal: Record<SeatId, number>;
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
  /** Present (true) only on spectator views: no seat's private information is included. */
  spectator?: true;
  /** Spectator views only: each seat's card count (identities stay hidden). */
  handCounts?: Record<SeatId, number>;
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
    rulesetId: state.rules.rulesetId,
    mode: state.mode,
    status: state.status,
    round: state.round,
    maxRounds: state.rules.maxRounds,
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
    commandersRemaining: {
      red: available(state, "red"),
      black: available(state, "black")
    },
    commandersTotal: {
      red: state.players.red.commanders.total,
      black: state.players.black.commanders.total
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

/** The read-only projection for a spectator: `playerView` as red with both hands hidden (counts
 *  only), no pending decision, no legal actions and a neutral prompt. `viewerSeat` is nominal
 *  (colours only). */
export function spectatorView(state: GameState): PlayerGameView {
  const view = playerView(state, "red");
  return {
    ...view,
    spectator: true,
    hand: [],
    opponentHandCount: state.players.black.hand.length,
    handCounts: { red: state.players.red.hand.length, black: state.players.black.hand.length },
    pendingDecision: null,
    legal: emptyLegal(state.activeSeat),
    prompt: spectatorPrompt(state)
  };
}

function emptyLegal(activeSeat: SeatId): LegalCommandSummary {
  return {
    activeSeat,
    spaces: [],
    canPass: false,
    moves: [],
    strikes: [],
    placements: [],
    plans: [],
    cardPlays: [],
    canRollCombat: false,
    canResolveCombat: false,
    canRerollCombat: false,
    canAmbush: false,
    canTakeCover: false,
    siegeAssault: null
  };
}

export function legalCommandsForState(state: GameState, seat: SeatId): LegalCommandSummary {
  const map = getMap(state.mapId);
  const catalog = buildActionSpaces(map, state.rules);
  // Shared deployability gate for every space and for pass.
  const canDeploy =
    state.status === "active" &&
    state.phase === "deploy" &&
    state.activeSeat === seat &&
    state.pendingDecision === null &&
    state.pendingCombat === null &&
    available(state, seat) > 0;

  const pc = state.pendingCombat;
  const spaces: LegalSpace[] = catalog.map((space) => ({
    spaceId: space.id,
    type: space.type,
    areaId: space.areaId,
    legal: canDeploy && state.actionSpaces[space.id] === null
  }));

  // The seat's supply, walked once and shared by every enumerator below (the state is fixed for
  // the whole summary, so per-target re-walks would all produce this same set).
  const supplied: ReadonlySet<string> = canDeploy
    ? suppliedAreas(map, gameBoard(state), seat)
    : new Set<string>();

  return {
    activeSeat: state.activeSeat,
    spaces,
    canPass: canDeploy,
    moves: canDeploy ? enumerateMoves(state, seat, map, catalog, supplied) : [],
    strikes: canDeploy ? enumerateStrikes(state, seat, map, catalog, supplied) : [],
    placements: canDeploy ? enumeratePlacements(state, seat, map, catalog, supplied) : [],
    plans: canDeploy ? enumeratePlans(state, seat, map, catalog) : [],
    cardPlays: canDeploy ? enumerateCardPlays(state, seat, map, catalog, supplied) : [],
    canRollCombat: pc !== null && pc.responsibleSeat === seat && pc.phase === "awaiting-roll",
    canResolveCombat:
      pc !== null &&
      pc.responsibleSeat === seat &&
      (pc.phase === "rolled" || pc.phase === "awaiting-cover"),
    canRerollCombat:
      pc !== null &&
      pc.responsibleSeat === seat &&
      pc.phase === "rolled" &&
      state.players[seat].hand.length > 0,
    canAmbush:
      pc !== null &&
      pc.responsibleSeat === seat &&
      pc.phase === "awaiting-roll" &&
      pc.kind === "advance" &&
      state.players[seat].hand.includes("ambush"),
    canTakeCover:
      pc !== null &&
      pc.responsibleSeat === seat &&
      pc.phase === "awaiting-cover" &&
      state.players[seat].hand.includes("take_cover"),
    siegeAssault: siegeAssaultOffer(state, seat)
  };
}

/** The Advance an open Siege Assault offer allows this seat, else null. */
function siegeAssaultOffer(state: GameState, seat: SeatId): LegalMove | null {
  const decision = state.pendingDecision;
  if (decision?.kind !== "siegeAssault" || decision.seat !== seat || !decision.spaceId) {
    return null;
  }
  const target = decision.spaceId.slice("advance-".length);
  const sources = siegeAssaultMoves(state, seat, target).map(({ areaId, max, siegeMax }) => ({
    areaId,
    max,
    ...(siegeMax > 0 ? { siegeMax } : {})
  }));
  return { spaceId: decision.spaceId, type: "advance", targetAreaId: target, sources };
}

/** A move source's spare units, plus (for land) how many catapults may go with them. */
function moveSource(state: GameState, areaId: string, unit: "troop" | "ship") {
  const units = state.areas[areaId]?.units;
  const max = (units?.[unit] ?? 0) - 1;
  const siegeMax = unit === "troop" ? Math.min(units?.siege ?? 0, max) : 0;
  return siegeMax > 0 ? { areaId, max, siegeMax } : { areaId, max };
}

/** Movement targets the seat can deploy into now, each with its legal sources and the
 *  max units each source can spare (units there - 1; a source must keep one unit). */
function enumerateMoves(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: readonly ActionSpace[],
  supplied: ReadonlySet<string>
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
        ? advanceSources(map, board, seat, target, supplied)
        : sailReachable(map, board, seat, target, supplied);
    const sources = [...reachable]
      .map((areaId) => moveSource(state, areaId, unit))
      .filter((s) => s.max >= 1);
    if (sources.length > 0) {
      moves.push({ spaceId: space.id, type: space.type, targetAreaId: target, sources });
    }
  }
  return moves;
}

/** Bombard/Shell/Siege strikes the seat can deploy now: the linked area must be supplied and
 *  have at least one enemy target, and (for Bombard) at least one die to roll / (for Siege)
 *  at least one catapult. */
function enumerateStrikes(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: readonly ActionSpace[],
  supplied: ReadonlySet<string>
): LegalStrike[] {
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const strikes: LegalStrike[] = [];
  for (const space of catalog) {
    if (space.type !== "bombard" && space.type !== "shell" && space.type !== "siege") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes(space.type)) continue;
    const linked = space.areaId!;
    if (!supplied.has(linked)) continue;
    if (space.type === "siege" && state.areas[linked]!.units.siege < 1) continue;
    // Land areas hold only troops, sea only ships, so an enemy-owned adjacent area always
    // holds the unit this strike removes.
    const candidates =
      space.type === "bombard"
        ? bombardTargets(map, linked)
        : space.type === "shell"
          ? shellTargets(map, linked)
          : siegeTargets(map, linked);
    const targets = candidates.filter((id) => state.areas[id]?.owner === enemy);
    if (targets.length === 0) continue;
    const dice =
      space.type === "bombard"
        ? state.areas[linked]!.units.ship +
          (suppliesBonus(state, seat, "pirateHaven", supplied) ? 1 : 0)
        : space.type === "siege"
          ? state.areas[linked]!.units.siege +
            (suppliesBonus(state, seat, "armoury", supplied) ? 1 : 0)
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
  catalog: readonly ActionSpace[],
  supplied: ReadonlySet<string>
): LegalPlacement[] {
  const board = gameBoard(state);
  const placements: LegalPlacement[] = [];
  for (const space of catalog) {
    if (space.type !== "reinforce" && space.type !== "embark") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes(space.type)) continue;
    if (supportTypeOccupied(map, state, seat, space.type)) continue;
    const unit = space.type === "reinforce" ? "troop" : "ship";
    const own = state.players[seat].reserve;
    // Reinforce places foot troops plus up to `siegeAmount` catapults from reserve.
    const siegeMax = unit === "troop" ? Math.min(space.siegeAmount ?? 0, own.siege) : 0;
    const reserve = unit === "troop" ? footTroops(own) + siegeMax : own.ship;
    if (reserve <= 0) continue;
    const targets =
      space.type === "reinforce"
        ? [...reinforceTargets(map, board, seat, supplied)]
        : [...embarkTargets(map, state, seat, false, supplied)];
    if (targets.length === 0) continue;
    const barracks = space.type === "reinforce" && suppliesBonus(state, seat, "barracks", supplied);
    const pool = space.amount! + (barracks ? 2 : 0);
    placements.push({
      spaceId: space.id,
      type: space.type,
      unit,
      targets,
      pool,
      reserve,
      ...(siegeMax > 0 ? { siegeMax } : {})
    });
  }
  return placements;
}

/** Plan deployments the seat can make now: every free Plan space, unless a Plan space is
 *  already used this round. */
function enumeratePlans(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: readonly ActionSpace[]
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
  catalog: readonly ActionSpace[],
  supplied: ReadonlySet<string>
): LegalCardPlay[] {
  const hand = new Set(state.players[seat].hand);
  const plays: LegalCardPlay[] = [];
  const reserve = state.players[seat].reserve;

  if (hand.has("ground_assault") && footTroops(reserve) > 0) {
    const moves = enumerateMoves(state, seat, map, catalog, supplied).filter(
      (m) => m.type === "advance"
    );
    if (moves.length > 0) {
      plays.push({
        card: "ground_assault",
        action: "advance",
        moves,
        bonusMax: Math.min(2, footTroops(reserve))
      });
    }
  }
  if (hand.has("river_assault") && reserve.ship > 0) {
    const moves = enumerateMoves(state, seat, map, catalog, supplied).filter(
      (m) => m.type === "sail"
    );
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
    const strikes = enumerateStrikes(state, seat, map, catalog, supplied)
      .filter((s) => s.type === "bombard")
      .map((s) => ({ ...s, dice: s.dice + 2 }));
    if (strikes.length > 0) plays.push({ card: "shore_strike", action: "bombard", strikes });
  }
  if (hand.has("volley")) {
    const strikes = enumerateStrikes(state, seat, map, catalog, supplied)
      .filter((s) => s.type === "siege")
      .map((s) => ({ ...s, dice: s.dice + 2 }));
    if (strikes.length > 0) plays.push({ card: "volley", action: "siege", strikes });
  }
  if (hand.has("mobilise")) {
    const placements = enumeratePlacements(state, seat, map, catalog, supplied)
      .filter((p) => p.type === "reinforce")
      .map((p) => ({ ...p, pool: p.pool + 2 }));
    if (placements.length > 0) plays.push({ card: "mobilise", action: "reinforce", placements });
  }
  if (hand.has("commandeer")) {
    const placements = enumerateCommandeerPlacements(state, seat, map, catalog, supplied);
    if (placements.length > 0) plays.push({ card: "commandeer", action: "embark", placements });
  }
  if (hand.has("counterattack")) {
    const moves = enumerateCounterattackMoves(state, seat, map, catalog, supplied);
    if (moves.length > 0) plays.push({ card: "counterattack", action: "advance", moves });
  }
  return plays;
}

/** Embark placements as Commandeer sees them: +1 pool and every opponent-controlled sea
 *  included as a target (regardless of supply), so ships can be landed into enemy waters. */
function enumerateCommandeerPlacements(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  catalog: readonly ActionSpace[],
  supplied: ReadonlySet<string>
): LegalPlacement[] {
  const reserve = state.players[seat].reserve.ship;
  if (reserve <= 0) return [];
  if (supportTypeOccupied(map, state, seat, "embark")) return [];
  const targets = [...embarkTargets(map, state, seat, true, supplied)];
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
  catalog: readonly ActionSpace[],
  supplied: ReadonlySet<string>
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
    const sources = [...advanceSources(map, board, seat, target, supplied)]
      .map((areaId) => moveSource(state, areaId, "troop"))
      .filter((s) => s.max >= 1);
    if (sources.length > 0) {
      moves.push({ spaceId: space.id, type: "advance", targetAreaId: target, sources });
    }
  }
  return moves;
}

/** Project engine events for one seat. Fail-closed: only event types explicitly marked
 *  visible below reach clients, so a future event carrying hidden information (card
 *  identities, deck order) is withheld until it is deliberately classified. */
export function playerEvents(events: GameEvent[], viewer: SeatId): PlayerGameEvent[] {
  return events.filter((event) => isEventVisibleTo(event, viewer));
}

/** Events a spectator may see: only those visible to both seats. */
export function spectatorEvents(events: GameEvent[]): PlayerGameEvent[] {
  return events.filter(
    (event) => isEventVisibleTo(event, "red") && isEventVisibleTo(event, "black")
  );
}

function isEventVisibleTo(event: GameEvent, _viewer: SeatId): boolean {
  switch (event.type) {
    case "commanderDeployed":
    case "passed":
    case "unitsMoved":
    case "unitsPlaced":
    case "bonusApplied":
    case "diceRolled":
    case "cardsDrawn":
    case "cardDiscarded":
    case "cardPlayed":
    case "unitsRemoved":
    case "areaCaptured":
    case "capExceeded":
    case "turnAdvanced":
    case "recalled":
    case "initiativeSeized":
    case "gameEnded":
      // All events emitted today are public for both seats: card events carry counts,
      // not identities, and dice rolls are open information in the rules.
      return true;
    default: {
      const unclassified: never = event;
      void unclassified;
      return false;
    }
  }
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
    if (pc.phase === "awaiting-cover") {
      return "Your area is under siege: take cover, or accept the damage.";
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

const seatName = (seat: SeatId): string => (seat === "red" ? "Red" : "Black");

function spectatorPrompt(state: GameState): string {
  if (state.status === "abandoned") return "Game abandoned.";
  if (state.status === "complete") {
    return state.winner ? `Game over — ${state.winner} wins.` : "Game over.";
  }
  if (state.pendingCombat)
    return `${seatName(state.pendingCombat.responsibleSeat)} is resolving combat.`;
  if (state.pendingDecision) return `${seatName(state.pendingDecision.seat)} is deciding.`;
  return `Round ${state.round}: ${seatName(state.activeSeat)} is giving orders.`;
}
