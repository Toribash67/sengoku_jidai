import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { validateCommand } from "../src/validate.js";
import type { Command } from "../src/commands.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

function base() {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  return s;
}

describe("validateCommand common criteria", () => {
  it("rejects when it is not the actor's turn", () => {
    const s = base();
    const r = validateCommand(s, { seat: "black" }, { type: "pass" });
    expect(r?.code).toBe("notActiveSeat");
  });

  it("rejects when the game is not active", () => {
    const s = base();
    s.status = "complete";
    expect(validateCommand(s, { seat: "red" }, { type: "pass" })?.code).toBe("gameNotActive");
  });

  it("accepts a pass on the active seat's turn", () => {
    const s = base();
    expect(validateCommand(s, { seat: "red" }, { type: "pass" })).toBeNull();
  });

  it("rejects an unknown space", () => {
    const s = base();
    const cmd: Command = { type: "advance", spaceId: "advance-nope", moves: [] };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("spaceNotFound");
  });

  it("rejects a space of the wrong type for the command", () => {
    const s = base();
    const cmd: Command = { type: "advance", spaceId: "sail-tile3", moves: [] };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("spaceWrongType");
  });

  it("rejects an occupied space", () => {
    const s = base();
    s.actionSpaces["advance-tile1"] = "black";
    const cmd: Command = {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: hqOf("red"), count: 1 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("spaceOccupied");
  });
});

describe("validateCommand per-action criteria", () => {
  it("advance: rejects taking the last unit from a source", () => {
    const s = base();
    const cmd: Command = {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: hqOf("red"), count: 3 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalMove");
  });

  it("advance: rejects advancing into an area you already control", () => {
    const s = base();
    const cmd: Command = {
      type: "advance",
      spaceId: `advance-${hqOf("red")}`,
      moves: [{ from: hqOf("red"), count: 1 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("criteriaNotMet");
  });

  it("advance: accepts a legal single-troop move into an adjacent empty land", () => {
    const s = base();
    const cmd: Command = {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: hqOf("red"), count: 2 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)).toBeNull();
  });

  it("reinforce: rejects placing more than N (+ barracks) troops", () => {
    const s = base();
    const cmd: Command = {
      type: "reinforce",
      spaceId: "reinforce-b",
      placements: [{ area: hqOf("red"), count: 6 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalPlacement");
  });

  it("reinforce: rejects when reserve is insufficient", () => {
    const s = base();
    s.players.red.reserve.troop = 1;
    const cmd: Command = {
      type: "reinforce",
      spaceId: "reinforce-a",
      placements: [{ area: hqOf("red"), count: 2 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("insufficientReserve");
  });

  it("reinforce: rejects a second reinforce space the same round", () => {
    const s = base();
    s.actionSpaces["reinforce-a"] = "red";
    const cmd: Command = {
      type: "reinforce",
      spaceId: "reinforce-b",
      placements: [{ area: hqOf("red"), count: 1 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("supportTypeUsed");
  });

  it("bombard: rejects a target that is not adjacent land to the linked water", () => {
    const s = base();
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    const cmd: Command = { type: "bombard", spaceId: "bombard-tile15", targetAreaId: "tile3" };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalTarget");
  });

  it("choosePendingDecision: rejects when there is no pending decision", () => {
    const s = base();
    const cmd: Command = {
      type: "choosePendingDecision",
      pendingId: "x",
      choice: { id: "a", label: "A" }
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("pendingDecisionNotFound");
  });

  it("advance: rejects duplicate-source moves that together take the last unit", () => {
    const s = base();
    // HQ tile9 has 3 troops; two moves of 2 from the same source sum to 4 > 3-1.
    const cmd: Command = {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [
        { from: hqOf("red"), count: 2 },
        { from: hqOf("red"), count: 2 }
      ]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalMove");
  });

  it("rejects deploying when the seat has no commanders available", () => {
    const s = base();
    s.players.red.commanders.standby = 5; // total 5, occupied 0 -> available 0
    expect(validateCommand(s, { seat: "red" }, { type: "pass" })?.code).toBe("noCommanders");
  });

  it("bombard: rejects a target with no enemy units", () => {
    const s = base();
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    // tile16 is adjacent land to tile15 but empty (no enemy) -> illegal.
    const cmd: Command = { type: "bombard", spaceId: "bombard-tile15", targetAreaId: "tile16" };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalTarget");
  });

  it("shell: rejects a target with no enemy units", () => {
    const s = base();
    s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    // tile11 is adjacent sea to shellable tile10 but empty (no enemy) -> illegal.
    const cmd: Command = { type: "shell", spaceId: "shell-tile10", targetAreaId: "tile11" };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalTarget");
  });
});
