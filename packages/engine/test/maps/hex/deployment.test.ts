import { describe, expect, it } from "vitest";
import { compileHexMap } from "../../../src/maps/hex/compile.js";
import { FIXTURE_HEX_MAP } from "../../../src/maps/hex/fixtures.js";
import { createInitialState } from "../../../src/game.js";
import { registerMap } from "../../../src/maps/registry.js";

describe("map-driven starting deployment", () => {
  it("createInitialState deploys units from the map's startingDeployment", () => {
    const { definition } = compileHexMap(FIXTURE_HEX_MAP);
    registerMap(definition);

    const state = createInitialState({ gameId: "g1", seed: "seed", mapId: definition.id });

    // A: red HQ with 3 troops; C: sea with red ship; E: black HQ with 3 troops.
    expect(state.areas.A!.owner).toBe("red");
    expect(state.areas.A!.units.troop).toBe(3);
    expect(state.areas.C!.owner).toBe("red");
    expect(state.areas.C!.units.ship).toBe(1);
    expect(state.areas.E!.owner).toBe("black");
    expect(state.areas.E!.units.troop).toBe(3);
    // D has no deployment and no hq -> unowned, empty.
    expect(state.areas.D!.owner).toBeNull();
    expect(state.areas.D!.units.troop).toBe(0);
  });

  it("leaves the Rivers map (no startingDeployment) on the hardcoded fallback", () => {
    const state = createInitialState({ gameId: "g2", seed: "seed", mapId: "rivers" });
    // tile9 is the Rivers red HQ with 3 starting troops (RIVERS_STARTING_UNITS).
    expect(state.areas.tile9!.owner).toBe("red");
    expect(state.areas.tile9!.units.troop).toBe(3);
  });
});
