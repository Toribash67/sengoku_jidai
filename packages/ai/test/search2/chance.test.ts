import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/eval.js";
import { battleOutcomes } from "../../src/search2/battle.js";
import { searchValue } from "../../src/search2/search.js";
import { advanceScenario, ctxFor, noneAbsent } from "./scenario.js";

/** A battle can be expanded fully (every outcome searched) or followed down its most likely
 *  outcome with the other outcomes folded in by their static value. */
describe("chance steps", () => {
  const battle = () => advanceScenario({ attackers: 3, defenders: 1, blackHand: ["mobilise"] });
  const expectedStatic = () => {
    const s = battle();
    const ctx = ctxFor("red");
    return battleOutcomes(s, noneAbsent, ctx).reduce(
      (v, o) => v + o.prob * evaluate(o.state, "red"),
      0
    );
  };

  it("at a leaf both ways equal the exact expected static value", () => {
    for (const fullBattles of [0, 1]) {
      const ctx = { ...ctxFor("red"), fullBattles };
      const v = searchValue(battle(), noneAbsent, 0, -Infinity, Infinity, ctx);
      expect(v).toBeCloseTo(expectedStatic(), 9);
    }
  });

  it("a folded battle still prices the dice and the cards, deeper in the tree", () => {
    const withCards = { ...ctxFor("red"), fullBattles: 0 };
    const blind = {
      ...ctxFor("red", { opponentAmbush: false, rerolls: false, opponentDeployThreats: false }),
      fullBattles: 0
    };
    const many = advanceScenario({
      attackers: 3,
      defenders: 1,
      blackHand: ["mobilise", "mobilise", "mobilise", "mobilise"]
    });
    expect(searchValue(many, noneAbsent, 1, -Infinity, Infinity, withCards)).toBeLessThan(
      searchValue(many, noneAbsent, 1, -Infinity, Infinity, blind)
    );
  });

  it("a folded battle follows its most likely outcome and folds the rest in statically", () => {
    const s = battle();
    const ctx = { ...ctxFor("red"), fullBattles: 0 };
    const outs = battleOutcomes(s, noneAbsent, ctx);
    const likely = outs.reduce((best, o) => (o.prob > best.prob ? o : best));
    const followed = searchValue(likely.state, likely.absent, 1, -Infinity, Infinity, ctx);
    const expected = followed + expectedStatic() - evaluate(likely.state, "red");
    expect(searchValue(s, noneAbsent, 1, -Infinity, Infinity, ctx)).toBeCloseTo(expected, 9);
    // …whereas a fully expanded battle searches every outcome.
    const full = { ...ctx, fullBattles: 1 };
    const each = outs.reduce(
      (v, o) => v + o.prob * searchValue(o.state, o.absent, 1, -Infinity, Infinity, ctx),
      0
    );
    expect(searchValue(s, noneAbsent, 1, -Infinity, Infinity, full)).toBeCloseTo(each, 9);
  });

  it("folding respects the search window it is given", () => {
    const ctx = { ...ctxFor("red"), fullBattles: 0 };
    const exact = searchValue(battle(), noneAbsent, 1, -Infinity, Infinity, ctx);
    const narrow = searchValue(battle(), noneAbsent, 1, exact - 0.5, exact + 0.5, ctx);
    expect(narrow).toBeCloseTo(exact, 9);
  });
});
