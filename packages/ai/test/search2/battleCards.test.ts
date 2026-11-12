import { describe, expect, it } from "vitest";
import { fortressRuleset, resolveCommand, type OperationCard } from "@sengoku-jidai/engine";
import { battleDecision, battleOutcomes } from "../../src/search2/battle.js";
import {
  advanceScenario,
  captureProb,
  ctx,
  noneAbsent as none,
  strikeScenario
} from "./scenario.js";

const cards = (n: number): OperationCard[] => Array<OperationCard>(n).fill("mobilise");

describe("battleOutcomes — the opponent's possible Ambush", () => {
  it("lowers the capture odds as their hand grows", () => {
    const p = [0, 1, 2, 4].map((n) => {
      const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: cards(n) });
      return captureProb(battleOutcomes(s, none, ctx({ rerolls: false })), s.pendingCombat!.area);
    });
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThan(p[i - 1]!);
  });

  it("matches the hand-computed mix for 4 cards", () => {
    // 3 attackers vs 1: capture needs total ≤ 1. One die: 5/6. Three dice: 13/216.
    const pHold = 1 - 5985 / 10626;
    const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: cards(4) });
    const got = captureProb(
      battleOutcomes(s, none, ctx({ rerolls: false })),
      s.pendingCombat!.area
    );
    expect(got).toBeCloseTo(pHold * (13 / 216) + (1 - pHold) * (5 / 6), 10);
  });

  it("stops mattering once all Ambushes are discarded (rerolls off)", () => {
    const gone: OperationCard[] = ["ambush", "ambush", "ambush"];
    const a = advanceScenario({ attackers: 3, defenders: 1, discard: gone });
    const b = advanceScenario({ attackers: 3, defenders: 1, discard: gone, blackHand: cards(4) });
    const f = ctx({ rerolls: false });
    expect(captureProb(battleOutcomes(b, none, f), b.pendingCombat!.area)).toBeCloseTo(
      captureProb(battleOutcomes(a, none, f), a.pendingCombat!.area),
      10
    );
  });

  it("can be switched off", () => {
    const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: cards(4) });
    const outs = battleOutcomes(s, none, ctx({ rerolls: false, opponentAmbush: false }));
    expect(captureProb(outs, s.pendingCombat!.area)).toBeCloseTo(5 / 6, 10);
  });

  it("marks Ambush absent on the branch without it, and spends a card on the branch with it", () => {
    const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: cards(4) });
    const outs = battleOutcomes(s, none, ctx({ rerolls: false }));
    expect(
      outs.some((o) => o.absent.has("ambush") && o.state.players.black.hand.length === 4)
    ).toBe(true);
    expect(
      outs.some(
        (o) =>
          !o.absent.has("ambush") &&
          o.state.players.black.hand.length === 3 &&
          o.state.discard.includes("ambush")
      )
    ).toBe(true);
    expect(outs.reduce((p, o) => p + o.prob, 0)).toBeCloseTo(1, 10);
  });

  it("is ignored on a line that already assumed they hold none", () => {
    const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: cards(4) });
    const outs = battleOutcomes(s, new Set<OperationCard>(["ambush"]), ctx({ rerolls: false }));
    expect(captureProb(outs, s.pendingCombat!.area)).toBeCloseTo(5 / 6, 10);
  });
});

describe("battleDecision — the AI's own combat steps", () => {
  const black = (over = {}) => ctx(over, "black");

  it("as defender it plays its own Ambush when that saves the tile", () => {
    const s = advanceScenario({
      attackers: 3,
      defenders: 1,
      blackHand: ["ambush"],
      viewer: "black"
    });
    expect(battleDecision(s, black())).toEqual({
      type: "combatRoll",
      pendingId: s.pendingCombat!.id,
      card: "ambush"
    });
  });

  it("rolls plainly without an Ambush in hand", () => {
    const s = advanceScenario({
      attackers: 3,
      defenders: 1,
      blackHand: ["mobilise"],
      viewer: "black"
    });
    expect(battleDecision(s, black())).toEqual({
      type: "combatRoll",
      pendingId: s.pendingCombat!.id
    });
  });

  it("rerolling spends the least useful card, never Ambush first", () => {
    const s = advanceScenario({
      attackers: 3,
      defenders: 1,
      blackHand: ["ambush", "mobilise"],
      viewer: "black",
      rolled: [0] // a lost defence
    });
    expect(battleDecision(s, black())).toEqual({
      type: "combatReroll",
      pendingId: s.pendingCombat!.id,
      card: "mobilise"
    });
  });

  it("values a reroll with as many dice as are showing", () => {
    // Three dice showing (an Ambush was played) and all blank: a rethrow throws three again.
    const s = advanceScenario({
      attackers: 3,
      defenders: 1,
      blackHand: ["mobilise"],
      viewer: "black",
      rolled: [0, 0, 0]
    });
    expect(battleDecision(s, black()).type).toBe("combatReroll");
    const p = captureProb(battleOutcomes(s, none, black()), s.pendingCombat!.area);
    expect(p).toBeCloseTo(13 / 216, 10);
  });

  it("accepts a roll that already went its way", () => {
    const s = advanceScenario({
      attackers: 3,
      defenders: 1,
      blackHand: ["mobilise"],
      viewer: "black",
      rolled: [2, 2, 2]
    });
    expect(battleDecision(s, black())).toEqual({
      type: "combatResolve",
      pendingId: s.pendingCombat!.id
    });
  });
});

describe("Take Cover (Fortress)", () => {
  const siege = (blackHand: OperationCard[], viewer: "red" | "black") => {
    const s = strikeScenario({
      type: "siege",
      defenders: 2, // the roll of 2 below would empty the tile; Take Cover saves it
      blackHand,
      viewer,
      ruleset: fortressRuleset
    });
    s.pendingCombat = {
      ...s.pendingCombat!,
      phase: "awaiting-cover",
      responsibleSeat: "black",
      rolls: [2],
      total: 2
    };
    return s;
  };

  it("the AI answers a siege's Take Cover offer with a legal command", () => {
    const s = siege(["take_cover"], "black");
    const cmd = battleDecision(s, ctx({}, "black"));
    expect(cmd.type).toBe("combatResolve");
    expect(resolveCommand(s, { seat: "black" }, cmd).status).toBe("accepted");
  });

  it("an opponent who may hold Take Cover sometimes blunts the siege", () => {
    const s = siege(cards(4), "red");
    const outs = battleOutcomes(s, none, ctx());
    expect(outs.reduce((p, o) => p + o.prob, 0)).toBeCloseTo(1, 10);
    expect(outs.some((o) => o.state.discard.includes("take_cover"))).toBe(true);
    expect(outs.some((o) => o.absent.has("take_cover"))).toBe(true);
    const off = battleOutcomes(s, none, ctx({ takeCover: false }));
    expect(off).toHaveLength(1);
  });
});
