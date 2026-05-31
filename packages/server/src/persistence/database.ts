import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SqliteDatabase = Database.Database;

export function openDatabase(sqlitePath: string): SqliteDatabase {
  if (sqlitePath !== ":memory:") {
    mkdirSync(dirname(sqlitePath), { recursive: true });
  }

  const db = new Database(sqlitePath);
  db.pragma("foreign_keys = ON");
  return db;
}

export function runMigrations(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrations = ["001_initial.sql"];
  const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");

  for (const migration of migrations) {
    const applied = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(migration) as
      | { id: string }
      | undefined;
    if (applied) {
      continue;
    }

    const sql = readFileSync(resolve(migrationDir, migration), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration,
        new Date().toISOString()
      );
    });
    apply();
  }
}
