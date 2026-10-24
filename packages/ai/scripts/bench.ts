/**
 * Alpha-beta search benchmark over a fixed set of positions (4 seeds x early/mid/late game,
 * reached by greedy play). Reports per-position time at fixed depths and the deepest depth that
 * completes inside the live AI budget.
 *
 *   corepack pnpm --filter @sengoku-jidai/ai bench                     # print results
 *   corepack pnpm --filter @sengoku-jidai/ai bench --save base.json    # record a baseline
 *   corepack pnpm --filter @sengoku-jidai/ai bench --compare base.json # speedup + move check
 *
 * The search is deterministic, so a pure speed optimisation must reproduce the baseline's moves
 * exactly; --compare flags any position whose chosen move changed. The engine is imported from
 * its built dist, so run `corepack pnpm --filter @sengoku-jidai/engine build` after engine edits.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { alphaBetaCommand, GreedyBot, onTheClock } from "../src/index.js";
import type { Command, GameState, SeatId } from "../src/index.js";

const DEPTHS = [3, 4];
const BUDGET_MS = 1500; // matches the server's AI deadline (server/src/api/routes.ts)
const MAX_DEPTH = 8;

interface BenchResult {
  moves: Record<string, Command>;
  ms: Record<string, number>;
  depthInBudget: Record<string, number>;
}

function positions(): { name: string; state: GameState; seat: SeatId }[] {
  const greedy = new GreedyBot();
  const out: { name: string; state: GameState; seat: SeatId }[] = [];
  for (const seed of ["bench-1", "bench-2", "bench-3", "bench-4"]) {
    for (const plies of [2, 12, 24]) {
      let state = createInitialState({ gameId: "bench", seed });
      for (let i = 0; i < plies && state.status === "active"; i++) {
        const seat = onTheClock(state);
        if (!seat) break;
        const r = resolveCommand(state, { seat }, greedy.chooseCommand(state, seat));
        if (r.status !== "accepted") throw new Error(`greedy setup move rejected (${seed})`);
        state = r.nextState;
      }
      const seat = onTheClock(state);
      if (seat && state.status === "active") out.push({ name: `${seed}@${plies}`, state, seat });
    }
  }
  return out;
}

function timed(fn: () => Command): { cmd: Command; ms: number } {
  const t = performance.now();
  const cmd = fn();
  return { cmd, ms: performance.now() - t };
}

function run(): BenchResult {
  const res: BenchResult = { moves: {}, ms: {}, depthInBudget: {} };
  const ps = positions();
  for (const depth of DEPTHS) {
    let total = 0;
    for (const p of ps) {
      alphaBetaCommand(p.state, p.seat, { depth }); // warm up the JIT for this shape
      const { cmd, ms } = timed(() => alphaBetaCommand(p.state, p.seat, { depth }));
      total += ms;
      res.moves[`${p.name}/d${depth}`] = cmd;
      res.ms[`${p.name}/d${depth}`] = Math.round(ms);
    }
    res.ms[`TOTAL/d${depth}`] = Math.round(total);
  }
  for (const p of ps) {
    let reached = 0;
    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      if (timed(() => alphaBetaCommand(p.state, p.seat, { depth })).ms > BUDGET_MS) break;
      reached = depth;
    }
    res.depthInBudget[p.name] = reached;
  }
  return res;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const result = run();
const savePath = flag("--save");
const comparePath = flag("--compare");
if (savePath) writeFileSync(savePath, JSON.stringify(result, null, 1));

if (comparePath) {
  const base = JSON.parse(readFileSync(comparePath, "utf8")) as BenchResult;
  const changed = Object.keys(base.moves).filter(
    (k) => JSON.stringify(base.moves[k]) !== JSON.stringify(result.moves[k])
  );
  for (const k of Object.keys(result.ms)) {
    const [b, a] = [base.ms[k], result.ms[k]!];
    const speedup = b !== undefined && a > 0 ? `${(b / a).toFixed(1)}x` : "-";
    console.log(
      `${k.padEnd(18)} ${String(b ?? "-").padStart(6)} -> ${String(a).padStart(6)} ms  ${speedup}`
    );
  }
  for (const k of Object.keys(result.depthInBudget))
    console.log(
      `depth in ${BUDGET_MS}ms ${k.padEnd(12)} ${base.depthInBudget[k] ?? "-"} -> ${result.depthInBudget[k]}`
    );
  console.log(
    changed.length === 0
      ? `moves: all ${Object.keys(base.moves).length} identical to baseline`
      : `moves CHANGED at: ${changed.join(", ")}`
  );
} else {
  for (const [k, ms] of Object.entries(result.ms))
    console.log(`${k.padEnd(18)} ${String(ms).padStart(6)} ms`);
  for (const [k, d] of Object.entries(result.depthInBudget))
    console.log(`depth in ${BUDGET_MS}ms ${k.padEnd(12)} ${d}`);
}
