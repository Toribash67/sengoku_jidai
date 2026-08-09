import { createAiRng, onTheClock, RandomBot } from "@sengoku-jidai/ai";
import { createInitialState } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

function makeRepo(): GameRepository {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return new GameRepository(db);
}

function bySeat(info: GameSeatInfo[], seat: "red" | "black"): GameSeatInfo {
  return info.find((s) => s.seat === seat)!;
}

describe("GameRepository named seats", () => {
  it("creates a named game with the chosen side claimed and the other open", () => {
    const repo = makeRepo();
    const game = repo.createGame("private_multiplayer", "seed-1", {
      creatorName: "Kenshin",
      creatorSide: "black"
    });

    expect(game.seat).toBe("black");
    expect(game.seats).toHaveLength(2); // both seat tokens returned
    expect(bySeat(game.seatInfo, "black")).toMatchObject({ name: "Kenshin", status: "claimed" });
    expect(bySeat(game.seatInfo, "red")).toMatchObject({ name: null, status: "open" });
  });

  it("defaults the creator to red and keeps legacy (unnamed) creation fully claimed", () => {
    const repo = makeRepo();
    const named = repo.createGame("private_multiplayer", "s2", { creatorName: "Oda" });
    expect(named.seat).toBe("red");
    expect(bySeat(named.seatInfo, "red")).toMatchObject({ name: "Oda", status: "claimed" });
    expect(bySeat(named.seatInfo, "black").status).toBe("open");

    const legacy = repo.createGame("hotseat", "s3");
    expect(bySeat(legacy.seatInfo, "red").status).toBe("claimed");
    expect(bySeat(legacy.seatInfo, "black").status).toBe("claimed");
  });

  it("claims the open seat by setting its name", () => {
    const repo = makeRepo();
    const game = repo.createGame("private_multiplayer", "s4", { creatorName: "Oda" });

    const claimed = repo.claimSeat(game.gameId, "black", "Takeda");
    expect(claimed).not.toBeNull();
    expect(bySeat(claimed!.seatInfo, "black")).toMatchObject({ name: "Takeda", status: "claimed" });

    // Re-claim on an already-claimed seat is a no-op on the name.
    const again = repo.claimSeat(game.gameId, "black", "Someone Else");
    expect(bySeat(again!.seatInfo, "black").name).toBe("Takeda");
  });

  it("returns null when claiming a seat in a missing game", () => {
    const repo = makeRepo();
    expect(repo.claimSeat("no-such-game", "red", "Ghost")).toBeNull();
  });
});

describe("GameRepository AI seats", () => {
  it("defaults both seats to human, and marks requested AI seats", () => {
    const repo = makeRepo(); // existing helper in this test file (in-memory db + migrations)
    const human = repo.createGame("hotseat", "seed-x");
    expect(repo.controllersOf(human.gameId)).toEqual({ red: "human", black: "human" });

    const vsAi = repo.createGame("hotseat", "seed-y", { aiSeats: ["black"] });
    expect(repo.controllersOf(vsAi.gameId)).toEqual({ red: "human", black: "ai" });
  });
});

describe("GameRepository applyAiCommand", () => {
  it("applyAiCommand advances the game at the current revision", () => {
    const repo = makeRepo();
    const g = repo.createGame("hotseat", "seed-ai", { aiSeats: ["black"] });

    // No public snapshot accessor exists yet (added in a later task), so rebuild the
    // initial state deterministically from the same seed/mode/map used by createGame.
    const state0 = createInitialState({ gameId: g.gameId, seed: "seed-ai", mode: "hotseat" });
    const seat = onTheClock(state0)!;
    const cmd = new RandomBot(createAiRng(1)).chooseCommand(state0, seat);

    const res = repo.applyAiCommand(g.gameId, seat, cmd);

    expect(res.status).toBe("accepted");
    expect(res.revision).toBe(g.revision + 1);
  });
});

describe("GameRepository event projection", () => {
  it("eventsAfter projects events per seat and drops non-public event rows", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const game = repo.createGame("hotseat", "seed-events");

    const insert = db.prepare(
      `INSERT INTO game_events (game_id, revision, sequence, event_type, event_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const now = new Date().toISOString();
    insert.run(game.gameId, 1, 0, "passed", JSON.stringify({ type: "passed", seat: "red" }), now);
    insert.run(
      game.gameId,
      1,
      1,
      "deckPeeked",
      JSON.stringify({ type: "deckPeeked", cards: ["ambush"] }),
      now
    );

    const events = repo.eventsAfter(game.gameId, "red", 0);
    expect(events).toEqual([{ type: "passed", seat: "red" }]);
  });
});
