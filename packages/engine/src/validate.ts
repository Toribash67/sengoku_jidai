import type { Command, CommandActor, Move, Placement, RejectionReason } from "./commands.js";
import type { GameState, OperationCard } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { actionSpaceMap, type ActionSpace } from "./actionSpaces.js";
import { gameBoard } from "./board.js";
import { suppliedAreas } from "./supply.js";
import {
  advanceSources,
  sailReachable,
  reinforceTargets,
  embarkTargets,
  bombardTargets,
  shellTargets,
  supportTypeOccupied,
  available
} from "./legality.js";
import type { BonusType } from "./rules.js";

function reject(code: RejectionReason["code"], message: string): RejectionReason {
  return { code, message } as RejectionReason;
}

/** Returns a RejectionReason if the command is illegal in `state`, else null. */
export function validateCommand(
  state: GameState,
  actor: CommandActor,
  command: Command
): RejectionReason | null {
  // Pending-combat gate: while a combat is paused, only the responsible seat may act, and
  // only combatRoll (before rolling) then combatResolve (after) are legal.
  if (state.pendingCombat) {
    const pc = state.pendingCombat;
    if (
      command.type !== "combatRoll" &&
      command.type !== "combatReroll" &&
      command.type !== "combatResolve"
    ) {
      return reject("pendingDecisionRequired", "Resolve the pending combat first.");
    }
    if (pc.id !== command.pendingId) {
      return reject("pendingDecisionNotFound", "No such pending combat.");
    }
    if (pc.responsibleSeat !== actor.seat) {
      return reject("notActiveSeat", "This seat cannot act on this combat.");
    }
    if (command.type === "combatRoll" && pc.phase !== "awaiting-roll") {
      return reject("pendingDecisionRequired", "The dice have already been rolled.");
    }
    if (command.type === "combatResolve" && pc.phase !== "rolled") {
      return reject("pendingDecisionRequired", "Roll the dice before resolving.");
    }
    if (command.type === "combatReroll") {
      if (pc.phase !== "rolled") {
        return reject("pendingDecisionRequired", "Roll the dice before rerolling.");
      }
      if (!state.players[actor.seat].hand.includes(command.card)) {
        return reject("illegalChoice", "That card is not in your hand.");
      }
    }
    return null;
  }
  if (
    command.type === "combatRoll" ||
    command.type === "combatReroll" ||
    command.type === "combatResolve"
  ) {
    return reject("pendingDecisionNotFound", "No combat is awaiting a roll.");
  }

  // Pending-decision gate (future cards seam).
  if (state.pendingDecision && command.type !== "choosePendingDecision") {
    return reject("pendingDecisionRequired", "A pending decision must be answered first.");
  }
  if (command.type === "choosePendingDecision") {
    if (!state.pendingDecision || state.pendingDecision.id !== command.pendingId) {
      return reject("pendingDecisionNotFound", "No such pending decision.");
    }
    if (state.pendingDecision.seat !== actor.seat) {
      return reject("notActiveSeat", "This seat cannot answer the pending decision.");
    }
    if (!state.pendingDecision.choices.some((c) => c.id === command.choice.id)) {
      return reject("illegalChoice", "Illegal choice.");
    }
    return null;
  }

  if (state.status !== "active") return reject("gameNotActive", "The game is not active.");
  if (state.phase !== "deploy") return reject("wrongPhase", "Not the deploy phase.");
  if (state.activeSeat !== actor.seat)
    return reject("notActiveSeat", "It is not this seat's turn.");

  if (available(state, actor.seat) <= 0) {
    return reject("noCommanders", "No commanders available to deploy this round.");
  }

  const map = getMap(state.mapId);
  const rules = state.rules;

  if (command.type === "pass") return null;

  const seat = actor.seat;
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const card = "card" in command ? command.card : undefined;

  const spaces = actionSpaceMap(map);
  const space = spaces[command.spaceId];
  if (!space) return reject("spaceNotFound", "No such action space.");
  if (space.type !== command.type) return reject("spaceWrongType", "Wrong space type for command.");

  // Counterattack is the only deploy that may land on an occupied Advance space — and only
  // one the OPPONENT holds. Every other command needs the space free.
  const isCounterattack = command.type === "advance" && card === "counterattack";
  if (isCounterattack) {
    if (state.actionSpaces[command.spaceId] !== enemy) {
      return reject(
        "spaceOccupied",
        "Counterattack requires the opponent's commander on this Advance space."
      );
    }
  } else if (state.actionSpaces[command.spaceId] != null) {
    return reject("spaceOccupied", "That action space is occupied.");
  }
  if (!rules.enabledActions.includes(space.type)) {
    return reject("actionDisabled", "That action is disabled in this ruleset.");
  }

  // A played card must be held and legal for this action (ambush/ship_strike are combat-only).
  if (card !== undefined) {
    const cardRejection = validateCardPlay(state, seat, command.type, card);
    if (cardRejection) return cardRejection;
  }

  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);

  switch (command.type) {
    case "advance":
      return validateAdvance(state, seat, space, command.moves, card, command.cardBonus);
    case "sail":
      return validateSail(state, seat, space, command.moves, card, command.cardBonus);
    case "bombard":
      return validateBombard(state, seat, space, command.targetAreaId, supplied);
    case "shell":
      return validateShell(state, seat, space, command.targetAreaId, supplied);
    case "reinforce":
      return validateReinforce(state, seat, space, command.placements, card);
    case "embark":
      return validateEmbark(state, seat, space, command.placements, card);
    case "plan":
      return supportTypeOccupied(map, state, seat, "plan")
        ? reject("supportTypeUsed", "Already used a Plan space this round.")
        : null;
  }
}

