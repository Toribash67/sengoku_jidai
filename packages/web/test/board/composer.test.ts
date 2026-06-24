import type { LegalPlacement } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { largestPlacementPerType } from "../../src/components/board/composer.js";

function placement(spaceId: string, type: "reinforce" | "embark", pool: number): LegalPlacement {
  return {
    spaceId,
    type,
    unit: type === "reinforce" ? "troop" : "ship",
    targets: ["tile9"],
    pool,
    reserve: 20
  };
}

describe("largestPlacementPerType", () => {
  it("keeps only the largest open space per type", () => {
    const result = largestPlacementPerType([
      placement("reinforce-a", "reinforce", 6),
      placement("reinforce-b", "reinforce", 5),
      placement("embark-a", "embark", 3),
      placement("embark-b", "embark", 2)
    ]);
    expect(result.map((p) => p.spaceId)).toEqual(["reinforce-a", "embark-a"]);
  });

  it("surfaces the smaller space once the larger is gone", () => {
    const result = largestPlacementPerType([
      placement("reinforce-b", "reinforce", 5),
      placement("embark-b", "embark", 2)
    ]);
    expect(result.map((p) => p.spaceId)).toEqual(["reinforce-b", "embark-b"]);
  });

  it("preserves order and passes through a single space per type", () => {
    const result = largestPlacementPerType([
      placement("reinforce-a", "reinforce", 6),
      placement("embark-a", "embark", 3)
    ]);
    expect(result.map((p) => p.spaceId)).toEqual(["reinforce-a", "embark-a"]);
  });

  it("returns nothing when there are no placements", () => {
    expect(largestPlacementPerType([])).toEqual([]);
  });
});
