import { describe, expect, it } from "vitest";
import { fortressRuleset, resolveCommand } from "@sengoku-jidai/engine";
import { ExpectiBot } from "../../src/bots/expecti.js";
import { GreedyBot } from "../../src/bots/greedy.js";
import { RandomBot } from "../../src/bots/random.js";
import { runMatch, runMatches } from "../../src/match.js";
import { onTheClock } from "../../src/onclock.js";
import { createAiRng } from "../../src/rng.js";
import { commandeerTwoBattlesScenario } from "./scenario.js";

describe("ExpectiBot — whole games", () => {
  it.each([
    ["rivers", undefined],
    ["fortress", fortressRuleset]
  ] as const)(
    "plays %s games against random and greedy without an illegal command",
    (_name, rules) => {
      for (const seed of ["g1", "g2", "g3"]) {
        for (const foe of [new RandomBot(createAiRng(5)), new GreedyBot()]) {
          const r = runMatch(new ExpectiBot({ depth: 1 }), foe, { seed, rules }); // throws on illegal
          expect(r.commands).toBeGreaterThan(0);
          runMatch(foe, new ExpectiBot({ depth: 1 }), { seed, rules });
        }
      }
    },
    120_000
  );

  it("walks through several battles queued by one Commandeer", () => {
    const s = commandeerTwoBattlesScenario();
    const after = resolveCommand(s.state, { seat: "red" }, s.command);
    expect(after.status).toBe("accepted");
    if (after.status !== "accepted") return;
    let cur = after.nextState;
    expect(cur.pendingCombat !== null || cur.pendingDecision !== null).toBe(true);
    const bots = { red: new ExpectiBot({ depth: 1 }), black: new ExpectiBot({ depth: 1 }) };
    for (let i = 0; i < 50 && (cur.pendingCombat || cur.pendingDecision); i++) {
      const seat = onTheClock(cur)!;
      const r = resolveCommand(cur, { seat }, bots[seat].chooseCommand(cur, seat));
      expect(r.status).toBe("accepted");
      if (r.status !== "accepted") return;
      cur = r.nextState;
    }
    expect(cur.pendingCombat).toBeNull();
    expect(cur.combatQueue).toHaveLength(0);
  });

  it("looks ahead through a Commandeer's queued battles without looping", () => {
    const s = commandeerTwoBattlesScenario();
    const cmd = new ExpectiBot({ depth: 2 }).chooseCommand(s.state, "red");
    expect(resolveCommand(s.state, { seat: "red" }, cmd).status).toBe("accepted");
  });

  it.skipIf(!process.env.AI_STRENGTH_TESTS)(
    "depth-2 expecti beats the greedy baseline over a seeded series",
    () => {
      const res = runMatches(new ExpectiBot({ depth: 2 }), new GreedyBot(), {
        seeds: ["s1", "s2", "s3", "s4", "s5", "s6"]
      });
      expect(res.aWins).toBeGreaterThanOrEqual(9); // of 12
    },
    600_000
  );
});
