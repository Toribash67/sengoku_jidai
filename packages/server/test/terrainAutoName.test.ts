import { describe, expect, it } from "vitest";
import { autoName } from "../src/maps/terrainService.js";

describe("autoName", () => {
  it("starts at Terrain 1", () => {
    expect(autoName([])).toBe("Terrain 1");
  });
  it("uses max existing number + 1", () => {
    expect(autoName([{ name: "Terrain 1" }, { name: "Terrain 2" }])).toBe("Terrain 3");
  });
  it("fills past gaps by max, not count", () => {
    expect(autoName([{ name: "Terrain 1" }, { name: "Terrain 3" }])).toBe("Terrain 4");
  });
  it("ignores names that are not 'Terrain <n>'", () => {
    expect(autoName([{ name: "Coast" }, { name: "Terrain 2" }])).toBe("Terrain 3");
  });
});
