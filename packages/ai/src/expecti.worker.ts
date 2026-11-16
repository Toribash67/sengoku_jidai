import { parentPort } from "node:worker_threads";
import { registerMap, type MapDefinition } from "@sengoku-jidai/engine";
import type { ExpectiOptions } from "./search2/features.js";
import { chooseCommand } from "./search2/search.js";
import type { Command, GameState, SeatId } from "./types.js";

if (!parentPort) {
  throw new Error("expecti.worker must be run as a worker thread");
}

interface WorkerRequest {
  /** Already reduced to what `seat` may know (see observe): hidden cards never reach the worker. */
  observed: GameState;
  seat: SeatId;
  opts: ExpectiOptions;
  /** The game's compiled map. This worker's engine registry only has the built-in maps, so the
   *  main thread ships the definition and we register it here before the search touches getMap. */
  map: MapDefinition;
}

export type WorkerResponse = { ok: true; command: Command } | { ok: false; error: string };

parentPort.on("message", (req: WorkerRequest) => {
  try {
    registerMap(req.map);
    const command = chooseCommand(req.observed, req.seat, req.opts);
    parentPort!.postMessage({ ok: true, command } satisfies WorkerResponse);
  } catch (err) {
    parentPort!.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    } satisfies WorkerResponse);
  }
});
