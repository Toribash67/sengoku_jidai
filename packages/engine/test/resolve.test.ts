import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { resolveCommand } from "../src/resolve.js";
import { available } from "../src/legality.js";

function game() {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  return s;
}

describe("resolveCommand — pass & turn flow", () => {
  it("rejects an illegal command without mutating state", () => {
    const s = game();
    const before = JSON.stringify(s);
    const r = resolveCommand(s, { seat: "black" }, { type: "pass" });
    expect(r.status).toBe("rejected");
    expect(JSON.stringify(s)).toBe(before); // input not mutated
  });

  it("pass moves a commander to standby, bumps revision, toggles active seat", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "pass" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.commanders.standby).toBe(1);
    expect(r.nextState.revision).toBe(1);
    expect(r.nextState.activeSeat).toBe("black");
    expect(available(r.nextState, "red")).toBe(4);
  });

  it("ten passes end round 1 and auto-recall advances to round 2", () => {
    let s = game();
    for (let i = 0; i < 10; i++) {
      const seat = i % 2 === 0 ? "red" : "black";
      const r = resolveCommand(s, { seat }, { type: "pass" });
      expect(r.status).toBe("accepted");
      if (r.status !== "accepted") return;
      s = r.nextState;
    }
    expect(s.round).toBe(2);
    expect(s.phase).toBe("deploy");
    expect(s.activeSeat).toBe(s.initiative);
    expect(s.players.red.commanders.standby).toBe(0);
    expect(Object.values(s.actionSpaces).every((o) => o === null)).toBe(true);
  });

  it("after round 4 the game ends by victory points", () => {
    let s = game();
    for (let round = 1; round <= 4; round++) {
      for (let i = 0; i < 10; i++) {
        const seat = i % 2 === 0 ? s.initiative : s.initiative === "red" ? "black" : "red";
        const r = resolveCommand(s, { seat }, { type: "pass" });
        if (r.status !== "accepted") throw new Error("unexpected rejection");
        s = r.nextState;
      }
    }
    expect(s.status).toBe("complete");
    expect(s.endReason).toBe("victoryPoints");
    expect(s.winner).toBe(s.initiative);
  });
});
