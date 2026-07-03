import { describe, expect, it } from "vitest";
import { createInitialState, deserializeState, serializeState } from "../src/index.js";

describe("v3 serialization", () => {
  it("round-trips a state through serialize -> deserialize", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const restored = deserializeState(serializeState(state));
    expect(restored).toEqual(state);
    expect(restored.schemaVersion).toBe(3);
  });

  it("rejects an unsupported schema version", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const bad = { ...serializeState(state), schemaVersion: 2 } as unknown as ReturnType<
      typeof serializeState
    >;
    expect(() => deserializeState(bad)).toThrow(/schema version/i);
  });

  it("rejects a snapshot with a missing top-level field", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const json = serializeState(state) as unknown as Record<string, unknown>;
    delete json.players;
    expect(() => deserializeState(json as unknown as ReturnType<typeof serializeState>)).toThrow(
      /players/
    );
  });

  it("rejects a snapshot with a wrongly-typed field", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const json = { ...serializeState(state), rngState: 42 } as unknown as ReturnType<
      typeof serializeState
    >;
    expect(() => deserializeState(json)).toThrow(/rngState/);
  });

  it("rejects a snapshot with an unknown card id in the deck", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const json = serializeState(state);
    (json.deck as unknown as string[])[0] = "not_a_card";
    expect(() => deserializeState(json)).toThrow(/deck/);
  });

  it("rejects a snapshot whose area runtime is malformed", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const json = serializeState(state);
    const firstArea = Object.keys(json.areas)[0]!;
    (json.areas as Record<string, unknown>)[firstArea] = { owner: "red" };
    expect(() => deserializeState(json)).toThrow(/units/);
  });

  it("round-trips a mid-game state with pending combat and cards in hands", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    state.players.red.hand = ["ambush", "mobilise"];
    state.pendingCombat = {
      id: "pc1",
      kind: "advance",
      attacker: "red",
      defender: "black",
      responsibleSeat: "black",
      phase: "rolled",
      area: "tile3",
      unit: "troop",
      attackers: 2,
      defenders: 1,
      rolls: [4],
      total: 4
    };
    const restored = deserializeState(serializeState(state));
    expect(restored).toEqual(state);
  });
});
