import { describe, expect, it } from "vitest";
import { createInitialState } from "@sengoku-jidai/engine";
import { resolvePending } from "../src/heuristics.js";

function withCombat(phase: "awaiting-roll" | "rolled") {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  return {
    ...s,
    pendingCombat: { id: "c1", responsibleSeat: "red", phase }
  } as unknown as typeof s;
}

describe("resolvePending", () => {
  it("rolls (no card) on an awaiting-roll combat for the responsible seat", () => {
    expect(resolvePending(withCombat("awaiting-roll"), "red")).toEqual({
      type: "combatRoll",
      pendingId: "c1"
    });
  });

  it("resolves a rolled combat", () => {
    expect(resolvePending(withCombat("rolled"), "red")).toEqual({
      type: "combatResolve",
      pendingId: "c1"
    });
  });

  it("returns null when nothing is pending for the seat", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(resolvePending(s, s.activeSeat)).toBeNull();
  });

  it("declines a pending decision when a decline choice exists", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const withDecision = {
      ...s,
      pendingDecision: {
        id: "d1",
        seat: "red",
        choices: [
          { id: "tileX", label: "Shell tileX" },
          { id: "decline", label: "Decline" }
        ]
      }
    } as unknown as typeof s;
    expect(resolvePending(withDecision, "red")).toEqual({
      type: "choosePendingDecision",
      pendingId: "d1",
      choice: { id: "decline", label: "Decline" }
    });
  });
});
