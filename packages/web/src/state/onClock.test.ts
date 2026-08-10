import { describe, expect, it } from "vitest";
import { onClockSeat } from "./onClock.js";

const base = { status: "active" as const, activeSeat: "red" as const, pendingCombat: null, pendingDecision: null };

describe("onClockSeat", () => {
  it("returns null when the game is not active", () => {
    expect(onClockSeat({ ...base, status: "complete" })).toBeNull();
  });
  it("returns the active seat when nothing is pending", () => {
    expect(onClockSeat(base)).toBe("red");
  });
  it("prefers the combat responsible seat", () => {
    expect(onClockSeat({ ...base, pendingCombat: { responsibleSeat: "black" } })).toBe("black");
  });
  it("uses the pending decision seat over the active seat", () => {
    expect(onClockSeat({ ...base, pendingDecision: { seat: "black" } })).toBe("black");
  });
});
