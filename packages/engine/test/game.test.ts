import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { riversRuleset } from "../src/rules.js";
import { createRngState } from "../src/rng.js";

const opts = { gameId: "g1", seed: "seed-A" };

describe("createInitialState", () => {
  it("is deterministic for a given seed", () => {
    expect(createInitialState(opts)).toEqual(createInitialState(opts));
  });

  it("opens at round 1, deploy phase, active, activeSeat = initiative", () => {
    const s = createInitialState(opts);
    expect(s.schemaVersion).toBe(2);
    expect(s.gameId).toBe("g1");
    expect(s.mapId).toBe("rivers");
    expect(s.mode).toBe("hotseat");
    expect(s.round).toBe(1);
    expect(s.phase).toBe("deploy");
    expect(s.status).toBe("active");
    expect(["red", "black"]).toContain(s.initiative);
    expect(s.activeSeat).toBe(s.initiative);
    expect(s.actionSpaces).toEqual({});
    expect(s.winner).toBeNull();
    expect(s.endReason).toBeNull();
  });

  it("places 3 troops in each HQ and leaves every other area empty", () => {
    const s = createInitialState(opts);
    expect(s.areas.tile9).toEqual({ owner: "red", units: { troop: 3, ship: 0, siege: 0 } });
    expect(s.areas.tile13).toEqual({ owner: "black", units: { troop: 3, ship: 0, siege: 0 } });
    for (const [id, a] of Object.entries(s.areas)) {
      if (id === "tile9" || id === "tile13") continue;
      expect(a, id).toEqual({ owner: null, units: { troop: 0, ship: 0, siege: 0 } });
    }
    expect(Object.keys(s.areas).sort()).toEqual(Object.keys(riversMap.areas).sort());
  });

  it("gives each player the pool minus deployed troops, plus 5 commanders", () => {
    const s = createInitialState(opts);
    for (const seat of ["red", "black"] as const) {
      expect(s.players[seat].seat).toBe(seat);
      expect(s.players[seat].reserve).toEqual({ troop: 22, ship: 10, siege: 0 });
      expect(s.players[seat].commanders).toEqual({ total: 5, standby: 0 });
      expect(s.players[seat].hand).toEqual([]);
      expect(s.players[seat].passed).toBe(false);
    }
  });

  it("assigns 3 distinct bonuses to the map's bonus slots", () => {
    const s = createInitialState(opts);
    expect(Object.keys(s.bonuses).sort()).toEqual([...riversMap.bonusSlots].sort());
    const vals = Object.values(s.bonuses);
    expect(new Set(vals).size).toBe(3);
    for (const b of vals) expect(riversRuleset.bonusSet).toContain(b);
  });

  it("advances the rng state away from the raw seed", () => {
    const s = createInitialState(opts);
    expect(s.rngState).not.toBe(createRngState(opts.seed));
  });
});
