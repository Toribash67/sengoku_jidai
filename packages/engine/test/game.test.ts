import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { RIVERS_CARDS } from "../src/cards.js";
import { riversMap } from "../src/maps/riversMap.js";
import { riversRuleset } from "../src/rules.js";
import { createRngState } from "../src/rng.js";
import { RIVERS_UNIT_POOL } from "../src/state.js";
import type { SeatId } from "../src/types.js";

const opts = { gameId: "g1", seed: "seed-A" };

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

// The Rivers starting deployment: Black mirrors Red across the board's 180° symmetry.
// 2+3+2+3 = 10 troops and 3 ships per side.
const STARTING_DEPLOYMENT: Record<string, { owner: SeatId; troop?: number; ship?: number }> = {
  tile1: { owner: "red", troop: 2 },
  tile9: { owner: "red", troop: 3 },
  tile10: { owner: "red", troop: 2 },
  tile14: { owner: "red", ship: 3 },
  tile19: { owner: "red", troop: 3 },
  tile5: { owner: "black", troop: 2 },
  tile13: { owner: "black", troop: 3 },
  tile12: { owner: "black", troop: 2 },
  tile18: { owner: "black", ship: 3 },
  tile21: { owner: "black", troop: 3 }
};

describe("createInitialState", () => {
  it("is deterministic for a given seed", () => {
    expect(createInitialState(opts)).toEqual(createInitialState(opts));
  });

  it("produces a fixed output for a known seed (replay anchor)", () => {
    // Pins the RNG algorithm AND the draw order (bonuses -> initiative -> deck shuffles).
    // A change to any would shift these values and break replay of saved games. The deck
    // shuffles are appended last, so bonuses + initiative are unchanged from before cards.
    const s = createInitialState(opts);
    expect(s.initiative).toBe("red");
    expect(s.rngState).toBe("548158277");
    expect(s.bonuses).toEqual({ tile2: "pirateHaven", tile4: "hiddenBase", tile20: "warRoom" });
  });

  it("deals each player a full, empty-handed operation-card deck", () => {
    const s = createInitialState(opts);
    for (const seat of ["red", "black"] as const) {
      expect(s.players[seat].hand).toEqual([]);
      expect(s.players[seat].discard).toEqual([]);
      expect(s.players[seat].deck).toHaveLength(8);
      expect([...s.players[seat].deck].sort()).toEqual([...RIVERS_CARDS].sort());
    }
    // Independently shuffled: the two decks are not in the same order (for this seed).
    expect(s.players.red.deck).not.toEqual(s.players.black.deck);
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
    expect(Object.keys(s.actionSpaces).length).toBeGreaterThan(0);
    expect(Object.values(s.actionSpaces).every((v) => v === null)).toBe(true);
    expect(s.winner).toBeNull();
    expect(s.endReason).toBeNull();
  });

  it("deploys each side's starting units (Black mirrors Red), leaves the rest empty", () => {
    const s = createInitialState(opts);
    // The red and black HQs are the deployment's 3-troop tiles.
    expect(hqOf("red")).toBe("tile9");
    expect(hqOf("black")).toBe("tile13");
    for (const [id, e] of Object.entries(STARTING_DEPLOYMENT)) {
      expect(s.areas[id], id).toEqual({
        owner: e.owner,
        units: { troop: e.troop ?? 0, ship: e.ship ?? 0, siege: 0 }
      });
    }
    const occupied = new Set(Object.keys(STARTING_DEPLOYMENT));
    for (const [id, a] of Object.entries(s.areas)) {
      if (occupied.has(id)) continue;
      expect(a, id).toEqual({ owner: null, units: { troop: 0, ship: 0, siege: 0 } });
    }
    expect(Object.keys(s.areas).sort()).toEqual(Object.keys(riversMap.areas).sort());
  });

  it("gives each player the pool minus deployed troops and ships, plus 5 commanders", () => {
    const s = createInitialState(opts);
    for (const seat of ["red", "black"] as const) {
      expect(s.players[seat].seat).toBe(seat);
      expect(s.players[seat].reserve).toEqual({
        ...RIVERS_UNIT_POOL,
        troop: RIVERS_UNIT_POOL.troop - 10, // 2 + 3 + 2 + 3 deployed troops
        ship: RIVERS_UNIT_POOL.ship - 3
      });
      expect(s.players[seat].commanders).toEqual({
        total: riversRuleset.commandersPerPlayer,
        standby: 0,
        counterattacks: 0
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

  it("opens with revision 0 and no pending decision", () => {
    const s = createInitialState(opts);
    expect(s.revision).toBe(0);
    expect(s.pendingDecision).toBeNull();
  });
});
