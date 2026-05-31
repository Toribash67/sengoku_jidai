import { legalCommandsForState } from "./validateCommand.js";
import type {
  GameEvent,
  GameState,
  PlayerGameEvent,
  PlayerGameView,
  SeatId,
  SpectatorGameView
} from "./types.js";

export function playerView(state: GameState, playerId: SeatId): PlayerGameView {
  return {
    schemaVersion: 1,
    gameId: state.gameId,
    mapId: state.mapId,
    mode: state.mode,
    status: state.status,
    round: state.round,
    activeSeat: state.activeSeat,
    viewerSeat: playerId,
    prompt: buildPrompt(state, playerId),
    areas: Object.values(state.areas).map((area) => ({ ...area })),
    pendingDecision:
      state.pendingDecision && state.pendingDecision.seat === playerId
        ? state.pendingDecision
        : null,
    legal: legalCommandsForState(state, playerId)
  };
}

export function spectatorView(state: GameState): SpectatorGameView {
  return {
    ...playerView(state, state.activeSeat),
    viewerSeat: "spectator",
    pendingDecision: null,
    legal: { activeSeat: state.activeSeat, commands: [] }
  };
}

export function playerEvents(events: GameEvent[]): PlayerGameEvent[] {
  return events;
}

export function legalCommandsForView(view: PlayerGameView) {
  return view.legal;
}

function buildPrompt(state: GameState, viewer: SeatId): string {
  if (state.pendingDecision) {
    return state.pendingDecision.seat === viewer
      ? state.pendingDecision.prompt
      : `Waiting for ${state.pendingDecision.seat}.`;
  }
  return state.activeSeat === viewer
    ? "Choose an area to claim."
    : `Waiting for ${state.activeSeat}.`;
}
