import { Worker } from "node:worker_threads";
import { getMap } from "@sengoku-jidai/engine";
import type { Command, GameState, SeatId } from "./types.js";
import type { AlphaBetaOptions } from "./bots/alphabeta.js";
import type { WorkerResponse } from "./alphabeta.worker.js";

/** Run one alpha-beta decision on a worker thread so the caller's event loop stays free during
 *  the (CPU-bound, up to ~1.5s) search. Spawns a fresh worker per call and terminates it once the
 *  decision is posted back. The worker path is resolved relative to the compiled runner in dist.
 *
 *  The worker is a fresh module instance, so its engine map registry holds only the built-in maps.
 *  Custom maps live only in the MAIN thread's registry (the server's MapLibrary registers them
 *  there), so we resolve the game's map here and ship its definition along for the worker to
 *  register before searching — otherwise every non-built-in map throws "Unknown map id" inside the
 *  search and the AI never returns a move. */
export function runAlphaBetaInWorker(
  state: GameState,
  seat: SeatId,
  opts: AlphaBetaOptions
): Promise<Command> {
  const map = getMap(state.mapId);
  return new Promise<Command>((resolve, reject) => {
    const worker = new Worker(new URL("./alphabeta.worker.js", import.meta.url));
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      fn();
    };
    worker.on("message", (msg: WorkerResponse) => {
      if (msg.ok) finish(() => resolve(msg.command));
      else finish(() => reject(new Error(`alpha-beta worker failed: ${msg.error}`)));
    });
    worker.on("error", (err) => finish(() => reject(err)));
    worker.on("exit", (code) => {
      finish(() =>
        reject(new Error(`alpha-beta worker exited before returning a command (code ${code})`))
      );
    });
    worker.postMessage({ state, seat, opts, map });
  });
}
