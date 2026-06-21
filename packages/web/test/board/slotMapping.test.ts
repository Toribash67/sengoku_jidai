import { describe, expect, it } from "vitest";
import { slotIdForSpace } from "../../src/components/board/slotMapping.js";

describe("slotIdForSpace", () => {
  it("maps an advance space to the SVG move slot", () => {
    expect(slotIdForSpace("advance-tile9")).toBe("move-tile9");
  });

  it("keeps the sail/bombard/shell prefixes", () => {
    expect(slotIdForSpace("sail-tile22")).toBe("sail-tile22");
    expect(slotIdForSpace("bombard-tile22")).toBe("bombard-tile22");
    expect(slotIdForSpace("shell-tile13")).toBe("shell-tile13");
  });

  it("returns null for support spaces with no board slot", () => {
    expect(slotIdForSpace("reinforce-a")).toBeNull();
    expect(slotIdForSpace("embark-b")).toBeNull();
    expect(slotIdForSpace("plan-a")).toBeNull();
  });
});
