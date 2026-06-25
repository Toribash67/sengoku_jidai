import type { Command, CommandActor, CommandResult, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { validateCommand } from "./validate.js";
import { gameBoard } from "./board.js";
import { hqEliminated, victoryPoints } from "./scoring.js";
import { available } from "./legality.js";
import {
  applyPass,
  applyReinforce,
  applyPlan,
  applyEmbark,
  applyAdvance,
  applySail,
  applyBombard,
  applyShell,
  rollPendingCombat,
  rerollPendingCombat,
  applyPendingCombat
} from "./actions.js";

const other = (seat: SeatId): SeatId => (seat === "red" ? "black" : "red");

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** Resolve a single command. Pure: returns a new state, never mutates the input. */
export function resolveCommand(
  state: GameState,
  actor: CommandActor,
  command: Command
): CommandResult {
  const rejection = validateCommand(state, actor, command);
  if (rejection) return { status: "rejected", reason: rejection };

  const next = clone(state);
  const seat = actor.seat;
  const events: GameEvent[] = [];

  // deployCommander: occupy the chosen space (support/linked) — pass goes to standby.
  if (command.type === "pass") {
    events.push(...applyPass(next, seat));
  } else if (command.type === "combatRoll") {
    // Throw the dice and pause again on the `rolled` phase for the responsible seat to
    // review (and, with cards, reroll) before casualties land on combatResolve.
    events.push(...rollPendingCombat(next));
  } else if (command.type === "combatReroll") {
    // Discard a card to re-throw; stays on the `rolled` phase for another review.
    events.push(...rerollPendingCombat(next, command.card));
  } else if (command.type === "combatResolve") {
    // Apply the reviewed roll, then fall through to the turn tail.
    events.push(...applyPendingCombat(next));
  } else if (command.type === "choosePendingDecision") {
    // v1 seam: never reached (pendingDecision is always null), but resolve harmlessly.
    next.pendingDecision = null;
  } else {
    // Counterattack deploys onto the opponent's Advance space: keep their commander on the
    // space (don't overwrite) and spend one of ours via the counterattack counter instead.
    if (command.type === "advance" && command.card === "counterattack") {
      next.players[seat].commanders.counterattacks += 1;
    } else {
      next.actionSpaces[command.spaceId] = seat;
    }
    events.push({ type: "commanderDeployed", seat, spaceId: command.spaceId });
    events.push(...dispatchAction(next, seat, command));
  }

  next.revision = state.revision + 1;

  // An action that moved into an enemy area or fired a strike pauses here for the
  // responsible seat to roll. Defer caps/end-check/turn until combatRoll resolves it.
  if (next.pendingCombat) {
    return { status: "accepted", nextState: next, events };
  }

  // enforceCaps: land <= 5, water <= 3; excess -> owner reserve.
  events.push(...enforceCaps(next));

  // checkGameEnd (immediate): an emptied HQ loses now.
  const ended = checkHqElimination(next);
  if (ended) {
    events.push(ended);
    return { status: "accepted", nextState: next, events };
  }

  // advanceTurn: toggle, or auto-recall + round advance / round-4 VP end.
  events.push(...advanceTurn(next));

  return { status: "accepted", nextState: next, events };
}

function dispatchAction(state: GameState, seat: SeatId, command: Command): GameEvent[] {
  switch (command.type) {
    case "reinforce":
      return applyReinforce(state, seat, command.placements, command.card);
    case "plan":
      return applyPlan(state, seat, command.spaceId);
    case "embark":
      return applyEmbark(state, seat, command.placements, command.card);
    case "advance":
      return applyAdvance(
        state,
        seat,
        command.spaceId,
        command.moves,
        command.card,
        command.cardBonus
      );
    case "sail":
      return applySail(
        state,
        seat,
        command.spaceId,
        command.moves,
        command.card,
        command.cardBonus
      );
    case "bombard":
      return applyBombard(state, seat, command.spaceId, command.targetAreaId, command.card);
    case "shell":
      return applyShell(state, seat, command.spaceId, command.targetAreaId);
    default:
      throw new Error(`No resolver for action ${command.type}`);
  }
}

/** Reduce each area to its cap; excess returns to the owner's reserve. */
export function enforceCaps(state: GameState): GameEvent[] {
  const map = getMap(state.mapId);
  const events: GameEvent[] = [];
  for (const [id, rt] of Object.entries(state.areas)) {
    if (rt.owner == null) continue;
    const kind = map.areas[id]!.kind;
    const unit = kind === "land" ? "troop" : "ship";
    const cap = kind === "land" ? 5 : 3;
    if (rt.units[unit] > cap) {
      const returned = rt.units[unit] - cap;
      rt.units[unit] = cap;
      state.players[rt.owner].reserve[unit] += returned;
      events.push({ type: "capExceeded", area: id, unit, returned, owner: rt.owner });
    }
  }
  return events;
}

/** Immediate-loss check: a seat with no units in its own HQ area (or has no HQ). */
function checkHqElimination(state: GameState): GameEvent | null {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const redOut = hqEliminated(map, board, "red");
  const blackOut = hqEliminated(map, board, "black");
  if (!redOut && !blackOut) return null;
  const winner: SeatId = redOut && blackOut ? state.initiative : redOut ? "black" : "red";
  state.status = "complete";
  state.winner = winner;
  state.endReason = "hqEliminated";
  return { type: "gameEnded", winner, reason: "hqEliminated" };
}

/** Toggle the active seat, or — when both seats are out of commanders — recall. */
export function advanceTurn(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const bothSpent = available(state, "red") === 0 && available(state, "black") === 0;
  if (!bothSpent) {
    state.activeSeat = other(state.activeSeat);
    events.push({ type: "turnAdvanced", activeSeat: state.activeSeat });
    return events;
  }
  recall(state);
  if (state.round >= state.rules.maxRounds) {
    events.push(...endByVictoryPoints(state));
    return events;
  }
  state.round += 1;
  state.activeSeat = state.initiative;
  events.push({ type: "recalled", round: state.round, initiative: state.initiative });
  return events;
}

/** Return all commanders to reserve and clear the action board. */
function recall(state: GameState): void {
  for (const seat of ["red", "black"] as const) {
    state.players[seat].commanders.standby = 0;
    state.players[seat].commanders.counterattacks = 0;
    state.players[seat].passed = false;
  }
  for (const id of Object.keys(state.actionSpaces)) state.actionSpaces[id] = null;
}

function endByVictoryPoints(state: GameState): GameEvent[] {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const redVp = victoryPoints(map, board, "red");
  const blackVp = victoryPoints(map, board, "black");
  const winner: SeatId = redVp === blackVp ? state.initiative : redVp > blackVp ? "red" : "black";
  state.status = "complete";
  state.winner = winner;
  state.endReason = "victoryPoints";
  return [{ type: "gameEnded", winner, reason: "victoryPoints" }];
}
