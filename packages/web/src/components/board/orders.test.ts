import { describe, expect, it } from "vitest";
import type { LegalCommandSummary, LegalMove, LegalStrike } from "@sengoku-jidai/engine";
import {
  armMove,
  armStrike,
  candidateTiles,
  resolveArmedTile,
  verbAvailability
} from "./orders.js";

const advance: LegalMove = {
  spaceId: "advance-x",
  type: "advance",
  targetAreaId: "tile3",
  sources: [{ areaId: "tile2", max: 2 }]
};
const sail: LegalMove = {
  spaceId: "sail-y",
  type: "sail",
  targetAreaId: "sea1",
  sources: [{ areaId: "sea0", max: 1 }]
};
const bombard: LegalStrike = {
  spaceId: "bombard-y",
  type: "bombard",
  linkedAreaId: "sea1",
  targets: ["tile5"],
  dice: 2
};

/** A minimal legal summary; only the fields the functions read need to be real. */
function legal(over: Partial<LegalCommandSummary>): LegalCommandSummary {
  return {
    activeSeat: "red",
    spaces: [],
    canPass: false,
    moves: [],
    strikes: [],
    placements: [],
    plans: [],
    cardPlays: [],
    canRollCombat: false,
    canResolveCombat: false,
    canRerollCombat: false,
    canAmbush: false,
    ...over
  };
}

describe("verbAvailability", () => {
  it("flags a verb usable when at least one matching option exists", () => {
    const avail = verbAvailability(
      legal({
        moves: [advance],
        strikes: [bombard],
        placements: [
          {
            spaceId: "reinforce-a",
            type: "reinforce",
            unit: "troop",
            targets: ["tile2"],
            pool: 6,
            reserve: 4
          }
        ],
        plans: [{ spaceId: "plan-a", initiative: true }],
        canPass: true
      })
    );
    expect(avail).toMatchObject({
      advance: true,
      sail: false,
      bombard: true,
      shell: false,
      reinforce: true,
      embark: false,
      plan: true,
      pass: true
    });
  });

  it("flags everything false on an empty summary", () => {
    expect(verbAvailability(legal({}))).toMatchObject({
      advance: false,
      sail: false,
      bombard: false,
      shell: false,
      reinforce: false,
      embark: false,
      plan: false,
      pass: false
    });
  });
});

describe("armMove / armStrike", () => {
  it("arms only the moves of the requested type", () => {
    const armed = armMove(legal({ moves: [advance, sail] }), "advance");
    expect(armed).toEqual({ kind: "move", type: "advance", moves: [advance] });
  });

  it("returns null when no move of that type is legal", () => {
    expect(armMove(legal({ moves: [sail] }), "advance")).toBeNull();
  });

  it("arms only the strikes of the requested type", () => {
    const armed = armStrike(legal({ strikes: [bombard] }), "bombard");
    expect(armed).toEqual({ kind: "strike", type: "bombard", strikes: [bombard] });
  });
});

describe("candidateTiles", () => {
  it("uses move destinations", () => {
    expect(candidateTiles({ kind: "move", type: "advance", moves: [advance, sail] })).toEqual(
      new Set(["tile3", "sea1"])
    );
  });

  it("uses strike linked areas", () => {
    expect(candidateTiles({ kind: "strike", type: "bombard", strikes: [bombard] })).toEqual(
      new Set(["sea1"])
    );
  });
});

describe("resolveArmedTile", () => {
  it("resolves a destination click to its move", () => {
    expect(resolveArmedTile({ kind: "move", type: "advance", moves: [advance] }, "tile3")).toEqual({
      kind: "move",
      move: advance
    });
  });

  it("resolves a strike target click to its strike", () => {
    expect(
      resolveArmedTile({ kind: "strike", type: "bombard", strikes: [bombard] }, "sea1")
    ).toEqual({ kind: "strike", strike: bombard });
  });

  it("returns null for a non-candidate tile", () => {
    expect(
      resolveArmedTile({ kind: "move", type: "advance", moves: [advance] }, "tile9")
    ).toBeNull();
  });
});
