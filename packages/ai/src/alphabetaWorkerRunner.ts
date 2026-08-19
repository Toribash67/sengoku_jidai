import { Worker } from "node:worker_threads";
import type { Command, GameState, SeatId } from "./types.js";
import type { AlphaBetaOptions } from "./bots/alphabeta.js";
import type { WorkerResponse } from "./alphabeta.worker.js";

/** Run one alpha-beta decision on a worker thread so the caller's event loop stays free during
 *  the (CPU-bound, up to ~1.5s) search. Spawns a fresh worker per call and terminates it once the
 *  decision is posted back. The worker path is resolved relative to the compiled runner in dist. */
export function runAlphaBetaInWorker(
  state: GameState,
  seat: SeatId,
  opts: AlphaBetaOptions
): Promise<Command> {
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
    worker.postMessage({ state, seat, opts });
  });
}
