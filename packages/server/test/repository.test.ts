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
