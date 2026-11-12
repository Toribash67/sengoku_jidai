import { describe, expect, it } from "vitest";
import { createInitialState, createRngState, resolveCommand } from "@sengoku-jidai/engine";
import { ExpectiBot } from "../../src/bots/expecti.js";
import { onTheClock } from "../../src/onclock.js";
import { other } from "../../src/types.js";
import { advanceScenarioRaw, stateAfterGreedyPlies } from "./scenario.js";

const opening = (seed: string) => createInitialState({ gameId: "g", seed });

describe("ExpectiBot", () => {
  it("returns an engine-accepted command from the opening", () => {
    const s = opening("x1");
    const cmd = new ExpectiBot({ depth: 2 }).chooseCommand(s, s.activeSeat);
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });

  it("is a pure function of the observation at fixed depth", () => {
    const s = opening("x2");
    const bot = new ExpectiBot({ depth: 2 });
    expect(bot.chooseCommand(s, s.activeSeat)).toEqual(bot.chooseCommand(s, s.activeSeat));
  });

  it("ignores hidden information (fairness)", () => {
    for (const seed of ["f1", "f2", "f3", "f4"]) {
      const a = stateAfterGreedyPlies(seed, 12);
      const seat = onTheClock(a)!;
      const enemy = other(seat);
      const b = structuredClone(a);
      const pool = [...b.players[enemy].hand, ...b.deck]; // reshuffle the unseen cards
      pool.reverse();
      b.players[enemy].hand = pool.slice(0, a.players[enemy].hand.length);
      b.deck = pool.slice(a.players[enemy].hand.length);
      b.rngState = createRngState("different");
      const bot = new ExpectiBot({ depth: 2 });
      expect(bot.chooseCommand(b, seat)).toEqual(bot.chooseCommand(a, seat));
    }
  });

  it("still answers when the deadline is too short for depth 1", () => {
    const s = opening("x3");
    const cmd = new ExpectiBot({ deadlineMs: 0 }).chooseCommand(s, s.activeSeat);
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });

  it("respects its deadline", () => {
    const s = stateAfterGreedyPlies("x4", 12);
    const t = Date.now();
    new ExpectiBot({ deadlineMs: 300 }).chooseCommand(s, onTheClock(s)!);
    expect(Date.now() - t).toBeLessThan(300 + 400); // budget plus a margin for one node
  });

  it("never emits a hidden card", () => {
    // black is on the clock with the dice showing; raw = not observed, as the bot receives it
    const s = advanceScenarioRaw({
      attackers: 3,
      defenders: 1,
      blackHand: ["mobilise"],
      rolled: [0]
    });
    const cmd = new ExpectiBot({ depth: 1 }).chooseCommand(s, "black");
    expect(JSON.stringify(cmd)).not.toContain("hidden");
    expect(resolveCommand(s, { seat: "black" }, cmd).status).toBe("accepted");
  });

  it("passes when it is not on the clock", () => {
    const s = opening("x5");
    expect(new ExpectiBot({ depth: 1 }).chooseCommand(s, other(s.activeSeat))).toEqual({
      type: "pass"
    });
  });
});
