import { describe, expect, it } from "vitest";
import * as engine from "../src/index.js";

describe("engine package exports", () => {
  it("exposes the v2 setup surface", () => {
    expect(typeof engine.createInitialState).toBe("function");
    expect(typeof engine.zeroUnits).toBe("function");
    expect(engine.RIVERS_UNIT_POOL).toEqual({ troop: 25, ship: 10, siege: 0 });
    expect(engine.HQ_STARTING_TROOPS).toBe(3);
  });

  it("createInitialState produces a schemaVersion-2 state via the index", () => {
    const s = engine.createInitialState({ gameId: "g", seed: "s" });
    expect(s.schemaVersion).toBe(2);
  });
});
