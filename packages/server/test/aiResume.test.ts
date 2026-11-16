import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RandomBot, createAiRng, onTheClock, runAlphaBetaInWorker } from "@sengoku-jidai/ai";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { buildApp } from "../src/app.js";
import { aiCommandPicker } from "../src/ai/aiEngine.js";
import type { ServerConfig } from "../src/config.js";
import { openDatabase } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

function testConfig(sqlitePath: string): ServerConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:18081",
    sqlitePath,
    sessionSecret: "test-session-secret",
    logLevel: "silent"
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("an AI turn that was interrupted", () => {
  it("is picked up again when the server starts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sj-resume-"));
    const path = join(dir, "db.sqlite");
    try {
      // First server: the AI never answers, as if the process died while it was thinking.
      const first = buildApp(testConfig(path), {
        aiPickCommandFor: () => () => new Promise(() => {})
      });
      let gameId = "";
      for (let i = 0; i < 40 && !gameId; i++) {
        const res = await first.inject({
          method: "POST",
          url: "/api/games",
          payload: { mode: "hotseat", opponent: "ai", seed: `resume-${i}` }
        });
        const body = res.json();
        if (body.view.activeSeat === "black") gameId = body.gameId; // the AI seat moves first
      }
      expect(gameId).not.toBe("");
      await tick();
      await first.close();

      const bot = new RandomBot(createAiRng(1));
      const second = buildApp(testConfig(path), {
        aiPickCommandFor: () => (seat, state) => Promise.resolve(bot.chooseCommand(state, seat))
      });
      await tick();
      await tick();
      const db = openDatabase(path);
      const state = new GameRepository(db).currentState(gameId);
      db.close();
      await second.close();
      expect(state.status !== "active" || onTheClock(state) === "red").toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("when the new search fails", () => {
  it("falls back to the previous bot instead of leaving the game stuck", async () => {
    const state = createInitialState({ gameId: "fallback", seed: "fallback" });
    const seat = state.activeSeat;
    const fallbackDeadlines: number[] = [];
    const reported: unknown[] = [];
    const pick = aiCommandPicker(
      { bot: "expecti", weights: "tuned" },
      {
        onFallback: (err) => reported.push(err),
        expecti: () => Promise.reject(new Error("worker died")),
        alphabeta: (s, who, opts) => {
          fallbackDeadlines.push(opts.deadlineMs ?? 0);
          return runAlphaBetaInWorker(s, who, { ...opts, deadlineMs: 200 });
        }
      }
    );
    const cmd = await pick(state, seat, 10000);
    expect(fallbackDeadlines).toEqual([1500]);
    expect(reported).toHaveLength(1);
    expect(resolveCommand(state, { seat }, cmd).status).toBe("accepted");
  });
});
