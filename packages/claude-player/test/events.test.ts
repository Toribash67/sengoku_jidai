import { describe, expect, it } from "vitest";
import type { PlayerGameEvent } from "@sengoku-jidai/engine";
import { formatEvent } from "../src/events.js";

const all: PlayerGameEvent[] = [
  { type: "commanderDeployed", seat: "red", spaceId: "advance-L7" },
  { type: "passed", seat: "black" },
  { type: "unitsMoved", seat: "red", from: "L3", to: "L7", unit: "troop", count: 2 },
  { type: "unitsPlaced", seat: "red", area: "L3", unit: "troop", count: 3 },
  { type: "bonusApplied", seat: "red", bonus: "barracks", area: "L3" },
  { type: "diceRolled", seat: "black", purpose: "defence", rolls: [2, 6], total: 8, fort: true },
  { type: "cardsDrawn", seat: "red", count: 1 },
  { type: "cardDiscarded", seat: "red" },
  { type: "cardPlayed", seat: "red", card: "mobilise" },
  { type: "unitsRemoved", seat: "black", area: "L7", unit: "troop", count: 1 },
  { type: "areaCaptured", seat: "red", area: "L7", previousOwner: "black" },
  { type: "capExceeded", area: "S1", unit: "ship", returned: 1, owner: "red" },
  { type: "turnAdvanced", activeSeat: "black" },
  { type: "recalled", round: 2, initiative: "red" },
  { type: "initiativeSeized", seat: "black" },
  { type: "gameEnded", winner: "red", reason: "victoryPoints" }
];

describe("formatEvent", () => {
  it("formats every event type on one line without falling back to JSON", () => {
    for (const e of all) {
      const line = formatEvent(e, "red");
      expect(line, e.type).not.toContain("\n");
      expect(line, e.type).not.toContain("{");
    }
  });

  it("names the viewer as you", () => {
    expect(formatEvent(all[2]!, "red")).toBe("red (you) moved 2 troops L3 → L7");
    expect(formatEvent(all[2]!, "black")).toBe("red (opponent) moved 2 troops L3 → L7");
    expect(formatEvent(all[5]!, "red")).toBe("black (opponent) rolled defence: 2, 6 = 8 (fort)");
  });

  it("falls back to type + JSON for unknown events", () => {
    const odd = { type: "somethingNew", x: 1 } as unknown as PlayerGameEvent;
    expect(formatEvent(odd, "red")).toBe('somethingNew {"type":"somethingNew","x":1}');
  });
});
