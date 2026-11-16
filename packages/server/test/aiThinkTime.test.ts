import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RandomBot, createAiRng } from "@sengoku-jidai/ai";
import { buildApp } from "../src/app.js";
import { resolveThinkMs } from "../src/api/routes.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

function testConfig(): ServerConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:18081",
    sqlitePath: ":memory:",
    sessionSecret: "test-session-secret",
    logLevel: "silent",
    aiMaxThinkMs: 10000
  };
}

describe("per-game AI thinking time", () => {
  it("stores the chosen thinking time with an AI game", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const g = repo.createGame("private_multiplayer", "s", {
      creatorName: "M",
      creatorSide: "red",
      aiSeats: ["black"],
      aiThinkMs: 10000
    });
    expect(repo.aiThinkMsOf(g.gameId)).toBe(10000);
    db.close();
  });

  it("stores nothing for a game without an AI seat, or without a choice", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const human = repo.createGame("private_multiplayer", "s", {
      creatorName: "M",
      aiThinkMs: 1500
    });
    const unset = repo.createGame("private_multiplayer", "s", { aiSeats: ["black"] });
    expect(repo.aiThinkMsOf(human.gameId)).toBeNull();
    expect(repo.aiThinkMsOf(unset.gameId)).toBeNull();
    expect(repo.aiThinkMsOf("no-such-game")).toBeNull();
    db.close();
  });

  it("falls back to Normal without a stored value, and clamps to the server maximum", () => {
    expect(resolveThinkMs(null, 10000)).toBe(5000);
    expect(resolveThinkMs(1500, 10000)).toBe(1500);
    expect(resolveThinkMs(10000, 3000)).toBe(3000);
    expect(resolveThinkMs(null, 3000)).toBe(3000);
    expect(resolveThinkMs(5, 10000)).toBe(5000);
    expect(resolveThinkMs(Number.NaN, 10000)).toBe(5000);
  });

  it("a database from before the column gains it without losing its games", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const old = repo.createGame("private_multiplayer", "s", { aiSeats: ["black"] });
    // Rewind to the pre-010 shape: drop the column and forget the migration.
    db.exec("ALTER TABLE games DROP COLUMN ai_think_ms");
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run("010_ai_think_ms.sql");
    runMigrations(db);
    expect(repo.aiThinkMsOf(old.gameId)).toBeNull();
    expect(repo.currentState(old.gameId).gameId).toBe(old.gameId);
    db.close();
  });

  it("POST /api/games stores the preset's milliseconds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sengoku-think-"));
    const sqlitePath = join(dir, "test.sqlite");
    const bot = new RandomBot(createAiRng(1));
    const app = buildApp(
      { ...testConfig(), sqlitePath },
      { aiPickCommandFor: () => (seat, state) => Promise.resolve(bot.chooseCommand(state, seat)) }
    );
    const post = (aiThinkTime: string) =>
      app.inject({
        method: "POST",
        url: "/api/games",
        payload: { mode: "hotseat", opponent: "ai", aiThinkTime }
      });
    const created = await post("quick");
    expect(created.statusCode).toBe(200);
    expect((await post("forever")).statusCode).toBe(400);
    await app.close();

    const db = openDatabase(sqlitePath);
    expect(new GameRepository(db).aiThinkMsOf(created.json().gameId)).toBe(1500);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the server maximum from AI_MAX_THINK_MS, defaulting to 10 s", () => {
    expect(loadConfig({}).aiMaxThinkMs).toBe(10000);
    expect(loadConfig({ AI_MAX_THINK_MS: "3000" }).aiMaxThinkMs).toBe(3000);
    expect(() => loadConfig({ AI_MAX_THINK_MS: "5" })).toThrow();
  });
});
