import { describe, expect, it } from "vitest";
import {
  compileHexMap,
  createInitialState,
  FIXTURE_HEX_MAP,
  registerMap
} from "@sengoku-jidai/engine";
// Import the runner from the BUILT package: the worker file is resolved relative to the compiled
// runner in dist, so this path must be the dist entry (self-reference), not ../src. Requires the
// ai package to be built (the repo's standard dist-consumption pattern for worker code).
import { runAlphaBetaInWorker } from "@sengoku-jidai/ai";

// Regression: the alpha-beta worker is a fresh module instance whose engine map registry holds only
// the built-in maps. Custom (non-Rivers) maps are registered only in the main thread by the server's
// MapLibrary, so before the fix `getMap(customId)` threw "Unknown map id" inside the worker and the
// AI never returned a move — the game hung on the AI's turn for every map except built-in Rivers.
describe("runAlphaBetaInWorker with a custom map", () => {
  it("returns a move for a map registered only in the main thread", async () => {
    const custom = compileHexMap({ ...FIXTURE_HEX_MAP, id: "worker-custom-map" }).definition;
    registerMap(custom); // main thread only — the worker never sees this call
    const state = createInitialState({ gameId: "g", seed: "seed-worker", mapId: custom.id });

    const cmd = await runAlphaBetaInWorker(state, state.activeSeat, { deadlineMs: 500 });
    expect(cmd).toBeTruthy();
    expect(typeof cmd.type).toBe("string");
  }, 15000);
});
