import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand, type GameState } from "@sengoku-jidai/engine";
import { settle } from "../src/bots/alphabeta.js";

/** Advance red's 3 troops into black's 1-troop tile1, leaving a paused defence for black to roll.
 *  diceFaces [0..5] have mean 2.5, so the defence *expectation* is round(2.5) = 3 pips — enough to
 *  wipe all three attackers, so by expectation black holds. A real seeded roll varies (0..5), so a
 *  search that peeked at the seed would resolve this differently from seed to seed. */
function advanceIntoEnemy(seed: string): GameState {
  const s = createInitialState({ gameId: "g", seed });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  s.rules = { ...s.rules, diceFaces: [0, 1, 2, 3, 4, 5] };
  s.areas["tile1"] = { owner: "black", units: { troop: 1, ship: 0, siege: 0 } };
  s.areas["tile9"] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
  const r = resolveCommand(
    s,
    { seat: "red" },
    { type: "advance", spaceId: "advance-tile1", moves: [{ from: "tile9", count: 3 }] }
  );
  if (r.status !== "accepted") throw new Error("advance rejected");
  return r.nextState;
}

describe("search combat resolution ignores the rng seed (no peeking)", () => {
  it("resolves a pending defence by expectation, identically across seeds", () => {
    const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const tile1 = seeds.map((seed) => settle(advanceIntoEnemy(seed)).areas["tile1"]);

    // Every seed yields the same board: the search used the dice expectation, not the seeded roll.
    for (const o of tile1) expect(o).toEqual(tile1[0]);
    // And that shared outcome is the expectation — a defence total of 3 wipes the 3 attackers,
    // so black holds its garrison rather than losing the tile to a lucky-for-red roll.
    expect(tile1[0]!.owner).toBe("black");
  });
});
