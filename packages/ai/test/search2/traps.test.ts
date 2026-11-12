import { describe, expect, it } from "vitest";
import type { Command, OperationCard } from "@sengoku-jidai/engine";
import { AlphaBetaBot } from "../../src/bots/alphabeta.js";
import { ExpectiBot } from "../../src/bots/expecti.js";
import { evaluate } from "../../src/eval.js";
import { battleOutcomes, type Outcome } from "../../src/search2/battle.js";
import { advanceScenario, attackChoiceScenario, ctx, noneAbsent } from "./scenario.js";

/** The positions the rebuild exists for: the same attack, into an empty hand and into four cards. */

const hand = (n: number): OperationCard[] => Array<OperationCard>(n).fill("mobilise");
/** True when `cmd` launches the scenario's attack (with any number of troops). */
const attacks = (cmd: Command, attack: Command) =>
  cmd.type === "advance" && attack.type === "advance" && cmd.spaceId === attack.spaceId;
const grid = [2, 3, 4, 5].flatMap((a) => [1, 2, 3].filter((d) => d < a).map((d) => ({ a, d })));

const choice = (
  bot: { chooseCommand: ExpectiBot["chooseCommand"] },
  a: number,
  d: number,
  blackHand: OperationCard[],
  discard: OperationCard[] = []
) => {
  const { state, attack } = attackChoiceScenario({
    attackers: a,
    defenders: d,
    blackHand,
    discard
  });
  return attacks(bot.chooseCommand(state, "red"), attack);
};

describe("trap positions", () => {
  it("there is an attack it makes against an empty hand and declines against four cards", () => {
    const bot = new ExpectiBot({ depth: 2 });
    const flips = grid.filter(({ a, d }) => choice(bot, a, d, []) && !choice(bot, a, d, hand(4)));
    expect(flips.length).toBeGreaterThan(0);
  });

  it("it never does the reverse: attack into four cards but not into none", () => {
    const bot = new ExpectiBot({ depth: 2 });
    for (const { a, d } of grid) {
      if (choice(bot, a, d, hand(4))) expect(choice(bot, a, d, [])).toBe(true);
    }
  });

  it("the old bot attacks regardless of hand size (the bug this project fixes)", () => {
    const old = new AlphaBetaBot({ depth: 2 });
    for (const { a, d } of grid) {
      expect(choice(old, a, d, hand(4))).toBe(choice(old, a, d, []));
    }
  });

  it("with every Ambush discarded and rerolls off, four cards no longer deter", () => {
    const gone: OperationCard[] = ["ambush", "ambush", "ambush"];
    const bot = new ExpectiBot({
      depth: 2,
      features: { rerolls: false, opponentDeployThreats: false }
    });
    for (const { a, d } of grid) {
      expect(choice(bot, a, d, hand(4), gone)).toBe(choice(bot, a, d, [], gone));
    }
  });

  it("values a risky attack below what the average roll alone suggests", () => {
    // 4 attackers on 2: the mean roll (1) always captures; the real dice fail 1 time in 6.
    const s = advanceScenario({ attackers: 4, defenders: 2 });
    const ev = (o: Outcome[]) => o.reduce((v, x) => v + x.prob * evaluate(x.state, "red"), 0);
    const exact = battleOutcomes(s, noneAbsent, ctx({ rerolls: false }));
    const mean = battleOutcomes(s, noneAbsent, ctx({ rerolls: false, diceDistribution: false }));
    expect(ev(exact)).toBeLessThan(ev(mean));
  });
});
