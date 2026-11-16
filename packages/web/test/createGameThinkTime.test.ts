import { describe, expect, it } from "vitest";
import { createGameBody } from "../src/client/api.js";
import { THINK_TIME_OPTIONS } from "../src/components/thinkTime.js";

describe("AI thinking time on the create screen", () => {
  it("offers Quick, Normal and Long in that order", () => {
    expect(THINK_TIME_OPTIONS).toEqual([
      { value: "quick", label: "Quick (1.5 s)" },
      { value: "normal", label: "Normal (5 s)" },
      { value: "long", label: "Long (10 s)" }
    ]);
  });

  it("is sent only for a computer opponent", () => {
    const base = { name: "M", side: "red" as const, mapId: "rivers" };
    expect(createGameBody({ ...base, opponent: "ai", aiThinkTime: "long" }).aiThinkTime).toBe(
      "long"
    );
    expect(
      createGameBody({ ...base, opponent: "human", aiThinkTime: "long" }).aiThinkTime
    ).toBeUndefined();
    expect(createGameBody({ ...base, opponent: "ai" }).aiThinkTime).toBeUndefined();
  });
});
