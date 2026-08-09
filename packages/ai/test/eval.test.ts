import { describe, expect, it } from "vitest";
import { getMap } from "@sengoku-jidai/engine";
import { hqDistances, tileBaseValue } from "../src/geometry.js";

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
});
