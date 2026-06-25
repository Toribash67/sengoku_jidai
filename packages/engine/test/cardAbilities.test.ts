import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import type { GameState, OperationCard } from "../src/state.js";
import { riversMap } from "../src/maps/riversMap.js";
import { resolveCommand } from "../src/resolve.js";
import { available } from "../src/legality.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

function game(hand: OperationCard[] = []) {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {}; // neutralise bonuses so they don't perturb the arithmetic
  s.players.red.hand = [...hand];
  return s;
}

/** Roll then resolve a paused combat (both by the responsible seat). */
function rollPending(state: GameState) {
  const pc = state.pendingCombat!;
  const rolled = resolveCommand(
    state,
    { seat: pc.responsibleSeat },
    { type: "combatRoll", pendingId: pc.id }
  );
  if (rolled.status !== "accepted") return rolled;
  return resolveCommand(
    rolled.nextState,
    { seat: pc.responsibleSeat },
    { type: "combatResolve", pendingId: pc.id }
  );
}

describe("mobilise (reinforce +2)", () => {
  it("raises the reinforce limit by 2 and discards the card", () => {
    const hq = hqOf("red");
    const s = game(["mobilise"]);
    // Two supplied red lands with room: HQ and adjacent tile10.
    s.areas[hq] = { owner: "red", units: { troop: 0, ship: 0, siege: 0 } };
    s.areas["tile10"] = { owner: "red", units: { troop: 0, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "reinforce",
        spaceId: "reinforce-b", // N=5; mobilise -> 7
        placements: [
          { area: hq, count: 3 },
          { area: "tile10", count: 4 }
        ],
        card: "mobilise"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas[hq]!.units.troop).toBe(3);
    expect(r.nextState.areas["tile10"]!.units.troop).toBe(4);
    expect(r.nextState.players.red.hand).toEqual([]);
    expect(r.nextState.players.red.discard).toContain("mobilise");
    expect(r.events.some((e) => e.type === "cardPlayed")).toBe(true);
  });

  it("the same placement is rejected without the card (over the base limit)", () => {
    const hq = hqOf("red");
    const s = game(); // no card in hand
    s.areas[hq] = { owner: "red", units: { troop: 0, ship: 0, siege: 0 } };
    s.areas["tile10"] = { owner: "red", units: { troop: 0, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "reinforce",
        spaceId: "reinforce-b",
        placements: [
          { area: hq, count: 3 },
          { area: "tile10", count: 4 }
        ]
      }
    );
    expect(r.status).toBe("rejected");
  });
});

describe("commandeer (embark +1, opponent water)", () => {
  it("raises the embark limit by 1", () => {
    const s = game(["commandeer"]);
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "embark",
        spaceId: "embark-a", // N=3; commandeer -> 4
        placements: [{ area: "tile15", count: 4 }],
        card: "commandeer"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.discard).toContain("commandeer");
  });

  it("may embark into opponent-controlled port water, staging combat", () => {
    const s = game(["commandeer"]);
    // tile15 is a port of red's HQ harbor; put a black ship there (opponent-controlled).
    s.areas["tile15"] = { owner: "black", units: { troop: 0, ship: 1, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "embark",
        spaceId: "embark-a",
        placements: [{ area: "tile15", count: 2 }],
        card: "commandeer"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // The contested placement stages a sail-style combat for the defender to roll.
    expect(r.nextState.pendingCombat).not.toBeNull();
    expect(r.nextState.pendingCombat!.responsibleSeat).toBe("black");
    expect(r.nextState.players.red.discard).toContain("commandeer");
  });
});

describe("ground_assault (advance +up to 2 troops)", () => {
  it("adds the bonus troops to the move-in from reserve", () => {
    const hq = hqOf("red");
    const s = game(["ground_assault"]);
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    const before = s.players.red.reserve.troop;
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "ground_assault",
        cardBonus: 2
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile1"]!.units.troop).toBe(4); // 2 moved + 2 bonus
    expect(r.nextState.players.red.reserve.troop).toBe(before - 2);
    expect(r.nextState.players.red.discard).toContain("ground_assault");
  });

  it("rejects a bonus over 2", () => {
    const hq = hqOf("red");
    const s = game(["ground_assault"]);
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "ground_assault",
        cardBonus: 3
      }
    );
    expect(r.status).toBe("rejected");
  });
});

