import {
  createInitialState,
  gameBoard,
  getMap,
  resolveCommand,
  victoryPoints,
  type EndReason,
  type GameEvent,
  type RulesConfig
} from "@sengoku-jidai/engine";
import type { Bot, SeatId } from "./types.js";
import { onTheClock } from "./onclock.js";

export interface MatchResult {
  winner: SeatId | null;
  rounds: number;
  commands: number;
  endReason: EndReason | null;
  /** Each seat's victory points on the final board. */
  victoryPoints: Record<SeatId, number>;
}

/** Drive one full game between two bots, headless. Throws if a bot ever emits an
 *  illegal command (that is a bot bug, not an expected outcome). */
export function runMatch(
  botRed: Bot,
  botBlack: Bot,
  opts: {
    seed: string;
    gameId?: string;
    maxCommands?: number;
    /** Ruleset override (default: the map's, i.e. Rivers). */
    rules?: RulesConfig;
    /** A registered map to play on (default: Rivers). */
    mapId?: string;
    /** Observe every accepted command's events (diagnostics/tests). */
    onEvents?: (events: GameEvent[]) => void;
  }
): MatchResult {
  let state = createInitialState({
    gameId: opts.gameId ?? "match",
    seed: opts.seed,
    ...(opts.rules ? { rules: opts.rules } : {}),
    ...(opts.mapId ? { mapId: opts.mapId } : {})
  });
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
    opts.onEvents?.(r.events);
    if (++commands > max) throw new Error("runMatch exceeded maxCommands (non-terminating bot?)");
  }

  const map = getMap(state.mapId);
  const board = gameBoard(state);
  return {
    winner: state.winner,
    rounds: state.round,
    commands,
    endReason: state.endReason,
    victoryPoints: {
      red: victoryPoints(map, board, "red"),
      black: victoryPoints(map, board, "black")
    }
  };
}

export interface SeriesResult {
  redSeatWins: number;
  blackSeatWins: number;
  aWins: number;
  bWins: number;
  /** Games with no winner. Counted for neither bot. */
  draws: number;
  games: number;
}

/** Play a series, alternating which bot is red to cancel first-move bias. With `seeds`, every
 *  seed is played twice — once with each bot as red — and `games`/`seedPrefix` are ignored. */
export function runMatches(
  botA: Bot,
  botB: Bot,
  opts: {
    games?: number;
    seedPrefix?: string;
    seeds?: string[];
    maxCommands?: number;
    rules?: RulesConfig;
  }
): SeriesResult {
  const fixtures: { seed: string; aIsRed: boolean }[] = opts.seeds
    ? opts.seeds.flatMap((seed) => [
        { seed, aIsRed: true },
        { seed, aIsRed: false }
      ])
    : Array.from({ length: opts.games ?? 0 }, (_, i) => ({
        seed: `${opts.seedPrefix ?? "series"}-${i}`,
        aIsRed: i % 2 === 0
      }));
  const result: SeriesResult = {
    redSeatWins: 0,
    blackSeatWins: 0,
    aWins: 0,
    bWins: 0,
    draws: 0,
    games: fixtures.length
  };
  for (const { seed, aIsRed } of fixtures) {
    const res = runMatch(aIsRed ? botA : botB, aIsRed ? botB : botA, {
      seed,
      gameId: seed,
      maxCommands: opts.maxCommands,
      rules: opts.rules
    });
    if (res.winner === null) {
      result.draws++;
      continue;
    }
    if (res.winner === "red") result.redSeatWins++;
    else result.blackSeatWins++;
    if ((res.winner === "red") === aIsRed) result.aWins++;
    else result.bWins++;
  }
  return result;
}
