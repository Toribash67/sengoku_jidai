import {
  TUNED_WEIGHTS,
  observe,
  runAlphaBetaInWorker,
  runExpectiInWorker
} from "@sengoku-jidai/ai";
import type { Command, GameState, SeatId } from "@sengoku-jidai/engine";

export interface AiEngine {
  bot: "alphabeta" | "expecti";
  weights: "default" | "tuned";
}

export const DEFAULT_AI_ENGINE: AiEngine = { bot: "alphabeta", weights: "default" };

/** One AI decision on a worker thread, by the configured search and scoring weights. The new
 *  search is handed only the seat's observation, so the opponent's cards never reach it. */
export function aiCommandPicker(
  engine: AiEngine
): (state: GameState, seat: SeatId, deadlineMs: number) => Promise<Command> {
  const weights = engine.weights === "tuned" ? { weights: TUNED_WEIGHTS } : {};
  return (state, seat, deadlineMs) =>
    engine.bot === "expecti"
      ? runExpectiInWorker(observe(state, seat), seat, { deadlineMs, ...weights })
      : runAlphaBetaInWorker(state, seat, { deadlineMs, ...weights });
}
