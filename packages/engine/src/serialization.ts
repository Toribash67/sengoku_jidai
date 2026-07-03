import type { GameState } from "./state.js";
import { gameStateSchema } from "./stateSchema.js";

/** JSON-serializable form of a v3 game state (the state is already plain JSON). */
export type JsonGameState = GameState;

export function serializeState(state: GameState): JsonGameState {
  return JSON.parse(JSON.stringify(state)) as JsonGameState;
}

/** Restore a persisted snapshot: checks the schema version, then validates the full
 *  shape so a corrupted or hand-edited snapshot fails loudly here instead of deep
 *  inside rules code. Returns a fresh object (parse clones). */
export function deserializeState(json: JsonGameState): GameState {
  if (json.schemaVersion !== 3) {
    throw new Error(`Unsupported game state schema version: ${String(json.schemaVersion)}`);
  }
  return gameStateSchema.parse(json);
}
