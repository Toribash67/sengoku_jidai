import { rmSync } from "node:fs";
import { loadConfig } from "../config.js";
import { openDatabase, runMigrations } from "../persistence/database.js";

const config = loadConfig();

if (config.nodeEnv === "production") {
  throw new Error("Refusing to reset a production database.");
}

if (config.sqlitePath !== ":memory:") {
  rmSync(config.sqlitePath, { force: true });
}

const db = openDatabase(config.sqlitePath);
runMigrations(db);
db.close();
console.log(`Reset database at ${config.sqlitePath}`);
