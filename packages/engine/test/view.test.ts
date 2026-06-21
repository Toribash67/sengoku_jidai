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
    expect(typeof view.victoryPoints.red).toBe("number");
    expect(typeof view.victoryPoints.black).toBe("number");
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
});
