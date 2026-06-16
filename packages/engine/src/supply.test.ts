import { describe, expect, it } from "vitest";
import type { MapDefinition } from "./maps/riversMap.js";
import { controls, suppliedAreas, inSupply } from "./supply.js";

// Synthetic line map: hqR - a - b - c - hqB
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
    areas: Object.fromEntries(
      [
        A("hqR", ["a"], "red"),
        A("a", ["hqR", "b"]),
        A("b", ["a", "c"]),
        A("c", ["b", "hqB"]),
        A("hqB", ["c"], "black")
      ].map((x) => [x.id, x])
    )
  };
}

const owners = (m: Record<string, "red" | "black" | null>) => ({
  ownerOf: (id: string) => m[id] ?? null
});

describe("supply", () => {
  it("control is unit presence", () => {
    const board = owners({ a: "red" });
    expect(controls(board, "red", "a")).toBe(true);
    expect(controls(board, "black", "a")).toBe(false);
    expect(controls(board, "red", "b")).toBe(false);
  });

  it("supplies areas chained to the HQ through controlled areas", () => {
    const board = owners({ hqR: "red", a: "red", b: "red" });
    const s = suppliedAreas(testMap(), board, "red");
    expect([...s].sort()).toEqual(["a", "b", "hqR"]);
    expect(inSupply(testMap(), board, "red", "b")).toBe(true);
  });

  it("does not supply a controlled area cut off from the HQ", () => {
    // red controls hqR, a, and c — but b (between a and c) is not red-controlled
    const board = owners({ hqR: "red", a: "red", c: "red" });
    const s = suppliedAreas(testMap(), board, "red");
    expect([...s].sort()).toEqual(["a", "hqR"]);
    expect(inSupply(testMap(), board, "red", "c")).toBe(false);
  });

  it("supplies nothing when the HQ is not controlled", () => {
    const board = owners({ a: "red", b: "red" }); // hqR empty/lost
    expect(suppliedAreas(testMap(), board, "red").size).toBe(0);
  });
});
