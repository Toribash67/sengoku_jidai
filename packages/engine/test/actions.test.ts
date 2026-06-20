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
    const r = resolveCommand(s, { seat: "red" }, {
      type: "reinforce",
      spaceId: "reinforce-b", // N=5
      placements: [{ area: hq, count: 2 }]
    });
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
    const r = resolveCommand(s, { seat: "red" }, {
      type: "reinforce",
      spaceId: "reinforce-b", // N=5, +2 barracks = 7
      placements: [{ area: hq, count: 2 }, { area: "tile10", count: 4 }] // total 6 <= 7
    });
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
    const r = resolveCommand(s, { seat: "red" }, {
      type: "embark",
      spaceId: "embark-a", // N=3
      placements: [{ area: "tile15", count: 2 }]
    });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile15"]!.units.ship).toBe(3); // 1 + 2, cap 3
    expect(r.nextState.players.red.reserve.ship).toBe(before - 2);
  });

  it("can place into an empty water adjacent to a supplied port", () => {
    const s = game();
    // Red supplies its HQ harbor tile9 (ports include tile14/tile15). tile14 empty.
    const r = resolveCommand(s, { seat: "red" }, {
      type: "embark",
      spaceId: "embark-b", // N=2
      placements: [{ area: "tile14", count: 2 }]
    });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile14"]!.owner).toBe("red");
    expect(r.nextState.areas["tile14"]!.units.ship).toBe(2);
  });
});
