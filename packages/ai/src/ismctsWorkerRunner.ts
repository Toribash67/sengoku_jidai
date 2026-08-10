import { Worker } from "node:worker_threads";
import type { Command, GameState, SeatId } from "./types.js";
import type { IsmctsBotOptions } from "./ismcts.js";
import type { WorkerResponse } from "./ismcts.worker.js";

/** Run one ISMCTS decision on a worker thread so the caller's event loop stays free during the
 *  (CPU-bound, ~1s+) search. Spawns a fresh worker per call and terminates it once the decision
 *  is posted back. The worker path is resolved relative to the compiled runner in dist. */
export function runIsmctsInWorker(
  state: GameState,
  seat: SeatId,
  opts: IsmctsBotOptions
): Promise<Command> {
  return new Promise<Command>((resolve, reject) => {
    const worker = new Worker(new URL("./ismcts.worker.js", import.meta.url));
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      fn();
    };
    worker.on("message", (msg: WorkerResponse) => {
      if (msg.ok) finish(() => resolve(msg.command));
      else finish(() => reject(new Error(`ISMCTS worker failed: ${msg.error}`)));
    });
    worker.on("error", (err) => finish(() => reject(err)));
    worker.on("exit", (code) => {
      finish(() =>
        reject(new Error(`ISMCTS worker exited before returning a command (code ${code})`))
      );
    });
    worker.postMessage({ state, seat, opts });
  });
}
