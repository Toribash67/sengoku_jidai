import { describe, expect, it } from "vitest";
import type { MapDefinition } from "../src/maps/riversMap.js";
import type { SupplyBoard } from "../src/supply.js";
import { victoryPoints, hqEliminated, evaluateGameEnd } from "../src/scoring.js";

function testMap(): MapDefinition {
  const A = (id: string, adjacent: string[], hq?: "red" | "black", stars: 0 | 1 | 2 = 0) => ({
    id,
    kind: "land" as const,
    hq: hq ?? null,
    valueStars: stars,
    harbor: false,
    shellable: false,
    adjacent,
    ports: []
  });
  return {
    id: "test",
    name: "Test",
    bonusSlots: [],
    areas: Object.fromEntries(
      [
        A("hqR", ["a"], "red"),
        A("a", ["hqR", "b"], undefined, 2),
        A("b", ["a", "hqB"], undefined, 1),
        A("hqB", ["b"], "black")
      ].map((x) => [x.id, x])
    )
  };
}
const owners = (m: Record<string, "red" | "black" | null>): SupplyBoard => ({
  ownerOf: (id) => m[id] ?? null
});

describe("scoring", () => {
  it("sums value stars over supplied areas only", () => {
    const board = owners({ hqR: "red", a: "red" }); // b not red -> a(2) counts, b(1) does not
    expect(victoryPoints(testMap(), board, "red")).toBe(2);
  });

  it("detects an eliminated HQ", () => {
    expect(hqEliminated(testMap(), owners({ hqR: "red" }), "red")).toBe(false);
    expect(hqEliminated(testMap(), owners({ hqR: "black" }), "red")).toBe(true); // red has no units in its HQ
    expect(hqEliminated(testMap(), owners({}), "red")).toBe(true); // empty HQ
  });

  it("ends immediately when a HQ is eliminated", () => {
    const board = owners({ hqR: "black", a: "red", hqB: "black" });
    const result = evaluateGameEnd(testMap(), board, { round: 2, maxRounds: 4, initiative: "red" });
    expect(result).toEqual({ complete: true, winner: "black", endReason: "hqEliminated" });
  });

  it("breaks a simultaneous double HQ elimination on initiative", () => {
    const board = owners({ a: "red" }); // neither hqR nor hqB is held by its faction
    expect(
      evaluateGameEnd(testMap(), board, { round: 2, maxRounds: 4, initiative: "black" })
    ).toEqual({ complete: true, winner: "black", endReason: "hqEliminated" });
  });

  it("does not end mid-game when both HQs stand", () => {
    const board = owners({ hqR: "red", hqB: "black" });
    expect(
      evaluateGameEnd(testMap(), board, { round: 2, maxRounds: 4, initiative: "red" })
    ).toEqual({
      complete: false,
      winner: null,
      endReason: null
    });
  });

  it("scores by supplied VP after the final round, breaking ties on initiative", () => {
    // After round 4, both HQs stand. red supplies a(2); black supplies b(1) -> red wins.
    const board = owners({ hqR: "red", a: "red", b: "black", hqB: "black" });
    expect(
      evaluateGameEnd(testMap(), board, { round: 4, maxRounds: 4, initiative: "black" })
    ).toEqual({
      complete: true,
      winner: "red",
      endReason: "victoryPoints"
    });

    // Tie -> initiative holder wins.
    const tied = owners({ hqR: "red", hqB: "black" }); // both supply only their 0-star HQ
    expect(
      evaluateGameEnd(testMap(), tied, { round: 4, maxRounds: 4, initiative: "black" })
    ).toEqual({
      complete: true,
      winner: "black",
      endReason: "victoryPoints"
    });
  });
});
