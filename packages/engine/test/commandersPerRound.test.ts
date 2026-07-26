import { describe, it, expect } from "vitest";
import { compileHexMap } from "../src/maps/hex/compile.js";
import { FIXTURE_HEX_MAP } from "../src/maps/hex/fixtures.js";
import { registerMap } from "../src/maps/registry.js";
import { createInitialState } from "../src/game.js";
import { riversMapId } from "../src/maps/riversMap.js";

describe("commandersPerRound", () => {
  it("compiles the source field onto the map definition", () => {
    const compiled = compileHexMap({ ...FIXTURE_HEX_MAP, commandersPerRound: 3 });
    expect(compiled.definition.commandersPerRound).toBe(3);
  });

  it("leaves the definition field undefined when the source omits it", () => {
    const compiled = compileHexMap(FIXTURE_HEX_MAP);
    expect(compiled.definition.commandersPerRound).toBeUndefined();
  });

  it("createInitialState seats each player with the map's per-round count", () => {
    registerMap(
      compileHexMap({ ...FIXTURE_HEX_MAP, id: "cpr-fixture", commandersPerRound: 3 }).definition
    );
    const state = createInitialState({ gameId: "g1", seed: "s1", mapId: "cpr-fixture" });
    expect(state.players.red.commanders.total).toBe(3);
    expect(state.players.black.commanders.total).toBe(3);
  });

  it("falls back to the ruleset default (5) for maps without the field", () => {
    const state = createInitialState({ gameId: "g2", seed: "s2", mapId: riversMapId });
    expect(state.players.red.commanders.total).toBe(5);
  });
});
