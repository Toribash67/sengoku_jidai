import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import type { GameState } from "../src/state.js";
import { resolveCommand } from "../src/resolve.js";
import { playerView } from "../src/view.js";

/** Red-to-act base state with bonuses cleared and a fixed (all-1s) defence die. */
function game(): GameState {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
  return s;
}

/** Advance red into an enemy-held tile1, leaving a paused combat. */
function advanceIntoEnemy() {
  const s = game();
  const hq = "tile9";
  s.areas["tile1"] = { owner: "black", units: { troop: 1, ship: 0, siege: 0 } };
  s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
  const r = resolveCommand(
    s,
    { seat: "red" },
    {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: hq, count: 3 }]
    }
  );
  if (r.status !== "accepted") throw new Error("advance rejected");
  return r.nextState;
}

describe("pending combat lifecycle", () => {
  it("advance into an enemy area pauses for the defender and does not advance the turn", () => {
    const paused = advanceIntoEnemy();
    expect(paused.pendingCombat).not.toBeNull();
    expect(paused.pendingCombat!.kind).toBe("advance");
    expect(paused.pendingCombat!.responsibleSeat).toBe("black");
    expect(paused.pendingCombat!.phase).toBe("awaiting-roll");
    expect(paused.activeSeat).toBe("red"); // turn has NOT advanced yet
    // The defender's garrison is still on the board; attackers are held off-board.
    expect(paused.areas["tile1"]!.owner).toBe("black");
  });

  it("only the responsible seat may roll; others are rejected", () => {
    const paused = advanceIntoEnemy();
    const pendingId = paused.pendingCombat!.id;

    // The attacker cannot roll the defender's die.
    const wrongSeat = resolveCommand(paused, { seat: "red" }, { type: "combatRoll", pendingId });
    expect(wrongSeat.status).toBe("rejected");

    // Deploying anything else while pending is rejected too.
    const deploy = resolveCommand(
      paused,
      { seat: "black" },
      {
        type: "advance",
        spaceId: "advance-tile2",
        moves: [{ from: "tile1", count: 1 }]
      }
    );
    expect(deploy.status).toBe("rejected");

    // A bad pendingId is rejected.
    const badId = resolveCommand(
      paused,
      { seat: "black" },
      {
        type: "combatRoll",
        pendingId: "nope"
      }
    );
    expect(badId.status).toBe("rejected");
  });

  it("the roll shows the result without removing units; continue applies it and advances the turn", () => {
    const paused = advanceIntoEnemy();
    const pendingId = paused.pendingCombat!.id;

    // Roll: dice are recorded and shown, but the board is untouched and still paused.
    const rolled = resolveCommand(paused, { seat: "black" }, { type: "combatRoll", pendingId });
    expect(rolled.status).toBe("accepted");
    if (rolled.status !== "accepted") return;
    expect(rolled.nextState.pendingCombat!.phase).toBe("rolled");
    expect(rolled.nextState.pendingCombat!.rolls).toEqual([1]);
    expect(rolled.nextState.areas["tile1"]!.owner).toBe("black"); // no casualties yet
    expect(rolled.nextState.activeSeat).toBe("red"); // turn still not advanced

    // You cannot roll twice; you must continue (resolve).
    const reroll = resolveCommand(
      rolled.nextState,
      { seat: "black" },
      {
        type: "combatRoll",
        pendingId
      }
    );
    expect(reroll.status).toBe("rejected");

    // Continue: casualties land and the turn advances.
    const resolved = resolveCommand(
      rolled.nextState,
      { seat: "black" },
      {
        type: "combatResolve",
        pendingId
      }
    );
    expect(resolved.status).toBe("accepted");
    if (resolved.status !== "accepted") return;
    expect(resolved.nextState.pendingCombat).toBeNull();
    // defence removes 1 -> 2 attackers vs 1 defender -> attrition -> red holds with 1.
    expect(resolved.nextState.areas["tile1"]!.owner).toBe("red");
    expect(resolved.nextState.areas["tile1"]!.units.troop).toBe(1);
    expect(resolved.nextState.activeSeat).toBe("black"); // turn advanced after resolution
  });

  it("cannot continue (resolve) before rolling", () => {
    const paused = advanceIntoEnemy();
    const pendingId = paused.pendingCombat!.id;
    const early = resolveCommand(paused, { seat: "black" }, { type: "combatResolve", pendingId });
    expect(early.status).toBe("rejected");
  });

  it("combatRoll with no pending combat is rejected", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "combatRoll", pendingId: "x" });
    expect(r.status).toBe("rejected");
  });

  it("exposes the pending combat to both seats; only the responsible seat can roll/continue", () => {
    const paused = advanceIntoEnemy();
    const defenderView = playerView(paused, "black");
    const attackerView = playerView(paused, "red");
    expect(defenderView.pendingCombat).not.toBeNull();
    expect(attackerView.pendingCombat).not.toBeNull();
    expect(defenderView.legal.canRollCombat).toBe(true);
    expect(defenderView.legal.canResolveCombat).toBe(false); // not rolled yet
    expect(attackerView.legal.canRollCombat).toBe(false);
    // Deploys are blocked for both while pending.
    expect(defenderView.legal.canPass).toBe(false);
    expect(attackerView.legal.canPass).toBe(false);

    // After rolling, the defender may continue (not roll again).
    const rolled = resolveCommand(
      paused,
      { seat: "black" },
      {
        type: "combatRoll",
        pendingId: paused.pendingCombat!.id
      }
    );
    if (rolled.status !== "accepted") throw new Error("roll rejected");
    const afterRoll = playerView(rolled.nextState, "black");
    expect(afterRoll.legal.canRollCombat).toBe(false);
    expect(afterRoll.legal.canResolveCombat).toBe(true);
  });
});
