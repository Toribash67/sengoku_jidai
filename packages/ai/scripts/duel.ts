/**
 * Play a series between two bots and report who is stronger.
 *
 *   corepack pnpm --filter @sengoku-jidai/ai duel -- --a expecti:ms=1500 --b alphabeta:ms=1500 --seeds 100
 *
 *   --a, --b        bot specs (see src/botRegistry.ts): expecti, alphabeta, trapper, greedy, random
 *   --seeds N       number of starting setups; each is played twice with sides swapped
 *   --seed-prefix   names the setups (default "duel"), so a series can be repeated exactly
 *   --ruleset       rivers (default) | fortress
 *   --jobs N        split the setups across N processes
 *   --json PATH     also write the full result as JSON
 *
 * The engine is imported from its built dist: run `corepack pnpm --filter @sengoku-jidai/engine
 * build` after engine edits. Bots on a wall-clock budget (`ms=`) share the machine, so keep
 * --jobs below the number of physical cores and run nothing else heavy alongside.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fortressRuleset, type RulesConfig } from "@sengoku-jidai/engine";
import { parseBotSpec, runMatch } from "../src/index.js";
import type { Bot, Command, GameState, SeatId } from "../src/index.js";

interface Timing {
  commands: number;
  totalMs: number;
  worstMs: number;
}

interface GameRecord {
  seed: string;
  aIsRed: boolean;
  /** "a" | "b" | null for a draw. */
  winner: "a" | "b" | null;
  /** A's victory points minus B's on the final board. */
  vpMargin: number;
  timing: { a: Timing; b: Timing };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Wrap a bot so every decision is timed. */
function timed(bot: Bot, timing: Timing): Bot {
  return {
    chooseCommand(state: GameState, seat: SeatId): Command {
      const t = performance.now();
      const cmd = bot.chooseCommand(state, seat);
      const ms = performance.now() - t;
      timing.commands += 1;
      timing.totalMs += ms;
      timing.worstMs = Math.max(timing.worstMs, ms);
      return cmd;
    }
  };
}

function playSeed(specA: string, specB: string, seed: string, rules?: RulesConfig): GameRecord[] {
  return [true, false].map((aIsRed) => {
    const timing = {
      a: { commands: 0, totalMs: 0, worstMs: 0 },
      b: { commands: 0, totalMs: 0, worstMs: 0 }
    };
    const a = timed(parseBotSpec(specA).make(), timing.a);
    const b = timed(parseBotSpec(specB).make(), timing.b);
    const res = runMatch(aIsRed ? a : b, aIsRed ? b : a, { seed, gameId: seed, rules });
    const aSeat: SeatId = aIsRed ? "red" : "black";
    const bSeat: SeatId = aIsRed ? "black" : "red";
    return {
      seed,
      aIsRed,
      winner: res.winner === null ? null : res.winner === aSeat ? "a" : "b",
      vpMargin: res.victoryPoints[aSeat] - res.victoryPoints[bSeat],
      timing
    };
  });
}

/** 95% Wilson score interval for `wins` out of `n`. */
function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = wins / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const denom = 1 + (z * z) / n;
  return [(centre - spread) / denom, (centre + spread) / denom];
}

function summarise(specA: string, specB: string, ruleset: string, games: GameRecord[]) {
  const aWins = games.filter((g) => g.winner === "a").length;
  const bWins = games.filter((g) => g.winner === "b").length;
  const draws = games.length - aWins - bWins;
  const decisive = aWins + bWins;
  const [low, high] = wilson(aWins, decisive);
  const time = (side: "a" | "b") => {
    const commands = games.reduce((n, g) => n + g.timing[side].commands, 0);
    const total = games.reduce((n, g) => n + g.timing[side].totalMs, 0);
    return {
      avgMs: commands > 0 ? total / commands : 0,
      worstMs: games.reduce((n, g) => Math.max(n, g.timing[side].worstMs), 0)
    };
  };
  return {
    a: specA,
    b: specB,
    ruleset,
    games: games.length,
    aWins,
    draws,
    bWins,
    aWinRate: decisive > 0 ? aWins / decisive : 0,
    interval95: [low, high] as [number, number],
    avgVpMargin: games.reduce((n, g) => n + g.vpMargin, 0) / Math.max(1, games.length),
    timing: { a: time("a"), b: time("b") }
  };
}

/** Run this script again as a child process for one slice of the seeds. */
function runShard(args: string[], seeds: string[]): Promise<GameRecord[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1]!, ...args, "--only-seeds", seeds.join(",")],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`duel shard exited with code ${code}`));
      resolve(JSON.parse(out) as GameRecord[]);
    });
  });
}

async function main(): Promise<void> {
  const specA = flag("--a");
  const specB = flag("--b");
  if (!specA || !specB) throw new Error("usage: duel --a <spec> --b <spec> --seeds <n>");
  parseBotSpec(specA); // fail fast on a bad spec
  parseBotSpec(specB);
  const ruleset = flag("--ruleset") ?? "rivers";
  if (ruleset !== "rivers" && ruleset !== "fortress") throw new Error(`Unknown ruleset ${ruleset}`);
  const rules = ruleset === "fortress" ? fortressRuleset : undefined;

  // A shard: play exactly the seeds it was handed and print the records for the parent.
  const only = flag("--only-seeds");
  if (only !== undefined) {
    const records = only.split(",").flatMap((seed) => playSeed(specA, specB, seed, rules));
    process.stdout.write(JSON.stringify(records));
    return;
  }

  const count = Number(flag("--seeds") ?? "10");
  const prefix = flag("--seed-prefix") ?? "duel";
  const seeds = Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  const jobs = Math.max(1, Math.min(Number(flag("--jobs") ?? "1"), seeds.length));

  let games: GameRecord[];
  if (jobs === 1) {
    games = seeds.flatMap((seed) => playSeed(specA, specB, seed, rules));
  } else {
    const passThrough = ["--a", specA, "--b", specB, "--ruleset", ruleset];
    const slices = Array.from({ length: jobs }, (_, j) => seeds.filter((_s, i) => i % jobs === j));
    const shards = await Promise.all(slices.map((slice) => runShard(passThrough, slice)));
    const bySeed = new Map(shards.flat().map((g) => [`${g.seed}/${g.aIsRed}`, g]));
    games = seeds.flatMap((seed) => [bySeed.get(`${seed}/true`)!, bySeed.get(`${seed}/false`)!]);
  }

  const summary = summarise(specA, specB, ruleset, games);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  console.log(`A  ${summary.a}\nB  ${summary.b}\nruleset ${ruleset}, ${summary.games} games`);
  console.log(`A wins ${summary.aWins}  draws ${summary.draws}  B wins ${summary.bWins}`);
  console.log(
    `A win rate ${pct(summary.aWinRate)} of decisive games ` +
      `(95% interval ${pct(summary.interval95[0])} – ${pct(summary.interval95[1])})`
  );
  console.log(`average VP margin (A − B) ${summary.avgVpMargin.toFixed(2)}`);
  for (const side of ["a", "b"] as const) {
    const t = summary.timing[side];
    console.log(
      `${side.toUpperCase()} thinking: ${t.avgMs.toFixed(0)} ms average, ${t.worstMs.toFixed(0)} ms worst`
    );
  }
  const jsonPath = flag("--json");
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ summary, games }, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
