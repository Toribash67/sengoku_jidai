import type { GameState, JsonGameState } from "./types.js";

export function serializeState(state: GameState): JsonGameState {
  return JSON.parse(JSON.stringify(state)) as JsonGameState;
}

export function deserializeState(json: JsonGameState): GameState {
  if (json.schemaVersion !== 1) {
    throw new Error(`Unsupported game state schema version: ${String(json.schemaVersion)}`);
  }
  return JSON.parse(JSON.stringify(json)) as GameState;
}
