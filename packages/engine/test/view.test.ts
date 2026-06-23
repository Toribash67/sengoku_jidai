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
    expect(hq?.units.troop).toBe(5);
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
    // seed "fixed": active = red; HQ tile9 has 5 troops; navy tile14 has 3 ships.
    expect(state.activeSeat).toBe("red");
    const summary = legalCommandsForState(state, state.activeSeat);

    expect(summary.moves.some((m) => m.type === "advance")).toBe(true);
    expect(summary.moves.some((m) => m.type === "sail")).toBe(true);

    // tile9 (5 troops) feeds an advance into adjacent tile1, capped at 4.
    expect(summary.moves.find((m) => m.targetAreaId === "tile1")).toMatchObject({
      spaceId: "advance-tile1",
      type: "advance",
      sources: [{ areaId: "tile9", max: 4 }]
    });

    // tile14 (3 ships) feeds a sail into adjacent tile15, capped at 2.
    expect(summary.moves.find((m) => m.targetAreaId === "tile15")).toMatchObject({
      spaceId: "sail-tile15",
      type: "sail",
      sources: [{ areaId: "tile14", max: 2 }]
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

  // At setup red supplies exactly {tile9 (HQ), tile14 (navy)} and no bonus slot, so
  // Barracks/Pirate Haven never apply here — pools and dice are exact.

  it("enumerates reinforce/embark placements with unit, reserve, pool and targets", () => {
    const summary = legalCommandsForState(state, "red");

    const reinforce = summary.placements.filter((p) => p.type === "reinforce");
    expect(reinforce.map((p) => p.spaceId).sort()).toEqual(["reinforce-a", "reinforce-b"]);
    for (const p of reinforce) {
      expect(p.unit).toBe("troop");
      expect(p.reserve).toBe(20); // 25 pool - 5 on the HQ
      expect(p.targets).toEqual(["tile9"]); // only supplied land at setup
    }
    expect(reinforce.find((p) => p.spaceId === "reinforce-a")!.pool).toBe(6);
    expect(reinforce.find((p) => p.spaceId === "reinforce-b")!.pool).toBe(5);

    const embark = summary.placements.filter((p) => p.type === "embark");
    expect(embark.map((p) => p.spaceId).sort()).toEqual(["embark-a", "embark-b"]);
    for (const p of embark) {
      expect(p.unit).toBe("ship");
      expect(p.reserve).toBe(7); // 10 pool - 3 in the navy
      expect([...p.targets].sort()).toEqual(["tile14", "tile15"]); // supplied sea + port
    }
    expect(embark.find((p) => p.spaceId === "embark-a")!.pool).toBe(3);
  });

  it("drops reinforce placements once a Reinforce space is used, keeping embark", () => {
    const used = structuredClone(state);
    used.actionSpaces["reinforce-a"] = "red";
    const placements = legalCommandsForState(used, "red").placements;
    expect(placements.some((p) => p.type === "reinforce")).toBe(false);
    expect(placements.some((p) => p.type === "embark")).toBe(true);
  });

  it("enumerates both Plan spaces, flagging the initiative one", () => {
    const plans = legalCommandsForState(state, "red").plans;
    expect(plans.find((p) => p.spaceId === "plan-a")).toMatchObject({ initiative: true });
    expect(plans.find((p) => p.spaceId === "plan-b")).toMatchObject({ initiative: false });
  });

  it("drops all Plan options once a Plan space is used this round", () => {
    const used = structuredClone(state);
    used.actionSpaces["plan-a"] = "red";
    expect(legalCommandsForState(used, "red").plans).toEqual([]);
  });

  it("offers no strikes at setup (no enemy borders a supplied area)", () => {
    expect(legalCommandsForState(state, "red").strikes).toEqual([]);
  });

  it("enumerates a bombard against enemy land adjacent to supplied water", () => {
    const scenario = structuredClone(state);
    // tile19 is land adjacent to red-supplied sea tile14.
    scenario.areas.tile19 = { owner: "black", units: { troop: 2, ship: 0, siege: 0 } };
    const strike = legalCommandsForState(scenario, "red").strikes.find(
      (s) => s.spaceId === "bombard-tile14"
    );
    expect(strike).toMatchObject({ type: "bombard", linkedAreaId: "tile14", dice: 3 });
    // Exact: only the enemy land is offered; the friendly neighbour tile9 is filtered out.
    expect(strike!.targets).toEqual(["tile19"]);
  });

  it("enumerates a shell against enemy ships adjacent to supplied shellable land", () => {
    const scenario = structuredClone(state);
    // Red controls shellable land tile10 (adjacent to HQ -> supplied); black ships sit on
    // adjacent sea tile11.
    scenario.areas.tile10 = { owner: "red", units: { troop: 3, ship: 0, siege: 0 } };
    scenario.areas.tile11 = { owner: "black", units: { troop: 0, ship: 2, siege: 0 } };
    const strike = legalCommandsForState(scenario, "red").strikes.find(
      (s) => s.spaceId === "shell-tile10"
    );
    expect(strike).toMatchObject({ type: "shell", linkedAreaId: "tile10", dice: 2 });
    // Exact: only the enemy sea is offered; friendly/empty neighbour seas are filtered out.
    expect(strike!.targets).toEqual(["tile11"]);
  });

  it("gives the non-active seat no strikes, placements, or plans", () => {
    const other = state.activeSeat === "red" ? "black" : "red";
    const summary = legalCommandsForState(state, other);
    expect(summary.strikes).toEqual([]);
    expect(summary.placements).toEqual([]);
    expect(summary.plans).toEqual([]);
  });
});
