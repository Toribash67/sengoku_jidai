import { describe, it, expect } from "vitest";
import { commanderPipFills } from "../src/components/CommanderPips.js";

describe("commanderPipFills", () => {
  it("fills the first `remaining` of `total` pips", () => {
    expect(commanderPipFills(5, 3)).toEqual([true, true, true, false, false]);
  });

  it("handles all-remaining and none-remaining", () => {
    expect(commanderPipFills(4, 4)).toEqual([true, true, true, true]);
    expect(commanderPipFills(4, 0)).toEqual([false, false, false, false]);
  });

  it("returns an empty array for a zero total", () => {
    expect(commanderPipFills(0, 0)).toEqual([]);
  });
});
