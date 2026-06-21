import { describe, expect, it } from "vitest";
import { createInitialState, legalCommandsForState, playerView } from "../src/index.js";

describe("playerView (v2)", () => {
  const state = createInitialState({ gameId: "g1", seed: "fixed" });

  it("projects schemaVersion 2 with the viewer seat", () => {
    const view = playerView(state, "red");
    expect(view.schemaVersion).toBe(2);
    expect(view.viewerSeat).toBe("red");
    expect(view.round).toBe(1);
    expect(view.phase).toBe("deploy");
  });

  it("exposes the red HQ (tile9) garrison via owner + units", () => {
    const view = playerView(state, "red");
    const hq = view.areas.find((area) => area.id === "tile9");
    expect(hq).toBeDefined();
    expect(hq?.owner).toBe("red");
    expect(hq?.units.troop).toBe(3);
    expect(hq?.kind).toBe("land");
  });

  it("computes a victory-point tally for both seats", () => {
    const view = playerView(state, "red");
    expect(Number.isFinite(view.victoryPoints.red)).toBe(true);
    expect(Number.isFinite(view.victoryPoints.black)).toBe(true);
  });

  it("redacts a pending decision from the non-owning seat", () => {
    const pending = {
      ...state,
      pendingDecision: { id: "p1", seat: "red" as const, prompt: "choose", choices: [] }
    };
    expect(playerView(pending, "red").pendingDecision?.id).toBe("p1");
    expect(playerView(pending, "black").pendingDecision).toBeNull();
  });

  it("marks free spaces deployable for the active seat and not for the other", () => {
    const active = state.activeSeat;
    const other = active === "red" ? "black" : "red";
    const activeLegal = legalCommandsForState(state, active);
    expect(activeLegal.canPass).toBe(true);
    expect(activeLegal.spaces.some((s) => s.legal)).toBe(true);

    const otherLegal = legalCommandsForState(state, other);
    expect(otherLegal.canPass).toBe(false);
    expect(otherLegal.spaces.every((s) => !s.legal)).toBe(true);
  });

  it("enumerates advance/sail moves for the active seat with max = units - 1", () => {
    // seed "fixed": active = red; HQ tile9 has 3 troops; navy tile14 has 2 ships.
    expect(state.activeSeat).toBe("red");
    const summary = legalCommandsForState(state, state.activeSeat);

    expect(summary.moves.some((m) => m.type === "advance")).toBe(true);
    expect(summary.moves.some((m) => m.type === "sail")).toBe(true);

    // tile9 (3 troops) feeds an advance into adjacent tile1, capped at 2.
    expect(summary.moves.find((m) => m.targetAreaId === "tile1")).toMatchObject({
      spaceId: "advance-tile1",
      type: "advance",
      sources: [{ areaId: "tile9", max: 2 }]
    });

    // tile14 (2 ships) feeds a sail into adjacent tile15, capped at 1.
    expect(summary.moves.find((m) => m.targetAreaId === "tile15")).toMatchObject({
      spaceId: "sail-tile15",
      type: "sail",
      sources: [{ areaId: "tile14", max: 1 }]
    });
  });

  it("never lists a movement target the seat already controls", () => {
    const summary = legalCommandsForState(state, state.activeSeat);
    expect(summary.moves.length).toBeGreaterThan(0);
    for (const move of summary.moves) {
      expect(state.areas[move.targetAreaId]!.owner).not.toBe(state.activeSeat);
    }
  });

  it("gives the non-active seat no moves", () => {
    const other = state.activeSeat === "red" ? "black" : "red";
    expect(legalCommandsForState(state, other).moves).toEqual([]);
  });

  it("excludes a source that has only one unit (cannot move the last unit)", () => {
    const drained = structuredClone(state);
    drained.areas.tile9!.units.troop = 1;
    const sources = legalCommandsForState(drained, "red").moves.flatMap((m) =>
      m.sources.map((s) => s.areaId)
    );
    expect(sources).not.toContain("tile9");
  });

  it("excludes a movement target whose action space is already occupied", () => {
    const occupied = structuredClone(state);
    occupied.actionSpaces["advance-tile1"] = "red";
    const summary = legalCommandsForState(occupied, "red");
    expect(summary.moves.find((m) => m.spaceId === "advance-tile1")).toBeUndefined();
  });

  it("returns no moves outside the deploy phase", () => {
    const recall = structuredClone(state);
    recall.phase = "recall";
    expect(legalCommandsForState(recall, "red").moves).toEqual([]);
  });
});
