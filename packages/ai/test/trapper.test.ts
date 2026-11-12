import { describe, expect, it } from "vitest";
import { createInitialState } from "@sengoku-jidai/engine";
import { GreedyBot } from "../src/bots/greedy.js";
import { TrapperBot } from "../src/bots/trapper.js";
import { runMatch } from "../src/match.js";
import { advanceScenarioRaw } from "./search2/scenario.js";

describe("TrapperBot", () => {
  it("always ambushes when defending with an Ambush in hand", () => {
    const s = advanceScenarioRaw({ attackers: 5, defenders: 1, blackHand: ["ambush"] });
    expect(new TrapperBot({ depth: 1 }).chooseCommand(s, "black")).toEqual({
      type: "combatRoll",
      pendingId: s.pendingCombat!.id,
      card: "ambush"
    });
  });

  it("never discards Ambush to reroll", () => {
    const s = advanceScenarioRaw({
      attackers: 3,
      defenders: 1,
      blackHand: ["ambush"],
      rolled: [0]
    });
    expect(new TrapperBot({ depth: 1 }).chooseCommand(s, "black").type).toBe("combatResolve");
  });

  it("rerolls with another card instead", () => {
    const s = advanceScenarioRaw({
      attackers: 3,
      defenders: 1,
      blackHand: ["ambush", "mobilise"],
      rolled: [0]
    });
    expect(new TrapperBot({ depth: 1 }).chooseCommand(s, "black")).toEqual({
      type: "combatReroll",
      pendingId: s.pendingCombat!.id,
      card: "mobilise"
    });
  });

  it("plans early to build a hand", () => {
    const s = createInitialState({ gameId: "g", seed: "tr" });
    expect(new TrapperBot({ depth: 1 }).chooseCommand(s, s.activeSeat).type).toBe("plan");
  });

  it("plays whole games legally", () => {
    runMatch(new TrapperBot({ depth: 1 }), new GreedyBot(), { seed: "tr-1" });
    runMatch(new GreedyBot(), new TrapperBot({ depth: 1 }), { seed: "tr-1" });
  });
});
