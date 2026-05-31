import type {
  Command,
  CommandActor,
  GameState,
  LegalCommandSummary,
  RejectionReason
} from "./types.js";

export function validateCommand(
  state: GameState,
  actor: CommandActor,
  command: Command
): RejectionReason | null {
  if (state.pendingDecision && command.type !== "choosePendingDecision") {
    return {
      code: "pendingDecisionRequired",
      message: "A pending decision must be answered before other commands."
    };
  }

  if (command.type === "choosePendingDecision") {
    if (!state.pendingDecision || state.pendingDecision.id !== command.pendingId) {
      return { code: "pendingDecisionNotFound", message: "Pending decision was not found." };
    }
    if (state.pendingDecision.seat !== actor.seat) {
      return { code: "notActiveSeat", message: "This seat cannot answer the pending decision." };
    }
    if (!state.pendingDecision.choices.some((choice) => choice.id === command.choice.id)) {
      return { code: "illegalChoice", message: "That pending decision choice is not legal." };
    }
    return null;
  }

  if (state.activeSeat !== actor.seat) {
    return { code: "notActiveSeat", message: "It is not this seat's turn." };
  }

  if (!state.areas[command.areaId]) {
    return { code: "areaNotFound", message: "The requested area does not exist." };
  }

  return null;
}

export function legalCommandsForState(state: GameState, playerId: string): LegalCommandSummary {
  const seat = playerId === "black" ? "black" : "red";

  if (state.pendingDecision) {
    return {
      activeSeat: state.activeSeat,
      commands:
        state.pendingDecision.seat === seat
          ? state.pendingDecision.choices.map((choice) => ({
              type: "choosePendingDecision",
              pendingId: state.pendingDecision!.id,
              choice
            }))
          : []
    };
  }

  return {
    activeSeat: state.activeSeat,
    commands:
      state.activeSeat === seat
        ? Object.values(state.areas).map((area) => ({ type: "claimArea", areaId: area.id }))
        : []
  };
}
