import { describe, expect, it } from "vitest";
import { createInitialState } from "@sengoku-jidai/engine";
import { onTheClock } from "../src/onclock.js";

describe("onTheClock", () => {
  it("returns the active seat at the opening (deploy phase, no pending)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(onTheClock(s)).toBe(s.activeSeat);
  });

  it("returns null once the game is not active", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const done = { ...s, status: "complete" as const };
    expect(onTheClock(done)).toBeNull();
  });

  it("prefers the combat-responsible seat when a combat is pending", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const withCombat = {
      ...s,
      pendingCombat: { id: "c1", responsibleSeat: other(s.activeSeat), phase: "awaiting-roll" }
    } as unknown as typeof s;
    expect(onTheClock(withCombat)).toBe(other(s.activeSeat));
  });
});

import { other } from "../src/types.js";
