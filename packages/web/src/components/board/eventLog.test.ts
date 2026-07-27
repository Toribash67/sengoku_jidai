import { describe, expect, it } from "vitest";
import type { PlayerGameEvent } from "@sengoku-jidai/engine/client";
import { describeEvent, type EventLookup } from "./eventLog.js";

// Stub lookups: player names per seat, and an area label that echoes the tile id so tests can
// assert the id was resolved through areaName.
const lookup: EventLookup = {
  seatName: (seat) => (seat === "red" ? "Nobunaga" : "Ieyasu"),
  areaName: (tileId) => `«${tileId}»`
};

describe("describeEvent", () => {
  it("names the capturer, the area, and the previous owner", () => {
    const event: PlayerGameEvent = {
      type: "areaCaptured",
      seat: "red",
      area: "t1",
      previousOwner: "black"
    };
    expect(describeEvent(event, lookup)).toBe("Nobunaga captured «t1» from Ieyasu");
  });

  it("omits the previous owner when the area was unowned", () => {
    const event: PlayerGameEvent = {
      type: "areaCaptured",
      seat: "red",
      area: "t1",
      previousOwner: null
    };
    expect(describeEvent(event, lookup)).toBe("Nobunaga captured «t1»");
  });

  it("shows both endpoints of a move and pluralises units", () => {
    const event: PlayerGameEvent = {
      type: "unitsMoved",
      seat: "black",
      from: "a",
      to: "b",
      unit: "troop",
      count: 2
    };
    expect(describeEvent(event, lookup)).toBe("Ieyasu moved 2 troops — «a» → «b»");
  });

  it("uses the singular for a count of one", () => {
    const event: PlayerGameEvent = {
      type: "unitsPlaced",
      seat: "red",
      area: "a",
      unit: "ship",
      count: 1
    };
    expect(describeEvent(event, lookup)).toBe("Nobunaga placed 1 ship on «a»");
  });

  it("names the area a unit was lost at", () => {
    const event: PlayerGameEvent = {
      type: "unitsRemoved",
      seat: "black",
      area: "a",
      unit: "troop",
      count: 3
    };
    expect(describeEvent(event, lookup)).toBe("Ieyasu lost 3 troops at «a»");
  });

  it("names the area a commander deployed to", () => {
    const event: PlayerGameEvent = { type: "commanderDeployed", seat: "red", spaceId: "hq" };
    expect(describeEvent(event, lookup)).toBe("Nobunaga deployed a commander to «hq»");
  });

  it("names the area a bonus was used at", () => {
    const event: PlayerGameEvent = {
      type: "bonusApplied",
      seat: "red",
      bonus: "barracks",
      area: "a"
    };
    expect(describeEvent(event, lookup)).toBe("Nobunaga used a bonus at «a»");
  });

  it("describes a cap-return with the area", () => {
    const event: PlayerGameEvent = {
      type: "capExceeded",
      area: "a",
      unit: "ship",
      returned: 2,
      owner: "black"
    };
    expect(describeEvent(event, lookup)).toBe("2 ships returned from «a» (over cap)");
  });

  it("uses player names for a dice roll", () => {
    const event: PlayerGameEvent = {
      type: "diceRolled",
      seat: "red",
      purpose: "advance",
      rolls: [3, 5],
      total: 8
    };
    expect(describeEvent(event, lookup)).toBe("Nobunaga rolled [3, 5] = 8 (advance)");
  });

  it("notes a fort die on a dice roll when fort is set", () => {
    const event: PlayerGameEvent = {
      type: "diceRolled",
      seat: "black",
      purpose: "defence",
      rolls: [3, 5],
      total: 8,
      fort: true
    };
    expect(describeEvent(event, lookup)).toBe("Ieyasu rolled [3, 5] = 8 (defence +fort)");
  });

  it("omits the fort marker when fort is not set", () => {
    const event: PlayerGameEvent = {
      type: "diceRolled",
      seat: "black",
      purpose: "defence",
      rolls: [3, 5],
      total: 8
    };
    expect(describeEvent(event, lookup)).toBe("Ieyasu rolled [3, 5] = 8 (defence)");
  });

  it("uses player names for a played card", () => {
    const event: PlayerGameEvent = {
      type: "cardPlayed",
      seat: "black",
      card: "ambush"
    };
    expect(describeEvent(event, lookup)).toContain("Ieyasu played ");
  });

  it("uses player names for a pass", () => {
    const event: PlayerGameEvent = { type: "passed", seat: "red" };
    expect(describeEvent(event, lookup)).toBe("Nobunaga passed");
  });
});
