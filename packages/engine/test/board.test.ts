import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { gameBoard } from "../src/board.js";
import { suppliedAreas } from "../src/supply.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

describe("gameBoard", () => {
  it("reports the owner of each area from live state", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const board = gameBoard(s);
    expect(board.ownerOf(hqOf("red"))).toBe("red");
    expect(board.ownerOf(hqOf("black"))).toBe("black");
    expect(board.ownerOf("tile3")).toBeNull();
  });

  it("returns null for unknown area ids", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(gameBoard(s).ownerOf("nope")).toBeNull();
  });

  it("drives suppliedAreas over live state (the starting deployment at setup)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const supplied = suppliedAreas(riversMap, gameBoard(s), "red");
    expect(supplied.has(hqOf("red"))).toBe(true);
    // Red starts on tile1/tile9(HQ)/tile10/tile19 (land) and the navy on tile14, all supplied.
    expect([...supplied].sort()).toEqual(["tile1", "tile10", "tile14", "tile19", "tile9"]);
    expect(supplied.size).toBe(5);
  });
});
