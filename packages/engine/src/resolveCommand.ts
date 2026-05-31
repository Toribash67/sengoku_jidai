import { validateCommand } from "./validateCommand.js";
import type {
  Command,
  CommandActor,
  CommandResult,
  GameEvent,
  GameState,
  RulesConfig
} from "./types.js";

export function resolveCommand(
  previousState: GameState,
  actor: CommandActor,
  command: Command,
  _rulesConfig: RulesConfig = previousState.rules
): CommandResult {
  const rejection = validateCommand(previousState, actor, command);
  if (rejection) {
    return { status: "rejected", reason: rejection };
  }

  const nextState = cloneState(previousState);
  const events: GameEvent[] = [];

  if (command.type === "choosePendingDecision") {
    nextState.pendingDecision = null;
    events.push({
      type: "pendingDecisionChosen",
      seat: actor.seat,
      pendingId: command.pendingId,
      choiceId: command.choice.id
    });
  } else {
    const area = nextState.areas[command.areaId]!;
    const previousController = area.controller;
    area.controller = actor.seat;
    area.commander = actor.seat;
    events.push({
      type: "areaClaimed",
      seat: actor.seat,
      areaId: area.id,
      previousController,
      nextController: actor.seat
    });
    nextState.activeSeat = actor.seat === "red" ? "black" : "red";
    if (actor.seat === "black") {
      nextState.round += 1;
    }
  }

  nextState.revision = previousState.revision + 1;
  return { status: "accepted", nextState, events };
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
