import type { GameState, SeatId } from "@sengoku-jidai/engine";
import { onTheClock, type Bot } from "@sengoku-jidai/ai";

export interface AiDriverDeps {
  controllersOf(gameId: string): Record<SeatId, "human" | "ai">;
  currentState(gameId: string): GameState;
  applyAiCommand(
    gameId: string,
    seat: SeatId,
    command: import("@sengoku-jidai/engine").Command
  ): { status: "accepted" | "rejected"; revision: number };
}

/**
 * Drive AI seats to completion of their turns. While the seat on the clock is AI-controlled
 * and the game is active, pick and apply one AI command per step. Stops when a human is on the
 * clock, the game ends, or `maxSteps` is reached. Throws if an AI command is rejected — that is
 * a bug (the AI must only ever emit engine-legal commands), not an expected outcome.
 */
export function driveAiTurns(
  deps: AiDriverDeps,
  gameId: string,
  botFor: (seat: SeatId) => Bot,
  maxSteps = 2000
): void {
  const controllers = deps.controllersOf(gameId);
  for (let step = 0; step < maxSteps; step++) {
    const state = deps.currentState(gameId);
    if (state.status !== "active") return;
    const seat = onTheClock(state);
    if (!seat || controllers[seat] !== "ai") return; // human (or nobody) on the clock
    const command = botFor(seat).chooseCommand(state, seat);
    const res = deps.applyAiCommand(gameId, seat, command);
    if (res.status !== "accepted") {
      throw new Error(`driveAiTurns: AI(${seat}) emitted an illegal command for game ${gameId}`);
    }
  }
  throw new Error(`driveAiTurns: exceeded ${maxSteps} steps for game ${gameId} (non-terminating?)`);
}
