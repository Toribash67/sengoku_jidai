import { describe, expect, it } from "vitest";
import { createInitialState, legalCommandsForState, resolveCommand } from "@sengoku-jidai/engine";
import { deployCandidates } from "../src/candidates.js";
import { greedyCommand } from "../src/bots/greedy.js";
import { onTheClock } from "../src/onclock.js";

describe("deployCandidates", () => {
  it("offers a non-empty candidate set including pass at the opening", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cands = deployCandidates(s, s.activeSeat);
    expect(cands.length).toBeGreaterThan(1);
    expect(cands).toContainEqual({ type: "pass" });
  });

  it("only produces commands the engine accepts", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const seat = s.activeSeat;
    for (const c of deployCandidates(s, seat)) {
      const r = resolveCommand(s, { seat }, c);
      expect(r.status, `rejected ${JSON.stringify(c)}`).toBe("accepted");
    }
  });

  it("returns an empty set when it is not the seat's clean deploy turn", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const notActive = s.activeSeat === "red" ? "black" : "red";
    expect(deployCandidates(s, notActive)).toEqual([]);
  });

  // Regression: a move with several legal sources must offer a solo attack from EACH source, not
  // just the strongest. Pulling from a weaker tile (leaving the strong stack home) is often the
  // better play, and the search can only pick candidates that are offered. Driven over a short
  // greedy playout to reach real multi-source positions; the counter guards against a vacuous pass.
  it("offers a solo command from every source of a multi-source move", () => {
    let exercised = 0;
    for (const seed of ["seed-A", "seed-B", "seed-C"]) {
      let state = createInitialState({ gameId: seed, seed });
      for (let step = 0; step < 200 && state.status === "active"; step++) {
        const seat = onTheClock(state);
        if (!seat) break;
        const cleanDeploy =
          !state.pendingCombat && !state.pendingDecision && state.activeSeat === seat;
        if (cleanDeploy) {
          const legal = legalCommandsForState(state, seat);
          const cands = deployCandidates(state, seat);
          for (const mv of legal.moves) {
            const sources = mv.sources.filter((s) => s.max > 0);
            if (sources.length < 2) continue;
            exercised++;
            for (const s of sources) {
              const solo = {
                type: mv.type,
                spaceId: mv.spaceId,
                moves: [{ from: s.areaId, count: s.max }]
              };
              expect(cands, `missing solo from ${s.areaId} for ${mv.spaceId}`).toContainEqual(solo);
            }
          }
        }
        const r = resolveCommand(state, { seat }, greedyCommand(state, seat));
        expect(r.status).toBe("accepted");
        state = r.status === "accepted" ? r.nextState : state;
        if (r.status !== "accepted") break;
      }
    }
    expect(
      exercised,
      "test never reached a multi-source move — assertion was vacuous"
    ).toBeGreaterThan(0);
  });
});
