import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { riversRuleset } from "../src/rules.js";
import { createRngState } from "../src/rng.js";
import { HQ_STARTING_TROOPS, RIVERS_UNIT_POOL } from "../src/state.js";

const opts = { gameId: "g1", seed: "seed-A" };

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

describe("createInitialState", () => {
  it("is deterministic for a given seed", () => {
    expect(createInitialState(opts)).toEqual(createInitialState(opts));
  });

  it("produces a fixed output for a known seed (replay anchor)", () => {
    // Pins the RNG algorithm AND the draw order (bonuses -> initiative). A change
    // to either would shift these values and break replay of saved games.
    const s = createInitialState(opts);
    expect(s.initiative).toBe("red");
    expect(s.rngState).toBe("676040671");
    expect(s.bonuses).toEqual({ tile6: "pirateHaven", tile16: "hiddenBase", tile20: "warRoom" });
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

  it("garrisons each HQ with the starting troops and leaves every other area empty", () => {
    const s = createInitialState(opts);
    const redHq = hqOf("red");
    const blackHq = hqOf("black");
    const garrison = { troop: HQ_STARTING_TROOPS, ship: 0, siege: 0 };
    expect(s.areas[redHq]).toEqual({ owner: "red", units: garrison });
    expect(s.areas[blackHq]).toEqual({ owner: "black", units: garrison });
    for (const [id, a] of Object.entries(s.areas)) {
      if (id === redHq || id === blackHq) continue;
      expect(a, id).toEqual({ owner: null, units: { troop: 0, ship: 0, siege: 0 } });
    }
    expect(Object.keys(s.areas).sort()).toEqual(Object.keys(riversMap.areas).sort());
  });

  it("gives each player the pool minus deployed troops, plus 5 commanders", () => {
    const s = createInitialState(opts);
    for (const seat of ["red", "black"] as const) {
      expect(s.players[seat].seat).toBe(seat);
      expect(s.players[seat].reserve).toEqual({
        ...RIVERS_UNIT_POOL,
        troop: RIVERS_UNIT_POOL.troop - HQ_STARTING_TROOPS
      });
      expect(s.players[seat].commanders).toEqual({
        total: riversRuleset.commandersPerPlayer,
        standby: 0
      });
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

  it("throws when the ruleset offers fewer bonuses than the map has slots", () => {
    // Rivers has 3 slots; a ruleset with only 2 bonuses cannot fill them.
    const rules: typeof riversRuleset = { ...riversRuleset, bonusSet: ["barracks", "warRoom"] };
    expect(() => createInitialState({ ...opts, rules })).toThrow(/bonus slots/);
  });

  it("varies setup across seeds", () => {
    // Across a handful of seeds the seed must actually influence setup
    // (initiative and/or bonus assignment). Collapsing to one signature would
    // mean the seed is ignored.
    const signatures = new Set(
      Array.from({ length: 8 }, (_, i) =>
        createInitialState({ gameId: "g", seed: `seed-${i}` })
      ).map((s) => `${s.initiative}|${JSON.stringify(s.bonuses)}`)
    );
    expect(signatures.size).toBeGreaterThan(1);
  });
});
