import { describe, expect, it } from "vitest";
import {
  compileHexMap,
  createInitialState,
  FIXTURE_HEX_MAP,
  registerMap,
  resolveCommand
} from "@sengoku-jidai/engine";
// Imported from the BUILT package: the worker file is resolved relative to the compiled runner in
// dist (see alphabetaWorkerCustomMap.test.ts). Requires the ai package to be built.
import { expectiCommand, observe, runExpectiInWorker } from "@sengoku-jidai/ai";

describe("runExpectiInWorker", () => {
  it("returns the same command as an in-process search", async () => {
    const s = createInitialState({ gameId: "g", seed: "w1" });
    const o = observe(s, s.activeSeat);
    const viaWorker = await runExpectiInWorker(o, s.activeSeat, { depth: 2 });
    expect(viaWorker).toEqual(expectiCommand(o, s.activeSeat, { depth: 2 }));
  }, 15000);

  it("works on a custom map the worker has never seen", async () => {
    const custom = compileHexMap({ ...FIXTURE_HEX_MAP, id: "expecti-worker-map" }).definition;
    registerMap(custom); // main thread only
    const s = createInitialState({ gameId: "g", seed: "w2", mapId: custom.id });
    const cmd = await runExpectiInWorker(observe(s, s.activeSeat), s.activeSeat, { depth: 1 });
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  }, 15000);
});
