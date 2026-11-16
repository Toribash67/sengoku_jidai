import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveCommand, type Command, type GameState } from "@sengoku-jidai/engine";
import { TUNED_WEIGHTS } from "../../src/eval.js";
import { DEFAULT_FEATURES } from "../../src/search2/features.js";
import { observe } from "../../src/search2/hidden.js";
import {
  chooseCommand,
  newOrderMemo,
  searchValue,
  type SearchCtx
} from "../../src/search2/search.js";

/**
 * From a playtest game the bot lost. Black is on its last commander of the round with two troops
 * on its HQ and two red ships next to it; red moves first next round and kills the HQ by
 * bombardment about three times in four. Black bombarded red's HQ instead (a one-in-nine shot)
 * and lost.
 */
const state = JSON.parse(
  readFileSync(new URL("./fixtures/hq-under-fleet.json", import.meta.url), "utf8")
) as GameState;
const BOMBARD: Command = { type: "bombard", spaceId: "bombard-tile15", targetAreaId: "tile9" };

function valueOf(cmd: Command, depth: number, fullBattles: number): number {
  const obs = observe(state, "black");
  const r = resolveCommand(obs, { seat: "black" }, cmd);
  if (r.status !== "accepted") throw new Error("fixture command rejected");
  const ctx: SearchCtx = {
    viewer: "black",
    weights: TUNED_WEIGHTS,
    features: { ...DEFAULT_FEATURES },
    deadline: 0,
    threatDepth: depth - 1,
    fullBattles,
    threatMemo: new WeakMap(),
    order: newOrderMemo()
  };
  return searchValue(r.nextState, new Set(), depth - 1, -Infinity, Infinity, ctx);
}

describe("a battle most of whose outcomes end the game", () => {
  it("is losing when every outcome is searched", () => {
    expect(valueOf(BOMBARD, 3, 4)).toBeLessThan(-200);
  });

  it("is still losing with the shortcut that follows only the likeliest outcome", () => {
    expect(valueOf(BOMBARD, 3, 0)).toBeLessThan(-200);
  });

  for (const depth of [2, 3, 4]) {
    it(`the bot deals with the fleet at depth ${depth} instead of gambling on the enemy HQ`, () => {
      const cmd = chooseCommand(observe(state, "black"), "black", {
        depth,
        weights: TUNED_WEIGHTS
      });
      expect(cmd).toMatchObject({ type: "shell", spaceId: "shell-tile21" });
    });
  }
});