describe("river_assault (sail +up to 2 ships)", () => {
  it("adds the bonus ships to the move-in from reserve", () => {
    const s = game(["river_assault"]);
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 2, siege: 0 } };
    const before = s.players.red.reserve.ship;
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "sail",
        spaceId: "sail-tile11",
        moves: [{ from: "tile15", count: 1 }],
        card: "river_assault",
        cardBonus: 2
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile11"]!.units.ship).toBe(3); // 1 moved + 2 bonus
    expect(r.nextState.players.red.reserve.ship).toBe(before - 2);
    expect(r.nextState.players.red.discard).toContain("river_assault");
  });
});

describe("shore_strike (bombard +2 dice)", () => {
  it("rolls two extra dice", () => {
    const s = game(["shore_strike"]);
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    s.areas["tile16"] = { owner: "black", units: { troop: 5, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "bombard",
        spaceId: "bombard-tile15",
        targetAreaId: "tile16",
        card: "shore_strike"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.pendingCombat!.dice).toBe(3); // 1 ship + 2 shore strike
    expect(r.nextState.players.red.discard).toContain("shore_strike");
    const r2 = rollPending(r.nextState);
    expect(r2.status).toBe("accepted");
    if (r2.status !== "accepted") return;
    expect(r2.nextState.areas["tile16"]!.units.troop).toBe(2); // 5 - 3
  });
});

describe("counterattack (advance onto an opponent-occupied Advance space)", () => {
  function setup() {
    const hq = hqOf("red");
    const s = game(["counterattack"]);
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    return { s, hq };
  }

  it("deploys onto the opponent's Advance space, spending a counter (not the space)", () => {
    const { s, hq } = setup();
    s.actionSpaces["advance-tile1"] = "black"; // opponent's commander is here
    const availBefore = available(s, "red");
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "counterattack"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.actionSpaces["advance-tile1"]).toBe("black"); // unchanged
    expect(r.nextState.players.red.commanders.counterattacks).toBe(1);
    expect(available(r.nextState, "red")).toBe(availBefore - 1);
    expect(r.nextState.players.red.discard).toContain("counterattack");
    expect(r.nextState.areas["tile1"]!.owner).toBe("red");
  });

  it("is rejected on an empty Advance space (no opponent commander)", () => {
    const { s, hq } = setup();
    s.actionSpaces["advance-tile1"] = null;
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "counterattack"
      }
    );
    expect(r.status).toBe("rejected");
  });

  it("is rejected on a space the seat already occupies", () => {
    const { s, hq } = setup();
    s.actionSpaces["advance-tile1"] = "red";
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "counterattack"
      }
    );
    expect(r.status).toBe("rejected");
  });

  it("resets the counterattack counter on recall", () => {
    const { s, hq } = setup();
    // Both seats down to their last commander; black's already on the space red counterattacks,
    // so once red spends its last (via the counter) both are out and the turn recalls.
    s.players.red.commanders = { total: 1, standby: 0, counterattacks: 0 };
    s.players.black.commanders = { total: 1, standby: 0, counterattacks: 0 };
    s.actionSpaces["advance-tile1"] = "black";
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "counterattack"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // red has now spent its only commander via the counter -> both seats out -> recall.
    expect(r.nextState.players.red.commanders.counterattacks).toBe(0);
    expect(r.nextState.round).toBe(2);
  });
});

describe("card-play validation", () => {
  it("rejects a card that is not in hand", () => {
    const hq = hqOf("red");
    const s = game(); // empty hand
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "ground_assault"
      }
    );
    expect(r.status).toBe("rejected");
    if (r.status !== "rejected") return;
    expect(r.reason.code).toBe("illegalChoice");
  });

  it("rejects a card played with the wrong action", () => {
    const hq = hqOf("red");
    const s = game(["mobilise"]); // mobilise is a reinforce card
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }],
        card: "mobilise"
      }
    );
    expect(r.status).toBe("rejected");
    if (r.status !== "rejected") return;
    expect(r.reason.code).toBe("illegalChoice");
  });
});