/** Which action each deploy-time card is played with; the two combat-time cards map to
 *  undefined (they ride on combat, never a deploy command). */
const CARD_ACTION: Record<OperationCard, Command["type"] | undefined> = {
  mobilise: "reinforce",
  commandeer: "embark",
  ground_assault: "advance",
  river_assault: "sail",
  shore_strike: "bombard",
  counterattack: "advance",
  ambush: undefined,
  ship_strike: undefined
};

/** A played card must be in the seat's hand and matched to the action it modifies. */
function validateCardPlay(
  state: GameState,
  seat: SeatId,
  action: Command["type"],
  card: OperationCard
): RejectionReason | null {
  if (!state.players[seat].hand.includes(card)) {
    return reject("illegalChoice", "That card is not in your hand.");
  }
  if (CARD_ACTION[card] !== action) {
    return reject("illegalChoice", "That card cannot be played with this action.");
  }
  return null;
}

function validateAdvance(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  moves: Move[],
  card?: OperationCard,
  cardBonus?: number
): RejectionReason | null {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const target = space.areaId!;
  if (state.areas[target]?.owner === seat) {
    return reject("criteriaNotMet", "You already control the linked land.");
  }
  if (moves.length === 0) return reject("illegalMove", "Advance must move at least one troop.");
  const legalSources = advanceSources(map, board, seat, target);
  const perSource = new Map<string, number>();
  for (const m of moves) {
    if (!legalSources.has(m.from)) return reject("illegalMove", `Illegal source ${m.from}.`);
    if (m.count < 1) return reject("illegalMove", "Move count must be >= 1.");
    perSource.set(m.from, (perSource.get(m.from) ?? 0) + m.count);
  }
  let total = 0;
  for (const [from, count] of perSource) {
    const have = state.areas[from]?.units.troop ?? 0;
    if (count > have - 1) return reject("illegalMove", "Cannot take the last unit.");
    total += count;
  }
  if (total < 1) return reject("illegalMove", "Advance must move at least one troop.");
  return validateCardBonus(state, seat, "troop", card, "ground_assault", cardBonus);
}

/** Ground/River Assault add 0–2 reserve units to the move-in; any other card (or none) must
 *  carry no bonus. */
function validateCardBonus(
  state: GameState,
  seat: SeatId,
  unit: "troop" | "ship",
  card: OperationCard | undefined,
  assaultCard: OperationCard,
  cardBonus: number | undefined
): RejectionReason | null {
  const bonus = cardBonus ?? 0;
  if (card === assaultCard) {
    const limit = Math.min(2, state.players[seat].reserve[unit]);
    if (bonus < 0 || bonus > limit) {
      return reject("illegalMove", `Assault bonus must be 0–${limit}.`);
    }
  } else if (bonus !== 0) {
    return reject("illegalMove", "No assault bonus without the matching card.");
  }
  return null;
}

function validateSail(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  moves: Move[],
  card?: OperationCard,
  cardBonus?: number
): RejectionReason | null {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const target = space.areaId!;
  if (state.areas[target]?.owner === seat) {
    return reject("criteriaNotMet", "You already control the linked water.");
  }
  if (moves.length === 0) return reject("illegalMove", "Sail must move at least one ship.");
  const reachable = sailReachable(map, board, seat, target);
  const perSource = new Map<string, number>();
  for (const m of moves) {
    if (!reachable.has(m.from)) return reject("illegalMove", `Unreachable source ${m.from}.`);
    if (m.count < 1) return reject("illegalMove", "Move count must be >= 1.");
    perSource.set(m.from, (perSource.get(m.from) ?? 0) + m.count);
  }
  let total = 0;
  for (const [from, count] of perSource) {
    const have = state.areas[from]?.units.ship ?? 0;
    if (count > have - 1) return reject("illegalMove", "Cannot take the last unit.");
    total += count;
  }
  if (total < 1) return reject("illegalMove", "Sail must move at least one ship.");
  return validateCardBonus(state, seat, "ship", card, "river_assault", cardBonus);
}

