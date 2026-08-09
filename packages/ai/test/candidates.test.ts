import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { deployCandidates } from "../src/candidates.js";

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
});
