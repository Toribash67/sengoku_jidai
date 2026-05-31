import { loadConfig } from "../config.js";
import { openDatabase, runMigrations } from "../persistence/database.js";
import { GameRepository } from "../persistence/repository.js";

const config = loadConfig();
const db = openDatabase(config.sqlitePath);
runMigrations(db);

const repository = new GameRepository(db);
const game = repository.createGame("hotseat", "seed:dev");

console.log(`Seeded game ${game.gameId}`);
for (const seat of game.seats) {
  console.log(`${seat.seat}: ${seat.token}`);
}

db.close();
