import type { Bot } from "./types.js";
import { AlphaBetaBot } from "./bots/alphabeta.js";
import { ExpectiBot } from "./bots/expecti.js";
import { GreedyBot } from "./bots/greedy.js";
import { RandomBot } from "./bots/random.js";
import { TrapperBot } from "./bots/trapper.js";
import { TUNED_WEIGHTS, TUNED_WEIGHTS_V1, type EvalWeights } from "./eval.js";
import { createAiRng } from "./rng.js";
import { DEFAULT_FEATURES, type Features } from "./search2/features.js";

/**
 * Bots by name, for the duel script. Grammar: `name[:key=value[,key=value…]]`.
 *
 *   expecti    ms, depth, weights, rerollCap, fullBattles, off (features to switch off, joined
 *              with `+`)
 *   alphabeta  ms, depth, weights
 *   trapper    ms, depth, weights
 *
 * `weights` is `default` (the hand-set scoring weights), `tuned` (the latest weights fitted to
 * game outcomes) or `tuned1` (the first fitted round).
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
  const weightSet = args.get("weights") ?? "default";
  if (!(weightSet in WEIGHT_SETS)) {
    throw new Error(`Unknown weights "${weightSet}" (known: ${Object.keys(WEIGHT_SETS)})`);
  }
  const weights = WEIGHT_SETS[weightSet];
  const budget = { depth: num("depth"), deadlineMs: num("ms"), ...(weights ? { weights } : {}) };

  switch (name) {
    case "expecti": {
      const features: Partial<Features> = {};
      const rerollCap = num("rerollCap");
      if (rerollCap !== undefined) features.rerollCap = rerollCap;
      const fullBattles = num("fullBattles");
      if (fullBattles !== undefined) features.fullBattles = fullBattles;
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

/** Named scoring weights. Earlier fitted rounds stay available as sparring versions. */
const WEIGHT_SETS: Record<string, EvalWeights | undefined> = {
  default: undefined,
  tuned: TUNED_WEIGHTS,
  tuned1: TUNED_WEIGHTS_V1
};

const ALLOWED_KEYS: Record<string, readonly string[]> = {
  expecti: ["ms", "depth", "weights", "rerollCap", "fullBattles", "off"],
  alphabeta: ["ms", "depth", "weights"],
  trapper: ["ms", "depth", "weights"],
  greedy: [],
  random: ["seed"]
};
