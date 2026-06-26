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
});
