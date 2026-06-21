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

  it("exposes the v2 view, command, and serialization surface", () => {
    expect(typeof engine.playerView).toBe("function");
    expect(typeof engine.legalCommandsForState).toBe("function");
    expect(typeof engine.playerEvents).toBe("function");
    expect(typeof engine.resolveCommand).toBe("function");
    expect(typeof engine.serializeState).toBe("function");
    expect(typeof engine.deserializeState).toBe("function");
  });

  it("no longer exposes placeholder symbols", () => {
    const surface = engine as Record<string, unknown>;
    expect(surface.createGame).toBeUndefined();
    expect(surface.spectatorView).toBeUndefined();
    expect(surface.legalCommandsForView).toBeUndefined();
  });
});
