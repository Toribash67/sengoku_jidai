import { describe, expect, it } from "vitest";
import { IsmctsBot, onTheClock, runIsmctsInWorker } from "@sengoku-jidai/ai";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

describe("runIsmctsInWorker", () => {
  it("returns the same command as the in-process bot (serialization + determinism)", async () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const game = repo.createGame("hotseat", "12345", { creatorName: "P1", creatorSide: "red" });
    const state = repo.currentState(game.gameId);
    const seat = onTheClock(state);
    expect(seat).not.toBeNull();

    // iterations (not deadlineMs) so the result is bit-reproducible across process/worker.
    const opts = { iterations: 30, seed: "worker-test" };
    const inProcess = new IsmctsBot(opts).chooseCommand(state, seat!);
    const viaWorker = await runIsmctsInWorker(state, seat!, opts);

    expect(viaWorker).toEqual(inProcess);
    db.close();
  }, 15000);
});
