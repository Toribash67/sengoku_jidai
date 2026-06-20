import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { gameBoard } from "../src/board.js";
import {
  unitKindFor,
  advanceSources,
  sailReachable,
  reinforceTargets,
  bombardTargets,
  shellTargets,
  available,
  occupiedCount
} from "../src/legality.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

function stateWith(
  units: Record<string, { owner: "red" | "black" | null; troop?: number; ship?: number }>
) {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  for (const [id, u] of Object.entries(units)) {
    s.areas[id] = {
      owner: u.owner,
      units: { troop: u.troop ?? 0, ship: u.ship ?? 0, siege: 0 }
    };
  }
  return s;
}

describe("legality predicates", () => {
  it("unitKindFor maps land->troop, sea->ship", () => {
    expect(unitKindFor(riversMap.areas["tile10"]!)).toBe("troop");
    expect(unitKindFor(riversMap.areas["tile3"]!)).toBe("ship");
  });

  it("advanceSources: supplied land adjacent to the target", () => {
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile10: { owner: "red", troop: 2 }
    });
    const sources = advanceSources(riversMap, gameBoard(s), "red", "tile1");
    expect(sources.has(hqOf("red"))).toBe(true); // tile9 adjacent to tile1
    expect(sources.has("tile10")).toBe(true); // tile10 adjacent to tile1
  });

  it("advanceSources: supplied land adjacent to a supplied water adjacent to target", () => {
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile15: { owner: "red", ship: 1 }
    });
    const sources = advanceSources(riversMap, gameBoard(s), "red", "tile16");
    // tile9 (HQ land) is supplied and adjacent to supplied water tile15 which is adjacent to tile16.
    expect(sources.has(hqOf("red"))).toBe(true);
  });

  it("sailReachable: supplied water chain to the target water", () => {
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile15: { owner: "red", ship: 2 },
      tile11: { owner: "red", ship: 2 }
    });
    const reach = sailReachable(riversMap, gameBoard(s), "red", "tile17");
    expect(reach.has("tile15")).toBe(true);
    expect(reach.has("tile11")).toBe(true);
  });

  it("reinforceTargets are exactly the supplied land areas", () => {
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile10: { owner: "red", troop: 1 }
    });
    const targets = reinforceTargets(riversMap, gameBoard(s), "red");
    expect(targets.has(hqOf("red"))).toBe(true);
    expect(targets.has("tile10")).toBe(true);
    expect(targets.has("tile3")).toBe(false); // sea
  });

  it("bombardTargets are land areas adjacent to the linked water", () => {
    expect(bombardTargets(riversMap, "tile3").sort()).toEqual(["tile2", "tile4", "tile6", "tile8"]);
  });

  it("shellTargets are water areas adjacent to the linked land", () => {
    expect(shellTargets(riversMap, "tile10").sort()).toEqual(["tile11", "tile15", "tile7"].sort());
  });

  it("available and occupiedCount track commander spend", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    s.actionSpaces["advance-tile1"] = "red";
    s.players.red.commanders.standby = 1;
    expect(occupiedCount(s, "red")).toBe(1);
    expect(available(s, "red")).toBe(5 - 1 - 1); // total - occupied - standby
  });
});
