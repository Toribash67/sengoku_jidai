import { describe, expect, it } from "vitest";
import { AlphaBetaBot } from "../src/bots/alphabeta.js";
import { ExpectiBot } from "../src/bots/expecti.js";
import { GreedyBot } from "../src/bots/greedy.js";
import { RandomBot } from "../src/bots/random.js";
import { TrapperBot } from "../src/bots/trapper.js";
import { parseBotSpec } from "../src/botRegistry.js";

describe("parseBotSpec", () => {
  it("builds bots from specs", () => {
    expect(parseBotSpec("expecti:depth=2,off=rerolls+opponentAmbush").make()).toBeInstanceOf(
      ExpectiBot
    );
    expect(parseBotSpec("alphabeta:ms=1500").make()).toBeInstanceOf(AlphaBetaBot);
    expect(parseBotSpec("trapper").make()).toBeInstanceOf(TrapperBot);
    expect(parseBotSpec("greedy").make()).toBeInstanceOf(GreedyBot);
    expect(parseBotSpec("random:seed=3").make()).toBeInstanceOf(RandomBot);
    expect(parseBotSpec("expecti:rerollCap=1").name).toBe("expecti");
  });

  it("rejects unknown names and keys", () => {
    expect(() => parseBotSpec("nope")).toThrow(/nope/);
    expect(() => parseBotSpec("expecti:off=telepathy")).toThrow(/telepathy/);
    expect(() => parseBotSpec("greedy:depth=2")).toThrow(/depth/);
    expect(() => parseBotSpec("expecti:depth=two")).toThrow(/two/);
  });
});
