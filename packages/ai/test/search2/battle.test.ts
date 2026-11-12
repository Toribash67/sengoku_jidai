import { describe, expect, it } from "vitest";
import { battleOutcomes } from "../../src/search2/battle.js";
import {
  advanceScenario,
  captureProb,
  ctx,
  noneAbsent as none,
  strikeScenario
} from "./scenario.js";

describe("battleOutcomes — dice and rerolls", () => {
  it("probabilities sum to 1 and every outcome is resolved", () => {
    const s = advanceScenario({ attackers: 3, defenders: 1 });
    const outs = battleOutcomes(s, none, ctx());
    expect(outs.reduce((p, o) => p + o.prob, 0)).toBeCloseTo(1, 10);
    for (const o of outs) expect(o.state.pendingCombat?.id).not.toBe(s.pendingCombat!.id);
  });

  it("3 attackers on 1 defender with one die capture 5/6 of the time", () => {
    // faces 0,1,1,1,1,2: totals 0 and 1 leave ≥1 attacker after attrition; total 2 leaves none.
    const s = advanceScenario({ attackers: 3, defenders: 1 }); // black holds no cards
    const p = captureProb(battleOutcomes(s, none, ctx()), s.pendingCombat!.area);
    expect(p).toBeCloseTo(5 / 6, 10);
  });

  it("a defender holding cards rerolls a lost defence, lowering the capture odds", () => {
    const noCards = advanceScenario({ attackers: 3, defenders: 1 });
    const twoCards = advanceScenario({
      attackers: 3,
      defenders: 1,
      blackHand: ["mobilise", "mobilise"]
    });
    const area = noCards.pendingCombat!.area;
    const f = { opponentAmbush: false };
    const p0 = captureProb(battleOutcomes(noCards, none, ctx(f)), area);
    const p2 = captureProb(battleOutcomes(twoCards, none, ctx(f)), area);
    expect(p2).toBeLessThan(p0);
    const off = battleOutcomes(twoCards, none, ctx({ ...f, rerolls: false }));
    expect(captureProb(off, area)).toBeCloseTo(p0, 10);
  });

  it("a rethrow costs the roller a card", () => {
    const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: ["mobilise", "mobilise"] });
    const outs = battleOutcomes(s, none, ctx({ opponentAmbush: false }));
    expect(outs.some((o) => o.state.players.black.hand.length < 2)).toBe(true);
    for (const o of outs) {
      expect(o.state.players.black.hand.length + o.state.discard.length).toBe(2);
    }
  });

  it("with the dice distribution off there is a single outcome", () => {
    const s = advanceScenario({ attackers: 3, defenders: 1 });
    const outs = battleOutcomes(s, none, ctx({ diceDistribution: false, rerolls: false }));
    expect(outs).toHaveLength(1);
  });

  it("a strike's outcomes follow its dice count", () => {
    const s = strikeScenario({ type: "bombard", defenders: 3 });
    const outs = battleOutcomes(s, none, ctx({ rerolls: false }));
    expect(outs.reduce((p, o) => p + o.prob, 0)).toBeCloseTo(1, 10);
    expect(outs.length).toBeGreaterThan(1);
  });

  it("does not mutate its input", () => {
    const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: ["mobilise"] });
    const before = structuredClone(s);
    battleOutcomes(s, none, ctx());
    expect(s).toEqual(before);
  });
});
