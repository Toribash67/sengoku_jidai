import type { GameState } from "./state.js";

/** JSON-serializable form of a v2 game state (the state is already plain JSON). */
export type JsonGameState = GameState;

export function serializeState(state: GameState): JsonGameState {
  return JSON.parse(JSON.stringify(state)) as JsonGameState;
}

export function deserializeState(json: JsonGameState): GameState {
  if (json.schemaVersion !== 2) {
    throw new Error(`Unsupported game state schema version: ${String(json.schemaVersion)}`);
  }
  return JSON.parse(JSON.stringify(json)) as GameState;
}
