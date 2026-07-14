import { describe, expect, it } from "vitest";
import type { PlayerGameEvent } from "@sengoku-jidai/engine/client";
import { affectedTileIds } from "./eventTiles.js";

describe("affectedTileIds", () => {
  it("returns nothing for an empty batch", () => {
    expect(affectedTileIds([])).toEqual([]);
  });

  it("collects the tile from a placement", () => {
    const events: PlayerGameEvent[] = [
      { type: "unitsPlaced", seat: "red", area: "tileA", unit: "troop", count: 2 }
    ];
    expect(affectedTileIds(events)).toEqual(["tileA"]);
  });

  it("collects both ends of a move", () => {
    const events: PlayerGameEvent[] = [
      { type: "unitsMoved", seat: "red", from: "tileA", to: "tileB", unit: "troop", count: 1 }
    ];
    expect(affectedTileIds(events)).toEqual(["tileA", "tileB"]);
  });

  it("collects the space a commander deployed to", () => {
    const events: PlayerGameEvent[] = [
      { type: "commanderDeployed", seat: "black", spaceId: "spaceC" }
    ];
    expect(affectedTileIds(events)).toEqual(["spaceC"]);
  });

  it("collects captures, bonuses, removals and cap-returns", () => {
    const events: PlayerGameEvent[] = [
      { type: "areaCaptured", seat: "red", area: "cap", previousOwner: "black" },
      { type: "bonusApplied", seat: "red", bonus: "barracks", area: "bon" },
      { type: "unitsRemoved", seat: "black", area: "rem", unit: "ship", count: 1 },
      { type: "capExceeded", area: "cae", unit: "troop", returned: 1, owner: "red" }
    ];
    expect(affectedTileIds(events)).toEqual(["cap", "bon", "rem", "cae"]);
  });

  it("ignores non-spatial events", () => {
    const events: PlayerGameEvent[] = [
      { type: "passed", seat: "red" },
      { type: "diceRolled", seat: "red", purpose: "advance", rolls: [3], total: 3 },
      { type: "cardsDrawn", seat: "red", count: 2 },
      { type: "cardDiscarded", seat: "red" },
      { type: "turnAdvanced", activeSeat: "black" },
      { type: "recalled", round: 2, initiative: "red" },
      { type: "initiativeSeized", seat: "red" },
      { type: "gameEnded", winner: "red", reason: "victoryPoints" }
    ];
    expect(affectedTileIds(events)).toEqual([]);
  });

  it("de-duplicates tiles touched more than once, keeping first-seen order", () => {
    const events: PlayerGameEvent[] = [
      { type: "unitsMoved", seat: "red", from: "tileA", to: "tileB", unit: "troop", count: 1 },
      { type: "areaCaptured", seat: "red", area: "tileB", previousOwner: "black" },
      { type: "unitsPlaced", seat: "red", area: "tileA", unit: "troop", count: 1 }
    ];
    expect(affectedTileIds(events)).toEqual(["tileA", "tileB"]);
  });
});
