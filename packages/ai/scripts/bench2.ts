/**
 * Search benchmark for the dice- and card-aware bot: fixed positions (4 seeds × 4 stages, reached
 * by depth-2 self-play with the tuned weights), time per fixed depth.
 *
 *   tsx scripts/bench2.ts [--depths 3,4] [--off reductions+orderMemory] [--save base.json]
 *     [--compare base.json]
 *
 * --compare prints the speed-up and lists positions whose chosen move changed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { ExpectiBot, onTheClock, TUNED_WEIGHTS } from "../src/index.js";
import type { Command, GameState, SeatId } from "../src/index.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Result {
  moves: Record<string, Command>;
  ms: Record<string, number>;
}

function positions(): { name: string; state: GameState; seat: SeatId }[] {
  const setup = new ExpectiBot({ depth: 2, weights: TUNED_WEIGHTS });
  const out: { name: string; state: GameState; seat: SeatId }[] = [];
  for (const seed of ["bench-1", "bench-2", "bench-3", "bench-4"]) {
    let state = createInitialState({ gameId: "bench", seed });
    let quiet = 0;
    while (state.status === "active") {
      const seat = onTheClock(state);
      if (!seat) break;
      if (!state.pendingCombat && !state.pendingDecision) {
        if ([3, 12, 22, 32].includes(quiet)) out.push({ name: `${seed}@${quiet}`, state, seat });
        quiet++;
        if (quiet > 32) break;
      }
      const r = resolveCommand(state, { seat }, setup.chooseCommand(state, seat));
      if (r.status !== "accepted") throw new Error("setup move rejected");
      state = r.nextState;
    }
  }
  return out;
}

const depths = (flag("--depths") ?? "3,4").split(",").map(Number);
const features = Object.fromEntries(
  (flag("--off") ?? "")
    .split("+")
    .filter(Boolean)
    .map((f) => [f, false])
);
const res: Result = { moves: {}, ms: {} };
const ps = positions();
for (const depth of depths) {
  const bot = new ExpectiBot({ depth, weights: TUNED_WEIGHTS, features });
  let total = 0;
  for (const p of ps) {
    const t = performance.now();
    const cmd = bot.chooseCommand(p.state, p.seat);
    const ms = performance.now() - t;
    total += ms;
    res.moves[`${p.name}/d${depth}`] = cmd;
    res.ms[`${p.name}/d${depth}`] = Math.round(ms);
  }
  res.ms[`TOTAL/d${depth}`] = Math.round(total);
}

const save = flag("--save");
if (save) writeFileSync(save, JSON.stringify(res, null, 1));
const cmp = flag("--compare");
if (cmp) {
  const base = JSON.parse(readFileSync(cmp, "utf8")) as Result;
  for (const k of Object.keys(res.ms).filter((k) => k.startsWith("TOTAL"))) {
    const [b, a] = [base.ms[k], res.ms[k]!];
    console.log(`${k.padEnd(10)} ${b ?? "-"} -> ${a} ms  ${b ? (b / a).toFixed(2) + "x" : ""}`);
  }
  const changed = Object.keys(base.moves).filter(
    (k) => k in res.moves && JSON.stringify(base.moves[k]) !== JSON.stringify(res.moves[k])
  );
  const shared = Object.keys(base.moves).filter((k) => k in res.moves).length;
  console.log(
    changed.length
      ? `moves CHANGED (${changed.length}/${shared}): ${changed.join(", ")}`
      : "moves: identical"
  );
} else {
  for (const [k, ms] of Object.entries(res.ms)) console.log(`${k.padEnd(16)} ${ms} ms`);
}
