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

  it("discards a held card to reroll, staying paused; rejects without the card", () => {
    const paused = advanceIntoEnemy();
    paused.players.black.hand = ["ambush", "mobilise"]; // give the defender cards to spend
    const pendingId = paused.pendingCombat!.id;

    // Must roll before rerolling.
    const early = resolveCommand(
      paused,
      { seat: "black" },
      {
        type: "combatReroll",
        pendingId,
        card: "ambush"
      }
    );
    expect(early.status).toBe("rejected");

    const rolled = resolveCommand(paused, { seat: "black" }, { type: "combatRoll", pendingId });
    if (rolled.status !== "accepted") throw new Error("roll rejected");
    expect(playerView(rolled.nextState, "black").legal.canRerollCombat).toBe(true);

    // Reroll with a held card: card moves to discard, dice re-thrown, still in review.
    const reroll = resolveCommand(
      rolled.nextState,
      { seat: "black" },
      {
        type: "combatReroll",
        pendingId,
        card: "ambush"
      }
    );
    expect(reroll.status).toBe("accepted");
    if (reroll.status !== "accepted") return;
    expect(reroll.nextState.pendingCombat!.phase).toBe("rolled");
    expect(reroll.nextState.players.black.hand).toEqual(["mobilise"]);
    expect(reroll.nextState.discard).toEqual(["ambush"]);
    expect(reroll.nextState.areas["tile1"]!.owner).toBe("black"); // no casualties yet

    // Cannot reroll a card you do not hold.
    const notHeld = resolveCommand(
      reroll.nextState,
      { seat: "black" },
      {
        type: "combatReroll",
        pendingId,
        card: "ambush"
      }
    );
    expect(notHeld.status).toBe("rejected");
  });

  it("canRerollCombat is false with an empty hand", () => {
    const paused = advanceIntoEnemy(); // defender starts with no cards
    const rolled = resolveCommand(
      paused,
      { seat: "black" },
      {
        type: "combatRoll",
        pendingId: paused.pendingCombat!.id
      }
    );
    if (rolled.status !== "accepted") throw new Error("roll rejected");
    expect(playerView(rolled.nextState, "black").legal.canRerollCombat).toBe(false);
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

  describe("ambush", () => {
    it("adds two defence dice; the defence removal is their sum", () => {
      const paused = advanceIntoEnemy(); // 3 attackers vs 1 defender, all-1s dice
      paused.players.black.hand = ["ambush"];
      const pendingId = paused.pendingCombat!.id;
      const rolled = resolveCommand(
        paused,
        { seat: "black" },
        {
          type: "combatRoll",
          pendingId,
          card: "ambush"
        }
      );
      expect(rolled.status).toBe("accepted");
      if (rolled.status !== "accepted") return;
      expect(rolled.nextState.pendingCombat!.rolls!.length).toBe(3);
      expect(rolled.nextState.pendingCombat!.total).toBe(3);
      expect(rolled.nextState.players.black.hand).toEqual([]);
      expect(rolled.nextState.discard).toEqual(["ambush"]);
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
      // 3 attackers - 3 (defence sum) = 0 -> defender holds with 1.
      expect(resolved.nextState.areas["tile1"]!.owner).toBe("black");
      expect(resolved.nextState.areas["tile1"]!.units.troop).toBe(1);
    });

    it("is rejected when not held", () => {
      const paused = advanceIntoEnemy(); // defender holds no cards
      const r = resolveCommand(
        paused,
        { seat: "black" },
        {
          type: "combatRoll",
          pendingId: paused.pendingCombat!.id,
          card: "ambush"
        }
      );
      expect(r.status).toBe("rejected");
    });

    it("is rejected on a naval (sail) conflict — land conflicts only", () => {
      const s = game();
      s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 2, siege: 0 } };
      s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: 1, siege: 0 } };
      const sail = resolveCommand(
        s,
        { seat: "red" },
        {
          type: "sail",
          spaceId: "sail-tile11",
          moves: [{ from: "tile15", count: 1 }]
        }
      );
      if (sail.status !== "accepted") throw new Error("sail rejected");
      const paused = sail.nextState;
      paused.players.black.hand = ["ambush"];
      const r = resolveCommand(
        paused,
        { seat: "black" },
        {
          type: "combatRoll",
          pendingId: paused.pendingCombat!.id,
          card: "ambush"
        }
      );
      expect(r.status).toBe("rejected");
    });

    it("canAmbush reflects holding ambush on an advance defence roll", () => {
      const paused = advanceIntoEnemy();
      expect(playerView(paused, "black").legal.canAmbush).toBe(false);
      paused.players.black.hand = ["ambush"];
      expect(playerView(paused, "black").legal.canAmbush).toBe(true);
      // The attacker never sees an ambush option.
      expect(playerView(paused, "red").legal.canAmbush).toBe(false);
    });
  });

  describe("ship_strike", () => {
    /** Red shells black ships in tile11 from supplied land tile10, holding ship_strike. */
    function shellHoldingShipStrike(targetShips: number) {
      const s = game();
      s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
      s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: targetShips, siege: 0 } };
      s.players.red.hand = ["ship_strike"];
      const r = resolveCommand(
        s,
        { seat: "red" },
        {
          type: "shell",
          spaceId: "shell-tile10",
          targetAreaId: "tile11"
        }
      );
      if (r.status !== "accepted") throw new Error("shell rejected");
      return r.nextState;
    }

    /** Roll then resolve the pending combat for the given seat. */
    function rollResolve(state: GameState, seat: "red" | "black") {
      const id = state.pendingCombat!.id;
      const rolled = resolveCommand(state, { seat }, { type: "combatRoll", pendingId: id });
      if (rolled.status !== "accepted") throw new Error("roll rejected");
      const resolved = resolveCommand(
        rolled.nextState,
        { seat },
        {
          type: "combatResolve",
          pendingId: id
        }
      );
      if (resolved.status !== "accepted") throw new Error("resolve rejected");
      return resolved.nextState;
    }

    it("offers a second shell after the first resolves; taking it stages another", () => {
      const afterFirst = rollResolve(shellHoldingShipStrike(4), "red");
      expect(afterFirst.pendingCombat).toBeNull();
      expect(afterFirst.areas["tile11"]!.units.ship).toBe(2); // 4 - 2
      expect(afterFirst.pendingDecision).not.toBeNull();
      expect(afterFirst.pendingDecision!.kind).toBe("shipStrike");
      expect(afterFirst.activeSeat).toBe("red"); // turn not advanced while deciding

      const again = resolveCommand(
        afterFirst,
        { seat: "red" },
        {
          type: "choosePendingDecision",
          pendingId: afterFirst.pendingDecision!.id,
          choice: { id: "tile11", label: "Shell tile11" } // re-fire the same sea (still holds ships)
        }
      );
      expect(again.status).toBe("accepted");
      if (again.status !== "accepted") return;
      expect(again.nextState.pendingDecision).toBeNull();
      expect(again.nextState.pendingCombat!.kind).toBe("shell"); // second shell staged
      expect(again.nextState.players.red.hand).toEqual([]); // card spent
      expect(again.nextState.discard).toContain("ship_strike");

      const done = rollResolve(again.nextState, "red");
      expect(done.pendingCombat).toBeNull();
      expect(done.pendingDecision).toBeNull(); // no further offer — card spent
      expect(done.areas["tile11"]?.units.ship ?? 0).toBe(0); // 2 - 2
      expect(done.activeSeat).toBe("black"); // turn finally advances
    });

    it("declining advances the turn and keeps the card", () => {
      const afterFirst = rollResolve(shellHoldingShipStrike(4), "red");
      const declined = resolveCommand(
        afterFirst,
        { seat: "red" },
        {
          type: "choosePendingDecision",
          pendingId: afterFirst.pendingDecision!.id,
          choice: { id: "decline", label: "Decline" }
        }
      );
      expect(declined.status).toBe("accepted");
      if (declined.status !== "accepted") return;
      expect(declined.nextState.pendingDecision).toBeNull();
      expect(declined.nextState.pendingCombat).toBeNull();
      expect(declined.nextState.players.red.hand).toEqual(["ship_strike"]); // not spent
      expect(declined.nextState.activeSeat).toBe("black");
    });

    it("makes no offer without the card", () => {
      const s = game();
      s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
      s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: 4, siege: 0 } };
      const r = resolveCommand(
        s,
        { seat: "red" },
        {
          type: "shell",
          spaceId: "shell-tile10",
          targetAreaId: "tile11"
        }
      );
      if (r.status !== "accepted") throw new Error("shell rejected");
      const afterFirst = rollResolve(r.nextState, "red");
      expect(afterFirst.pendingDecision).toBeNull();
      expect(afterFirst.activeSeat).toBe("black");
    });

    it("makes no offer if no adjacent sea still holds enemy ships", () => {
      const afterFirst = rollResolve(shellHoldingShipStrike(2), "red"); // 2 - 2 = 0
      expect(afterFirst.areas["tile11"]?.units.ship ?? 0).toBe(0);
      expect(afterFirst.pendingDecision).toBeNull();
    });

    it("offers a second shell at another adjacent sea once the first target is cleared", () => {
      const s = game();
      s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
      s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: 2, siege: 0 } }; // cleared (2-2)
      s.areas["tile7"] = { owner: "black", units: { troop: 0, ship: 3, siege: 0 } }; // still holds ships
      s.players.red.hand = ["ship_strike"];
      const r = resolveCommand(
        s,
        { seat: "red" },
        { type: "shell", spaceId: "shell-tile10", targetAreaId: "tile11" }
      );
      if (r.status !== "accepted") throw new Error("shell rejected");

      const afterFirst = rollResolve(r.nextState, "red");
      expect(afterFirst.areas["tile11"]?.units.ship ?? 0).toBe(0); // original target cleared
      expect(afterFirst.pendingDecision).not.toBeNull();
      expect(afterFirst.pendingDecision!.kind).toBe("shipStrike");
      // The offer lets the attacker pick a different adjacent enemy sea (each choice id is the sea).
      const choiceIds = afterFirst.pendingDecision!.choices.map((c) => c.id);
      expect(choiceIds).toContain("tile7");
      expect(choiceIds).toContain("decline");

      const again = resolveCommand(
        afterFirst,
        { seat: "red" },
        {
          type: "choosePendingDecision",
          pendingId: afterFirst.pendingDecision!.id,
          choice: { id: "tile7", label: "Shell tile7" }
        }
      );
      expect(again.status).toBe("accepted");
      if (again.status !== "accepted") return;
      expect(again.nextState.pendingDecision).toBeNull();
      expect(again.nextState.pendingCombat!.kind).toBe("shell");
      expect(again.nextState.pendingCombat!.area).toBe("tile7"); // second shell targets the chosen sea
      expect(again.nextState.players.red.hand).toEqual([]); // card spent
      expect(again.nextState.discard).toContain("ship_strike");
    });
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
