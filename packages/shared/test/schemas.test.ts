import { describe, expect, it } from "vitest";
import {
  AI_THINK_MS,
  AI_THINK_TIMES,
  DEFAULT_AI_THINK_TIME,
  claimGameRequestSchema,
  createGameRequestSchema,
  hexMapSourceSchema,
  mapParamsSchema
} from "../src/schemas.js";

describe("createGameRequestSchema", () => {
  it("accepts an optional creator name and side", () => {
    const parsed = createGameRequestSchema.parse({ name: "  Kenshin  ", side: "black" });
    expect(parsed.name).toBe("Kenshin");
    expect(parsed.side).toBe("black");
  });

  it("still accepts a bare hotseat request (backward compatible)", () => {
    const parsed = createGameRequestSchema.parse({ mode: "hotseat" });
    expect(parsed.mode).toBe("hotseat");
    expect(parsed.name).toBeUndefined();
  });
});

describe("claimGameRequestSchema", () => {
  it("requires a 1–80 char name", () => {
    expect(claimGameRequestSchema.parse({ name: "Nobunaga" }).name).toBe("Nobunaga");
    expect(claimGameRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("trims the name", () => {
    expect(claimGameRequestSchema.parse({ name: "  Nobunaga  " }).name).toBe("Nobunaga");
  });

  it("rejects names longer than 80 characters", () => {
    expect(claimGameRequestSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
});

const VALID_MAP_SOURCE = {
  id: "fixture",
  name: "Fixture",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "A", kind: "land", hexes: [{ q: 0, r: 0 }], features: { hq: "red" } },
    { id: "B", kind: "land", hexes: [{ q: 1, r: 0 }], features: { hq: "black" } },
    { id: "C", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} }
  ],
  startingDeployment: { A: { seat: "red", troop: 3 } },
  bonusSlots: ["C"]
};

describe("hexMapSourceSchema", () => {
  it("accepts a well-formed map source", () => {
    const parsed = hexMapSourceSchema.parse(VALID_MAP_SOURCE);
    expect(parsed.tiles).toHaveLength(3);
    expect(parsed.tiles[0]!.features.hq).toBe("red");
  });

  it("rejects a tile with no hexes", () => {
    const bad = {
      ...VALID_MAP_SOURCE,
      tiles: [{ ...VALID_MAP_SOURCE.tiles[0]!, hexes: [] }]
    };
    expect(hexMapSourceSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid valueStars", () => {
    const bad = {
      ...VALID_MAP_SOURCE,
      tiles: [
        { ...VALID_MAP_SOURCE.tiles[0]!, features: { valueStars: 3 } },
        ...VALID_MAP_SOURCE.tiles.slice(1)
      ]
    };
    expect(hexMapSourceSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing layout", () => {
    const { layout: _layout, ...bad } = VALID_MAP_SOURCE;
    expect(hexMapSourceSchema.safeParse(bad).success).toBe(false);
  });
});

describe("createGameRequestSchema mapId", () => {
  it("accepts an optional mapId", () => {
    expect(createGameRequestSchema.parse({ mapId: "abc" }).mapId).toBe("abc");
    expect(createGameRequestSchema.parse({}).mapId).toBeUndefined();
  });

  it("rejects an empty mapId", () => {
    expect(createGameRequestSchema.safeParse({ mapId: "" }).success).toBe(false);
  });
});

describe("mapParamsSchema", () => {
  it("requires a non-empty mapId param", () => {
    expect(mapParamsSchema.parse({ mapId: "m1" }).mapId).toBe("m1");
    expect(mapParamsSchema.safeParse({ mapId: "" }).success).toBe(false);
  });
});

describe("createGameRequestSchema aiThinkTime", () => {
  it("accepts the three thinking times and rejects others", () => {
    for (const t of ["quick", "normal", "long"]) {
      const parsed = createGameRequestSchema.safeParse({ opponent: "ai", aiThinkTime: t });
      expect(parsed.success).toBe(true);
    }
    expect(createGameRequestSchema.safeParse({ aiThinkTime: "forever" }).success).toBe(false);
    expect(createGameRequestSchema.parse({}).aiThinkTime).toBeUndefined();
  });

  it("maps the presets to 1.5 s, 5 s and 10 s, defaulting to Normal", () => {
    expect(AI_THINK_MS).toEqual({ quick: 1500, normal: 5000, long: 10000 });
    expect(AI_THINK_TIMES).toEqual(["quick", "normal", "long"]);
    expect(DEFAULT_AI_THINK_TIME).toBe("normal");
  });
});
