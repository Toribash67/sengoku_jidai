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

export const DEFAULT_AI_ENGINE: AiEngine = { bot: "expecti", weights: "tuned" };

export interface AiRunners {
  expecti: typeof runExpectiInWorker;
  alphabeta: typeof runAlphaBetaInWorker;
  /** Told when the new search failed and the previous bot answered instead. */
  onFallback: (err: unknown) => void;
}

/** What the previous bot gets when it stands in for a failed search: enough for a sound move,
 *  short because the player has already waited. */
const FALLBACK_THINK_MS = 1500;

/** One AI decision on a worker thread, by the configured search and scoring weights. The new
 *  search is handed only the seat's observation, so the opponent's cards never reach it. If it
 *  fails, the previous bot answers instead, so the game is never left waiting on the AI. */
export function aiCommandPicker(
  engine: AiEngine,
  runners: Partial<AiRunners> = {}
): (state: GameState, seat: SeatId, deadlineMs: number) => Promise<Command> {
  const expecti = runners.expecti ?? runExpectiInWorker;
  const alphabeta = runners.alphabeta ?? runAlphaBetaInWorker;
  const weights = engine.weights === "tuned" ? { weights: TUNED_WEIGHTS } : {};
  return (state, seat, deadlineMs) =>
    engine.bot === "expecti"
      ? expecti(observe(state, seat), seat, { deadlineMs, ...weights }).catch((err: unknown) => {
          runners.onFallback?.(err);
          return alphabeta(state, seat, {
            deadlineMs: Math.min(deadlineMs, FALLBACK_THINK_MS),
            ...weights
          });
        })
      : alphabeta(state, seat, { deadlineMs, ...weights });
}
