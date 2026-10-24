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
  applyShipStrike,
  applySiege,
  rollPendingCombat,
  rerollPendingCombat,
  applyPendingCombat,
  offerTakeCover,
  applyTakeCover,
  trimSiege
} from "./actions.js";

const other = (seat: SeatId): SeatId => (seat === "red" ? "black" : "red");

/** Deep copy of JSON-compatible data. Same result as a JSON round-trip (including dropping
 *  `undefined` object properties) but several times faster — this runs once per resolved
 *  command, which makes it the hottest path in AI search. Shape-agnostic on purpose, so new
 *  state fields are copied without touching this. */
function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = cloneJson(value[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const key in value) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = cloneJson(v);
  }
  return out as T;
}

function clone(state: GameState): GameState {
  return cloneJson(state);
}

/** Options for a single resolution. `expectedCombat` makes a `combatRoll` land on the dice
 *  *expectation* (the rounded mean total) instead of a real seeded throw, leaving `rngState`
 *  untouched. Real play never sets it; the AI search does, so its combat valuation reflects the
 *  expected outcome and cannot peek at the roll the live rng will actually produce. */
export interface ResolveOptions {
  expectedCombat?: boolean;
}

/** Resolve a single command. Pure: returns a new state, never mutates the input. */
export function resolveCommand(
  state: GameState,
  actor: CommandActor,
  command: Command,
  opts: ResolveOptions = {}
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
    // review (and, with cards, reroll) before casualties land on combatResolve. An Ambush
    // card may be played here to add two defence dice.
    events.push(...rollPendingCombat(next, command.card, opts.expectedCombat));
  } else if (command.type === "combatReroll") {
    // Discard a card to re-throw; stays on the `rolled` phase for another review.
    events.push(...rerollPendingCombat(next, command.card));
  } else if (command.type === "combatResolve") {
    // Apply the reviewed roll, then fall through to the turn tail. A siege first pauses for
    // the defender's Take Cover answer (see offerTakeCover); the defender's own combatResolve
    // then lands the damage, less two if it carries Take Cover.
    const pc = next.pendingCombat!;
    if (pc.phase === "awaiting-cover") {
      if (command.card === "take_cover") events.push(...applyTakeCover(next));
      events.push(...applyPendingCombat(next));
    } else if (!offerTakeCover(next)) {
      events.push(...applyPendingCombat(next));
    }
  } else if (
    command.type === "advance" &&
    command.card === "siege_assault" &&
    next.pendingDecision?.kind === "siegeAssault"
  ) {
    // Siege Assault follow-up: an Advance on the offered space with no commander deployed and
    // no space occupied. Clears the offer, then resolves like any Advance.
    next.pendingDecision = null;
    events.push(...dispatchAction(next, seat, command));
  } else if (command.type === "choosePendingDecision") {
    // Ship Strike: a non-decline choice stages a second Shell from the same space (no commander
    // spent) at the chosen sea (the choice id IS the target area); Decline just clears the
    // decision and continues.
    const decision = next.pendingDecision!;
    next.pendingDecision = null;
    if (
      decision.kind === "shipStrike" &&
      command.choice.id !== "decline" &&
      decision.spaceId !== undefined
    ) {
      events.push(...applyShipStrike(next, decision.seat, decision.spaceId, command.choice.id));
    } else if (decision.kind === "selectCombat") {
      // Activate the chosen queued sea battle (its `choice.id` is the contested area).
      const idx = next.combatQueue.findIndex((b) => b.area === command.choice.id);
      if (idx >= 0) next.pendingCombat = next.combatQueue.splice(idx, 1)[0]!;
    }
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

  // A pending decision (Ship Strike follow-up after a Shell) likewise pauses the turn tail
  // until the responsible seat answers it.
  if (next.pendingDecision) {
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
    case "siege":
      return applySiege(state, seat, command.spaceId, command.targetAreaId, command.card);
    default:
      throw new Error(`No resolver for action ${command.type}`);
  }
}

/** Reduce each area to its cap; excess returns to the owner's reserve (catapults last). */
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
      const reserve = state.players[rt.owner].reserve;
      reserve[unit] += returned;
      const siege = unit === "troop" ? trimSiege(rt.units, reserve) : 0;
      events.push({
        type: "capExceeded",
        area: id,
        unit,
        returned,
        owner: rt.owner,
        ...(siege > 0 ? { siege } : {})
      });
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
