import { parentPort } from "node:worker_threads";
import { AlphaBetaBot, type AlphaBetaOptions } from "./bots/alphabeta.js";
import type { Command, GameState, SeatId } from "./types.js";

if (!parentPort) {
  throw new Error("alphabeta.worker must be run as a worker thread");
}

interface WorkerRequest {
  state: GameState;
  seat: SeatId;
  opts: AlphaBetaOptions;
}

export type WorkerResponse = { ok: true; command: Command } | { ok: false; error: string };

parentPort.on("message", (req: WorkerRequest) => {
  try {
    const command = new AlphaBetaBot(req.opts).chooseCommand(req.state, req.seat);
    parentPort!.postMessage({ ok: true, command } satisfies WorkerResponse);
  } catch (err) {
    parentPort!.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    } satisfies WorkerResponse);
  }
});
