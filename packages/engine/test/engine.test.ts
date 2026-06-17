import { describe, expect, it } from "vitest";
import { createGame, playerView, resolveCommand, serializeState } from "../src/index.js";

describe("placeholder engine", () => {
  it("creates a deterministic initial state", () => {
    const state = createGame({ gameId: "game-1", mode: "hotseat", seed: "fixed" });

    expect(serializeState(state)).toMatchObject({
      schemaVersion: 1,
      gameId: "game-1",
      activeSeat: "red",
      revision: 0
    });
  });

  it("accepts a legal claim and advances the revision", () => {
    const state = createGame({ gameId: "game-1", mode: "hotseat" });
    const result = resolveCommand(
      state,
      { seat: "red", playerId: "red" },
      { type: "claimArea", areaId: "omi" }
    );

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.nextState.revision).toBe(1);
      expect(result.nextState.areas.omi?.controller).toBe("red");
      expect(result.events).toHaveLength(1);
    }
  });

  it("projects a player-safe view", () => {
    const state = createGame({ gameId: "game-1", mode: "hotseat" });
    const view = playerView(state, "red");

    expect(view.viewerSeat).toBe("red");
    expect(view.legal.commands.length).toBeGreaterThan(0);
  });
});