function validateBombard(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  targetAreaId: string,
  supplied: Set<string>
): RejectionReason | null {
  const map = getMap(state.mapId);
  const water = space.areaId!;
  if (!supplied.has(water)) return reject("criteriaNotMet", "You do not supply the linked water.");
  if (!bombardTargets(map, water).includes(targetAreaId)) {
    return reject("illegalTarget", "Target is not land adjacent to the linked water.");
  }
  const enemy: SeatId = seat === "red" ? "black" : "red";
  if (state.areas[targetAreaId]?.owner !== enemy) {
    return reject("illegalTarget", "Target has no enemy units.");
  }
  return null;
}

function validateShell(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  targetAreaId: string,
  supplied: Set<string>
): RejectionReason | null {
  const map = getMap(state.mapId);
  const land = space.areaId!;
  if (!supplied.has(land)) return reject("criteriaNotMet", "You do not supply the linked land.");
  if (!shellTargets(map, land).includes(targetAreaId)) {
    return reject("illegalTarget", "Target is not water adjacent to the linked land.");
  }
  const enemy: SeatId = seat === "red" ? "black" : "red";
  if (state.areas[targetAreaId]?.owner !== enemy) {
    return reject("illegalTarget", "Target has no enemy units.");
  }
  return null;
}

function validateReinforce(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  placements: Placement[],
  card?: OperationCard
): RejectionReason | null {
  const map = getMap(state.mapId);
  if (supportTypeOccupied(map, state, seat, "reinforce")) {
    return reject("supportTypeUsed", "Already used a Reinforce space this round.");
  }
  const board = gameBoard(state);
  const targets = reinforceTargets(map, board, seat);
  const barracks = suppliesBonus(state, seat, "barracks");
  // Mobilise raises the placement limit by 2.
  const n = space.amount! + (barracks ? 2 : 0) + (card === "mobilise" ? 2 : 0);
  return validatePlacements(state, seat, placements, targets, n, "troop");
}

function validateEmbark(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  placements: Placement[],
  card?: OperationCard
): RejectionReason | null {
  const map = getMap(state.mapId);
  if (supportTypeOccupied(map, state, seat, "embark")) {
    return reject("supportTypeUsed", "Already used an Embark space this round.");
  }
  // Commandeer raises the limit by 1 and may target opponent-controlled water (which stages a
  // single sail-style move-in), so only one contested target is allowed per Embark.
  const commandeer = card === "commandeer";
  const targets = embarkTargets(map, state, seat, commandeer);
  const pool = space.amount! + (commandeer ? 1 : 0);
  if (commandeer) {
    const enemy: SeatId = seat === "red" ? "black" : "red";
    const contested = placements.filter((p) => state.areas[p.area]?.owner === enemy);
    if (contested.length > 1) {
      return reject("illegalPlacement", "Commandeer may contest only one water area.");
    }
  }
  return validatePlacements(state, seat, placements, targets, pool, "ship");
}

function validatePlacements(
  state: GameState,
  seat: SeatId,
  placements: Placement[],
  targets: Set<string>,
  n: number,
  unit: "troop" | "ship"
): RejectionReason | null {
  if (placements.length === 0) return reject("illegalPlacement", "Place at least one unit.");
  let total = 0;
  for (const p of placements) {
    if (!targets.has(p.area)) return reject("illegalPlacement", `Illegal target ${p.area}.`);
    if (p.count < 1) return reject("illegalPlacement", "Count must be >= 1.");
    total += p.count;
  }
  if (total > n) return reject("illegalPlacement", `Placed ${total} > limit ${n}.`);
  if (total > state.players[seat].reserve[unit]) {
    return reject("insufficientReserve", "Not enough units in reserve.");
  }
  return null;
}

/** Whether the seat currently supplies the area holding the given bonus. */
export function suppliesBonus(state: GameState, seat: SeatId, bonus: BonusType): boolean {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);
  for (const [areaId, b] of Object.entries(state.bonuses)) {
    if (b === bonus && supplied.has(areaId)) return true;
  }
  return false;
}
