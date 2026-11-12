import { describe, expect, it } from "vitest";
import { deckFor, resolveCommand, type Command, type OperationCard } from "@sengoku-jidai/engine";
import { evaluate } from "../../src/eval.js";
import { deployCandidates } from "../../src/candidates.js";
import type { Features } from "../../src/search2/features.js";
import { grantCard, observe } from "../../src/search2/hidden.js";
import { searchValue } from "../../src/search2/search.js";
import { ctxFor, opponentToMove } from "./scenario.js";

const cards = (n: number): OperationCard[] => Array<OperationCard>(n).fill("mobilise");
const none = new Set<OperationCard>();
const seeds = ["t1", "t2", "t3", "t4", "t5", "t6"];
const cardBlind: Partial<Features> = { opponentDeployThreats: false, followUps: false };

const value = (seed: string, n: number, features?: Partial<Features>) => {
  const { state, viewer } = opponentToMove(seed, cards(n));
  const observed = observe(state, viewer);
  return searchValue(observed, none, 1, -Infinity, Infinity, ctxFor(viewer, features));
};

describe("opponent card threats", () => {
  it("possible opponent cards can only lower the position's value", () => {
    for (const seed of seeds) {
      expect(value(seed, 4)).toBeLessThanOrEqual(value(seed, 4, cardBlind) + 1e-9);
    }
  });

  it("they lower it strictly somewhere", () => {
    expect(seeds.some((seed) => value(seed, 4) < value(seed, 4, cardBlind) - 1e-9)).toBe(true);
  });

  it("an opponent with no cards poses no card threat", () => {
    for (const seed of seeds) expect(value(seed, 0)).toBeCloseTo(value(seed, 0, cardBlind), 9);
  });

  it("the penalty never exceeds the worst single deploy-time threat", () => {
    for (const seed of seeds) {
      const { state, viewer } = opponentToMove(seed, cards(6));
      const observed = observe(state, viewer);
      const mover = observed.activeSeat;
      const after = (from: typeof observed, cmd: Command) => {
        const r = resolveCommand(from, { seat: mover }, cmd);
        return r.status === "accepted" ? evaluate(r.nextState, viewer) : Infinity;
      };
      // Their best card-free option, and the best they could do holding any ONE kind outright,
      // both judged one deployment deep by static value.
      const plain = Math.min(...deployCandidates(observed, mover).map((c) => after(observed, c)));
      let worst = plain;
      for (const kind of new Set(deckFor(observed.rules.rulesetId))) {
        const granted = grantCard(observed, mover, kind)!;
        for (const cmd of deployCandidates(granted, mover)) {
          if ("card" in cmd && cmd.card === kind) worst = Math.min(worst, after(granted, cmd));
        }
      }
      const penalty = value(seed, 6, { followUps: false }) - value(seed, 6, cardBlind);
      expect(penalty).toBeGreaterThanOrEqual(worst - plain - 1e-9);
    }
  });

  it("threats are weighed only at the immediate reply", () => {
    const { state, viewer } = opponentToMove("t1", cards(4));
    const observed = observe(state, viewer);
    const deeper = { ...ctxFor(viewer), threatDepth: 5 };
    const noDeployThreats = ctxFor(viewer, { opponentDeployThreats: false });
    expect(searchValue(observed, none, 1, -Infinity, Infinity, deeper)).toBeCloseTo(
      searchValue(observed, none, 1, -Infinity, Infinity, noDeployThreats),
      9
    );
  });
});
