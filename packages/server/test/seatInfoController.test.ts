import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

describe("getSeatInfo controller", () => {
  it("reports the AI seat as ai and the human seat as human", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const game = repo.createGame("hotseat", "1", {
      creatorName: "P1",
      creatorSide: "red",
      aiSeats: ["black"]
    });
    const info = repo.getSeatInfo(game.gameId);
    expect(info.find((s) => s.seat === "red")?.controller).toBe("human");
    expect(info.find((s) => s.seat === "black")?.controller).toBe("ai");
    db.close();
  });
});
