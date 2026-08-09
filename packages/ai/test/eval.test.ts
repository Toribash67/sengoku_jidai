import { describe, expect, it } from "vitest";
import { createInitialState, gameBoard, getMap } from "@sengoku-jidai/engine";
import { hqDistances, tileBaseValue } from "../src/geometry.js";
import { evaluate, DEFAULT_WEIGHTS } from "../src/eval.js";

describe("geometry", () => {
  it("computes zero distance at a seat's own HQ and positive elsewhere", () => {
    const map = getMap("rivers");
    const dist = hqDistances(map, "red");
    const redHq = Object.values(map.areas).find((a) => a.hq === "red")!;
    expect(dist.get(redHq.id)).toBe(0);
    const someOther = Object.values(map.areas).find((a) => a.hq !== "red")!;
    expect(dist.get(someOther.id)!).toBeGreaterThan(0);
  });

  it("values a tile nearer the enemy HQ more highly (proximity term only)", () => {
    const map = getMap("rivers");
    const w = { star: 0, bonusSlot: 0, proximity: 1 };
    const blackHq = Object.values(map.areas).find((a) => a.hq === "black")!;
    const adjToBlack = blackHq.adjacent[0]!;
    const distRed = hqDistances(map, "red");
    // A tile adjacent to black HQ is closer to the enemy (for red) than red's own HQ tile.
    const redHq = Object.values(map.areas).find((a) => a.hq === "red")!;
    expect(tileBaseValue(map, "red", adjToBlack, w)).toBeGreaterThan(
      tileBaseValue(map, "red", redHq.id, w)
    );
    expect(distRed.get(redHq.id)).toBe(0);
  });

  it("returns fresh distances when a new map object reuses an id (no stale cache)", () => {
    const a = {
      id: "t",
      name: "t",
      bonusSlots: [],
      areas: {
        hq: {
          id: "hq",
          kind: "land",
          hq: "red",
          valueStars: 0,
          harbor: false,
          shellable: false,
          fort: false,
          adjacent: ["x"],
          ports: []
        },
        x: {
          id: "x",
          kind: "land",
          hq: null,
          valueStars: 0,
          harbor: false,
          shellable: false,
          fort: false,
          adjacent: ["hq"],
          ports: []
        }
      }
    } as unknown as import("@sengoku-jidai/engine").MapDefinition;
    expect(hqDistances(a, "red").get("x")).toBe(1);
    // A DIFFERENT object with the same id but x no longer adjacent to hq -> unreachable.
    const b = { ...a, areas: { ...a.areas, hq: { ...a.areas.hq, adjacent: [] } } } as typeof a;
    expect(hqDistances(b, "red").get("x")).toBeUndefined();
  });
});

describe("evaluate", () => {
  it("is antisymmetric between the seats", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(evaluate(s, "red")).toBeCloseTo(-evaluate(s, "black"), 6);
  });

  it("is ~0 at the symmetric opening", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    // Rivers starts mirror-symmetric; initiative/first-move may tilt it slightly.
    expect(Math.abs(evaluate(s, "red"))).toBeLessThan(DEFAULT_WEIGHTS.initiative + 1e-6 + 0.5);
  });

  it("rewards holding more victory points", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const map = getMap(s.mapId);
    // Find a starred tile red does not yet supply, and give red a unit + ownership there.
    const board = gameBoard(s);
    const before = evaluate(s, "red");
    const starTile = Object.values(map.areas).find(
      (a) => a.valueStars > 0 && board.ownerOf(a.id) !== "red"
    )!;
    const s2 = structuredClone(s);
    s2.areas[starTile.id] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    expect(evaluate(s2, "red")).toBeGreaterThan(before);
  });

  it("returns a large positive value when the opponent's HQ is eliminated", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const done = structuredClone(s);
    done.status = "complete";
    done.winner = "red";
    expect(evaluate(done, "red")).toBeGreaterThan(500);
    expect(evaluate(done, "black")).toBeLessThan(-500);
  });
});
