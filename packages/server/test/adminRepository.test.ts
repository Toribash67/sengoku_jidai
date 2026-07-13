import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

function freshRepo() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return { db, repo: new GameRepository(db) };
}

describe("admin repository", () => {
  it("lists games with recoverable seat tokens", () => {
    const { repo } = freshRepo();
    const created = repo.createGame("private_multiplayer", "seed", {
      creatorName: "Alice",
      creatorSide: "red"
    });

    const games = repo.listGamesForAdmin();
    expect(games).toHaveLength(1);

    const game = games[0]!;
    expect(game.id).toBe(created.gameId);
    expect(game.mode).toBe("private_multiplayer");
    expect(game.seats).toHaveLength(2);

    const redSeat = game.seats.find((s) => s.seat === "red")!;
    const redToken = created.seats.find((s) => s.seat === "red")!.token;
    expect(redSeat.token).toBe(redToken);
    expect(redSeat.name).toBe("Alice");
    expect(redSeat.status).toBe("claimed");
  });

  it("hard-deletes a game and cascades to snapshots", () => {
    const { db, repo } = freshRepo();
    const created = repo.createGame("hotseat", "seed");

    expect(repo.deleteGame(created.gameId)).toBe(true);
    expect(repo.listGamesForAdmin()).toHaveLength(0);

    const snap = db
      .prepare("SELECT COUNT(*) AS n FROM game_snapshots WHERE game_id = ?")
      .get(created.gameId) as { n: number };
    expect(snap.n).toBe(0);

    expect(repo.deleteGame(created.gameId)).toBe(false);
  });
});
