import { describe, expect, it } from "vitest";
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { capitalizeSeat, endReasonText, seatDisplayName } from "./gameOver.js";

describe("capitalizeSeat", () => {
  it("title-cases each seat", () => {
    expect(capitalizeSeat("red")).toBe("Red");
    expect(capitalizeSeat("black")).toBe("Black");
  });
});

describe("endReasonText", () => {
  it("describes an HQ elimination", () => {
    expect(endReasonText("hqEliminated")).toBe("Captured the enemy headquarters");
  });
  it("describes a victory-point finish", () => {
    expect(endReasonText("victoryPoints")).toBe("Most supply points at the final round");
  });
});

describe("seatDisplayName", () => {
  const seatInfo: GameSeatInfo[] = [
    { seat: "red", name: "Nobunaga", status: "claimed" },
    { seat: "black", name: null, status: "open" }
  ];
  it("returns the seat's player name when set", () => {
    expect(seatDisplayName("red", seatInfo)).toBe("Nobunaga");
  });
  it("falls back to the capitalized seat when the name is null", () => {
    expect(seatDisplayName("black", seatInfo)).toBe("Black");
  });
  it("falls back when the seat is absent from seatInfo", () => {
    expect(seatDisplayName("red", [])).toBe("Red");
  });
});
