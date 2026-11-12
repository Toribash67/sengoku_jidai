import type { Bot } from "./types.js";
import { AlphaBetaBot } from "./bots/alphabeta.js";
import { ExpectiBot } from "./bots/expecti.js";
import { GreedyBot } from "./bots/greedy.js";
import { RandomBot } from "./bots/random.js";
import { TrapperBot } from "./bots/trapper.js";
import { createAiRng } from "./rng.js";
import { DEFAULT_FEATURES, type Features } from "./search2/features.js";

/**
 * Bots by name, for the duel script. Grammar: `name[:key=value[,key=value…]]`.
 *
 *   expecti    ms, depth, rerollCap, off (features to switch off, joined with `+`)
 *   alphabeta  ms, depth
 *   trapper    ms, depth
 *   greedy     —
 *   random     seed
 */
export function parseBotSpec(spec: string): { name: string; make: () => Bot } {
  const [name = "", rest = ""] = spec.split(":", 2);
  const args = new Map<string, string>();
  for (const pair of rest === "" ? [] : rest.split(",")) {
    const [key = "", value = ""] = pair.split("=", 2);
    args.set(key, value);
  }
  const allowed = ALLOWED_KEYS[name];
  if (!allowed) throw new Error(`Unknown bot "${name}" (known: ${Object.keys(ALLOWED_KEYS)})`);
  for (const key of args.keys()) {
    if (!allowed.includes(key)) throw new Error(`Bot "${name}" has no option "${key}"`);
  }
  const num = (key: string): number | undefined => {
    const raw = args.get(key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) throw new Error(`Bad ${key}="${raw}" for "${name}"`);
    return n;
  };
  const budget = { depth: num("depth"), deadlineMs: num("ms") };

  switch (name) {
    case "expecti": {
      const features: Partial<Features> = {};
      const rerollCap = num("rerollCap");
      if (rerollCap !== undefined) features.rerollCap = rerollCap;
      for (const flag of (args.get("off") ?? "").split("+").filter(Boolean)) {
        if (
          !(flag in DEFAULT_FEATURES) ||
          typeof DEFAULT_FEATURES[flag as keyof Features] !== "boolean"
        ) {
          throw new Error(`Unknown feature "${flag}" to switch off`);
        }
        (features as Record<string, boolean>)[flag] = false;
      }
      return { name, make: () => new ExpectiBot({ ...budget, features }) };
    }
    case "alphabeta":
      return { name, make: () => new AlphaBetaBot(budget) };
    case "trapper":
      return { name, make: () => new TrapperBot(budget) };
    case "greedy":
      return { name, make: () => new GreedyBot() };
    default: {
      const seed = num("seed") ?? 1;
      return { name, make: () => new RandomBot(createAiRng(seed)) };
    }
  }
}

const ALLOWED_KEYS: Record<string, readonly string[]> = {
  expecti: ["ms", "depth", "rerollCap", "off"],
  alphabeta: ["ms", "depth"],
  trapper: ["ms", "depth"],
  greedy: [],
  random: ["seed"]
};
