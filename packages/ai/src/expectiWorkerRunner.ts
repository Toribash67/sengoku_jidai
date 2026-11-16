import { Worker } from "node:worker_threads";
import { getMap } from "@sengoku-jidai/engine";
import type { Command, GameState, SeatId } from "./types.js";
import type { ExpectiOptions } from "./search2/features.js";
import type { WorkerResponse } from "./expecti.worker.js";

/** Run one ExpectiBot decision on a worker thread so the caller's event loop stays free during
 *  the search. Mirrors runAlphaBetaInWorker: a fresh worker per call, terminated once it answers,
 *  with the game's map shipped along because the worker's registry only knows the built-in maps.
 *
 *  `observed` must already be the seat's observation (see observe): the caller redacts, so hidden
 *  cards never cross into the worker. */
export function runExpectiInWorker(
  observed: GameState,
  seat: SeatId,
  opts: ExpectiOptions
): Promise<Command> {
  const map = getMap(observed.mapId);
  return new Promise<Command>((resolve, reject) => {
    const worker = new Worker(new URL("./expecti.worker.js", import.meta.url));
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      fn();
    };
    worker.on("message", (msg: WorkerResponse) => {
      if (msg.ok) finish(() => resolve(msg.command));
      else finish(() => reject(new Error(`expecti worker failed: ${msg.error}`)));
    });
    worker.on("error", (err) => finish(() => reject(err)));
    worker.on("exit", (code) => {
      finish(() =>
        reject(new Error(`expecti worker exited before returning a command (code ${code})`))
      );
    });
    worker.postMessage({ observed, seat, opts, map });
  });
}
