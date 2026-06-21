import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { resolveCommand } from "../src/resolve.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

function game() {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  // Neutralise bonuses so they don't perturb base arithmetic in these tests.
  s.bonuses = {};
  return s;
}

describe("reinforce", () => {
  it("places troops from reserve into a supplied land area", () => {
    const s = game();
    const hq = hqOf("red");
    const before = s.players.red.reserve.troop;
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "reinforce",
        spaceId: "reinforce-b", // N=5
        placements: [{ area: hq, count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas[hq]!.units.troop).toBe(5); // 3 + 2
    expect(r.nextState.players.red.reserve.troop).toBe(before - 2);
    expect(r.nextState.actionSpaces["reinforce-b"]).toBe("red");
  });

  it("Barracks grants +2 to the reinforce limit", () => {
    const s = game();
    const hq = hqOf("red");
    s.bonuses = { [hq]: "barracks" };
    s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "reinforce",
        spaceId: "reinforce-b", // N=5, +2 barracks = 7
        placements: [
          { area: hq, count: 2 },
          { area: "tile10", count: 4 }
        ] // total 6 <= 7
      }
    );
    expect(r.status).toBe("accepted");
  });
});

describe("plan", () => {
  it("a Plan space without the initiative symbol just spends a commander", () => {
    const s = game();
    const before = s.initiative;
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.initiative).toBe(before);
    expect(r.nextState.actionSpaces["plan-b"]).toBe("red");
  });

  it("the initiative Plan space seizes next-round initiative", () => {
    const s2 = game();
    s2.initiative = "black";
    s2.activeSeat = "red";
    const r2 = resolveCommand(s2, { seat: "red" }, { type: "plan", spaceId: "plan-a" });
    expect(r2.status).toBe("accepted");
    if (r2.status !== "accepted") return;
    expect(r2.nextState.initiative).toBe("red");
  });
});

describe("embark", () => {
  it("places ships from reserve into a supplied water area", () => {
    const s = game();
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    const before = s.players.red.reserve.ship;
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "embark",
        spaceId: "embark-a", // N=3
        placements: [{ area: "tile15", count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile15"]!.units.ship).toBe(3); // 1 + 2, cap 3
    expect(r.nextState.players.red.reserve.ship).toBe(before - 2);
  });

  it("can place into an empty water adjacent to a supplied port", () => {
    const s = game();
    // Red supplies its HQ harbor tile9 (ports include tile14/tile15). tile14 holds the
    // starting navy, so embark into the still-empty tile15.
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "embark",
        spaceId: "embark-b", // N=2
        placements: [{ area: "tile15", count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile15"]!.owner).toBe("red");
    expect(r.nextState.areas["tile15"]!.units.ship).toBe(2);
  });
});

describe("advance", () => {
  it("moves troops into an empty adjacent land and takes control", () => {
    const s = game();
    const hq = hqOf("red"); // tile9, 3 troops; tile1 empty land adjacent.
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile1"]!.owner).toBe("red");
    expect(r.nextState.areas["tile1"]!.units.troop).toBe(2);
    expect(r.nextState.areas[hq]!.units.troop).toBe(1); // 3 - 2
  });

  it("resolves conflict when advancing into an enemy land", () => {
    const s = game();
    const hq = hqOf("red");
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] }; // defence roll = 1
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
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // defence removes 1 -> 2 attackers vs 1 defender; attrition -> 1 vs 0. red wins.
    expect(r.nextState.areas["tile1"]!.owner).toBe("red");
    expect(r.nextState.areas["tile1"]!.units.troop).toBe(1);
  });

  it("Hidden Base adds +1 troop at move-in before conflict", () => {
    const s = game();
    const hq = hqOf("red");
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.bonuses = { [hq]: "hiddenBase" }; // red supplies its HQ -> bonus active
    s.areas["tile1"] = { owner: "black", units: { troop: 2, ship: 0, siege: 0 } };
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }] // 2 + 1 hidden base = 3 attackers
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 3 attackers, defence -1 -> 2 vs 2 defenders -> tie -> area emptied.
    expect(r.nextState.areas["tile1"]!.owner).toBeNull();
  });
});

describe("sail", () => {
  it("moves ships through a supplied water chain into an empty water", () => {
    const s = game();
    // red supplies HQ tile9 (land) -> tile15 (sea, 2 ships). Sail into tile11 (adj tile15).
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 2, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "sail",
        spaceId: "sail-tile11",
        moves: [{ from: "tile15", count: 1 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile11"]!.owner).toBe("red");
    expect(r.nextState.areas["tile11"]!.units.ship).toBe(1);
    expect(r.nextState.areas["tile15"]!.units.ship).toBe(1);
  });

  it("Shipyard adds +1 ship at move-in before conflict", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 3, siege: 0 } };
    s.bonuses = { tile15: "shipyard" }; // red supplies tile15
    s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: 2, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "sail",
        spaceId: "sail-tile11",
        moves: [{ from: "tile15", count: 2 }] // 2 + 1 shipyard = 3 attackers
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 3 attackers, defence -1 -> 2 vs 2 -> tie -> emptied.
    expect(r.nextState.areas["tile11"]!.owner).toBeNull();
  });
});

describe("bombard", () => {
  it("rolls one die per ship and removes that many enemy land units", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] }; // each die = 1
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 2, siege: 0 } };
    s.areas["tile16"] = { owner: "black", units: { troop: 3, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "bombard",
        spaceId: "bombard-tile15",
        targetAreaId: "tile16"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 2 ships -> 2 dice -> 2 pips -> remove 2 troops; 1 remains.
    expect(r.nextState.areas["tile16"]!.units.troop).toBe(1);
    expect(r.nextState.players.black.reserve.troop).toBeGreaterThan(0);
  });

  it("Pirate Haven adds +1 die", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    s.bonuses = { tile15: "pirateHaven" }; // red supplies tile15
    s.areas["tile16"] = { owner: "black", units: { troop: 3, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "bombard",
        spaceId: "bombard-tile15",
        targetAreaId: "tile16"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 1 ship + 1 pirate haven = 2 dice -> remove 2; 1 remains.
    expect(r.nextState.areas["tile16"]!.units.troop).toBe(1);
  });
});

describe("shell", () => {
  it("rolls two dice and removes that many enemy ships from the target water", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] }; // each die = 1 -> total 2
    // red supplies shellable land tile10 (HQ tile9 is adjacent to tile10).
    s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    // black ships sit in adjacent sea tile11.
    s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: 3, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "shell",
        spaceId: "shell-tile10",
        targetAreaId: "tile11"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // two dice of 1 -> remove 2 ships; 1 remains.
    expect(r.nextState.areas["tile11"]!.units.ship).toBe(1);
    expect(r.nextState.players.black.reserve.ship).toBeGreaterThan(0);
  });
});
