import { createInitialState, resolveCommand, type EndReason } from "@sengoku-jidai/engine";
import type { Bot, SeatId } from "./types.js";
import { onTheClock } from "./onclock.js";

export interface MatchResult {
  winner: SeatId | null;
  rounds: number;
  commands: number;
  endReason: EndReason | null;
}

/** Drive one full game between two bots, headless. Throws if a bot ever emits an
 *  illegal command (that is a bot bug, not an expected outcome). */
export function runMatch(
  botRed: Bot,
  botBlack: Bot,
  opts: { seed: string; gameId?: string; maxCommands?: number }
): MatchResult {
  let state = createInitialState({ gameId: opts.gameId ?? "match", seed: opts.seed });
  const max = opts.maxCommands ?? 100_000;
  let commands = 0;

  while (state.status === "active") {
    const seat = onTheClock(state);
    if (!seat) break;
    const bot = seat === "red" ? botRed : botBlack;
    const cmd = bot.chooseCommand(state, seat);
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") {
      throw new Error(
        `bot(${seat}) illegal command ${JSON.stringify(cmd)}: ${r.reason.code} — ${r.reason.message}`
      );
    }
    state = r.nextState;
    if (++commands > max) throw new Error("runMatch exceeded maxCommands (non-terminating bot?)");
  }

  return {
    winner: state.winner,
    rounds: state.round,
    commands,
    endReason: state.endReason
  };
}

export interface SeriesResult {
  redSeatWins: number;
  blackSeatWins: number;
  aWins: number;
  bWins: number;
  games: number;
}

/** Play a series, alternating which bot is red to cancel first-move bias. */
export function runMatches(
  botA: Bot,
  botB: Bot,
  opts: { games: number; seedPrefix: string; maxCommands?: number }
): SeriesResult {
  let redSeatWins = 0;
  let blackSeatWins = 0;
  let aWins = 0;
  let bWins = 0;
  for (let i = 0; i < opts.games; i++) {
    const aIsRed = i % 2 === 0;
    const red = aIsRed ? botA : botB;
    const black = aIsRed ? botB : botA;
    const res = runMatch(red, black, {
      seed: `${opts.seedPrefix}-${i}`,
      gameId: `${opts.seedPrefix}-${i}`,
      maxCommands: opts.maxCommands
    });
    if (res.winner === "red") redSeatWins++;
    else if (res.winner === "black") blackSeatWins++;
    const winnerIsA = (res.winner === "red" && aIsRed) || (res.winner === "black" && !aIsRed);
    if (winnerIsA) aWins++;
    else bWins++;
  }
  return { redSeatWins, blackSeatWins, aWins, bWins, games: opts.games };
}
