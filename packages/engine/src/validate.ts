import type { Command, CommandActor, Move, Placement, RejectionReason } from "./commands.js";
import type { GameState, OperationCard } from "./state.js";
import { footTroops } from "./state.js";
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
  siegeTargets,
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
    if (command.type === "combatRoll") {
      if (pc.phase !== "awaiting-roll") {
        return reject("pendingDecisionRequired", "The dice have already been rolled.");
      }
      // Ambush is the only card playable at the roll: the defender of an Advance-initiated
      // land conflict adds two dice.
      if (command.card !== undefined) {
        if (command.card !== "ambush") {
          return reject("illegalChoice", "Only Ambush can be played on a defence roll.");
        }
        if (pc.kind !== "advance") {
          return reject("illegalChoice", "Ambush applies only to a land conflict from an Advance.");
        }
        if (!state.players[actor.seat].hand.includes("ambush")) {
          return reject("illegalChoice", "That card is not in your hand.");
        }
      }
    }
    if (command.type === "combatResolve") {
      if (pc.phase === "awaiting-roll") {
        return reject("pendingDecisionRequired", "Roll the dice before resolving.");
      }
      // Take Cover is the only card playable on a resolve: by a siege's defender, once the
      // attacker has accepted the roll (the `awaiting-cover` phase).
      if (command.card !== undefined) {
        if (command.card !== "take_cover" || pc.phase !== "awaiting-cover") {
          return reject("illegalChoice", "Only Take Cover can be played, against a Siege.");
        }
        if (!state.players[actor.seat].hand.includes("take_cover")) {
          return reject("illegalChoice", "That card is not in your hand.");
        }
      }
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

  // Siege Assault follow-up: the offered decision is answered by an Advance on its space
  // carrying the card (no commander, occupancy ignored), or by declining.
  const decision = state.pendingDecision;
  if (decision?.kind === "siegeAssault" && command.type === "advance") {
    if (decision.seat !== actor.seat) {
      return reject("notActiveSeat", "This seat cannot answer the pending decision.");
    }
    if (command.card !== "siege_assault" || command.spaceId !== decision.spaceId) {
      return reject("illegalChoice", "Siege Assault must advance into the sieged area.");
    }
    if (!state.players[actor.seat].hand.includes("siege_assault")) {
      return reject("illegalChoice", "That card is not in your hand.");
    }
    const space = actionSpaceMap(getMap(state.mapId), state.rules)[command.spaceId];
    if (!space) return reject("spaceNotFound", "No such action space.");
    return validateAdvance(
      state,
      actor.seat,
      space,
      command.moves,
      command.card,
      command.cardBonus
    );
  }

  // Pending-decision gate.
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

  const spaces = actionSpaceMap(map, state.rules);
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
    case "siege":
      return validateSiege(state, seat, space, command.targetAreaId, supplied);
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

/** Which action each deploy-time card is played with; the combat-time and follow-up cards map
 *  to undefined (they ride on combat or a pending decision, never a deploy command). */
const CARD_ACTION: Record<OperationCard, Command["type"] | undefined> = {
  mobilise: "reinforce",
  commandeer: "embark",
  ground_assault: "advance",
  river_assault: "sail",
  shore_strike: "bombard",
  counterattack: "advance",
  volley: "siege",
  ambush: undefined,
  ship_strike: undefined,
  take_cover: undefined,
  siege_assault: undefined
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
  const perSource = new Map<string, { count: number; siege: number }>();
  for (const m of moves) {
    if (!legalSources.has(m.from)) return reject("illegalMove", `Illegal source ${m.from}.`);
    if (m.count < 1) return reject("illegalMove", "Move count must be >= 1.");
    const siege = m.siege ?? 0;
    if (!Number.isInteger(siege) || siege < 0 || siege > m.count) {
      return reject("illegalMove", "Catapults moved must be 0–count.");
    }
    const acc = perSource.get(m.from) ?? { count: 0, siege: 0 };
    perSource.set(m.from, { count: acc.count + m.count, siege: acc.siege + siege });
  }
  let total = 0;
  for (const [from, moved] of perSource) {
    const units = state.areas[from]?.units;
    const have = units?.troop ?? 0;
    if (moved.count > have - 1) return reject("illegalMove", "Cannot take the last unit.");
    if (moved.siege > (units?.siege ?? 0)) {
      return reject("illegalMove", "Not that many catapults there.");
    }
    total += moved.count;
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
    // Ground Assault adds foot troops only (catapults come only from Reinforce).
    const reserve = state.players[seat].reserve;
    const limit = Math.min(2, unit === "troop" ? footTroops(reserve) : reserve[unit]);
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
    if (m.siege) return reject("illegalMove", "Ships carry no catapults.");
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

function validateSiege(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  targetAreaId: string,
  supplied: Set<string>
): RejectionReason | null {
  const map = getMap(state.mapId);
  const land = space.areaId!;
  if (!supplied.has(land)) return reject("criteriaNotMet", "You do not supply the linked land.");
  if ((state.areas[land]?.units.siege ?? 0) < 1) {
    return reject("criteriaNotMet", "Siege needs at least one catapult in the linked land.");
  }
  if (!siegeTargets(map, land).includes(targetAreaId)) {
    return reject("illegalTarget", "Target is not land adjacent to the linked land.");
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
  const rejection = validatePlacements(state, seat, placements, targets, n, "troop");
  if (rejection) return rejection;
  // Up to the space's `siegeAmount` of the placed troops may be catapults (Siege rulesets);
  // the rest must be foot troops.
  const reserve = state.players[seat].reserve;
  let siege = 0;
  let total = 0;
  for (const p of placements) {
    const s = p.siege ?? 0;
    if (!Number.isInteger(s) || s < 0 || s > p.count) {
      return reject("illegalPlacement", "Catapults placed must be 0–count.");
    }
    siege += s;
    total += p.count;
  }
  if (siege > (space.siegeAmount ?? 0)) {
    return reject("illegalPlacement", `At most ${space.siegeAmount ?? 0} catapults here.`);
  }
  if (siege > reserve.siege) return reject("insufficientReserve", "Not enough catapults.");
  if (total - siege > footTroops(reserve)) {
    return reject("insufficientReserve", "Not enough troops in reserve.");
  }
  return null;
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
  // Commandeer raises the limit by 1 and may target opponent-controlled water; ships can be
  // spread across own/empty and any number of enemy waters (each enemy target becomes its own
  // sail-style battle, queued and ordered by the attacker — see applyEmbark).
  const commandeer = card === "commandeer";
  const targets = embarkTargets(map, state, seat, commandeer);
  const pool = space.amount! + (commandeer ? 1 : 0);
  if (placements.some((p) => p.siege)) {
    return reject("illegalPlacement", "Ships carry no catapults.");
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

/** Whether the seat currently supplies the area holding the given bonus. Pass `supplied` when
 *  the seat's supply for this state is already in hand. */
export function suppliesBonus(
  state: GameState,
  seat: SeatId,
  bonus: BonusType,
  supplied: ReadonlySet<string> = suppliedAreas(getMap(state.mapId), gameBoard(state), seat)
): boolean {
  for (const [areaId, b] of Object.entries(state.bonuses)) {
    if (b === bonus && supplied.has(areaId)) return true;
  }
  return false;
}
