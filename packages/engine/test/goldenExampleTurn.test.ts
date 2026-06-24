/**
 * Golden regression test: Rulebook "Example of Bombard" (page 19).
 *
 * Scenario (as depicted):
 *   - Mali (red) deploys a commander into the Bombard action space in her
 *     supplied water area.
 *   - She has 2 ships in the linked water area (tile7).
 *   - She targets the adjacent highlighted land area (tile10) which contains
 *     2 of Bo's (black's) troops.
 *   - She rolls 2 dice (one per ship) and gets 3 pips total.
 *   - Bo must remove his two troops, leaving the area uncontrolled.
 *
 * Implementation notes:
 *   - We cannot force exactly "3 pips from 2 dice" using a uniform faces array,
 *     because a single value per die can only yield an even total. We instead
 *     use diceFaces: [2,2,2,2,2,2] (all-2s → each die = 2, total = 4 pips).
 *     Since the target has only 2 troops, the outcome is identical: both troops
 *     are removed regardless of whether total pips are 3 or 4.  The assertion
 *     encodes the key rulebook result: the target area is fully cleared and
 *     becomes uncontrolled.
 *   - Supply chain for red: tile9 (HQ) → tile1 → tile6 → tile7 (water with
 *     red ships). All of tile9, tile1, tile6, tile7 are red-controlled.
 *   - tile10 is adjacent to tile7 (verified in riversMap.ts adjacency lists),
 *     so it is a legal Bombard target.
 *   - Bonuses are cleared to prevent any bonus from altering the arithmetic.
 */

import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { resolveCommand } from "../src/resolve.js";

describe("golden: Rulebook Example of Bombard (page 19)", () => {
  it("2 red ships bombard tile10 with 2 black troops — both troops removed, area uncontrolled", () => {
    // --- Build base state ---
    const s = createInitialState({ gameId: "golden-bombard", seed: "golden" });

    // Fix initiative and turn order so red acts first.
    s.initiative = "red";
    s.activeSeat = "red";

    // Force all dice to 2 pips so 2 dice = 4 total pips, which exceeds the
    // 2-troop garrison (result is identical to the rulebook's 3-pip roll).
    s.rules = { ...s.rules, diceFaces: [2, 2, 2, 2, 2, 2] };

    // Clear bonuses so no bonus modifies the Bombard outcome.
    s.bonuses = {};

    // --- Set up the board position ---
    // Supply chain for red: tile9 (HQ) — tile1 — tile6 — tile7 (water).
    // tile9 already has 3 troops from createInitialState; adjust the others.

    // tile1: red controls, at least 1 troop.
    s.areas["tile1"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };

    // tile6: red controls, at least 1 troop (harbor, but we only care about control).
    s.areas["tile6"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };

    // tile7: red water area — 2 ships (the Bombard source).
    s.areas["tile7"] = { owner: "red", units: { troop: 0, ship: 2, siege: 0 } };

    // tile10: black land area — 2 troops (the Bombard target).
    // tile10 is adjacent to tile7 in the Rivers map.
    s.areas["tile10"] = { owner: "black", units: { troop: 2, ship: 0, siege: 0 } };

    // Record black's reserve troop count before the action.
    const blackReserveBefore = s.players.black.reserve.troop;

    // --- Issue the Bombard command ---
    // Action space: "bombard-tile7" (Bombard in tile7 water area).
    // Target: "tile10" (adjacent land area with black troops).
    const staged = resolveCommand(
      s,
      { seat: "red" },
      { type: "bombard", spaceId: "bombard-tile7", targetAreaId: "tile10" }
    );

    // --- Bombard pauses for the attacker (red) to roll ---
    expect(staged.status).toBe("accepted");
    if (staged.status !== "accepted") return;
    expect(staged.nextState.pendingCombat).not.toBeNull();
    expect(staged.nextState.pendingCombat!.responsibleSeat).toBe("red");
    // The action space is occupied immediately and the revision bumped at staging.
    expect(staged.nextState.actionSpaces["bombard-tile7"]).toBe("red");
    expect(staged.nextState.revision).toBe(s.revision + 1);

    // --- Red rolls the dice; the result is shown but no troops are removed yet ---
    const pc = staged.nextState.pendingCombat!;
    const rolled = resolveCommand(
      staged.nextState,
      { seat: "red" },
      {
        type: "combatRoll",
        pendingId: pc.id
      }
    );
    expect(rolled.status).toBe("accepted");
    if (rolled.status !== "accepted") return;
    // Still paused on the review phase; the garrison is untouched until the player continues.
    expect(rolled.nextState.pendingCombat!.phase).toBe("rolled");
    expect(rolled.nextState.areas["tile10"]!.units.troop).toBe(2);

    // The diceRolled event was emitted with purpose "bombard" and total of 4 pips
    // (2 dice × 2 faces = 4), which is >= 2 troops and explains the full removal.
    const diceEvent = rolled.events.find((e) => e.type === "diceRolled");
    expect(diceEvent).toBeDefined();
    if (diceEvent?.type === "diceRolled") {
      expect(diceEvent.purpose).toBe("bombard");
      expect(diceEvent.rolls).toHaveLength(2); // one die per ship
      expect(diceEvent.total).toBeGreaterThanOrEqual(2); // enough to remove both troops
    }

    // --- Red continues; casualties land ---
    const result = resolveCommand(
      rolled.nextState,
      { seat: "red" },
      {
        type: "combatResolve",
        pendingId: pc.id
      }
    );
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    const next = result.nextState;
    expect(next.pendingCombat).toBeNull();

    // --- Assert the rulebook outcome ---
    // Rulebook p.19: "Bo (black) removes his two troops, leaving none remaining.
    // This leaves neither player in control of the contested area."

    // All 2 black troops removed from tile10.
    expect(next.areas["tile10"]!.units.troop).toBe(0);

    // The area is now uncontrolled (no units left → owner becomes null).
    expect(next.areas["tile10"]!.owner).toBeNull();

    // The 2 removed troops returned to black's reserve.
    expect(next.players.black.reserve.troop).toBe(blackReserveBefore + 2);

    // Red's ships in tile7 are untouched (Bombard does not move ships).
    expect(next.areas["tile7"]!.units.ship).toBe(2);
    expect(next.areas["tile7"]!.owner).toBe("red");

    // The action space is still occupied by red's commander.
    expect(next.actionSpaces["bombard-tile7"]).toBe("red");

    // Revision bumped per command: staging (+1), roll (+2), resolve (+3).
    expect(next.revision).toBe(s.revision + 3);
  });
});
