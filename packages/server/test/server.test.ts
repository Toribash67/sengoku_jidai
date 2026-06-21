import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

function testConfig(): ServerConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:18081",
    sqlitePath: ":memory:",
    sessionSecret: "test-session-secret",
    logLevel: "silent"
  };
}

describe("server", () => {
  it("creates a hotseat game and accepts a command", async () => {
    const app = buildApp(testConfig());

    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", seed: "test" }
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.revision).toBe(0);

    const activeSeat = body.view.activeSeat as "red" | "black";
    const token = body.seats.find((seat: { seat: string }) => seat.seat === activeSeat).token;

    const command = await app.inject({
      method: "POST",
      url: `/api/games/${body.gameId}/commands`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        baseRevision: 0,
        clientCommandId: "test-command-1",
        command: { type: "pass" }
      }
    });

    expect(command.statusCode).toBe(200);
    expect(command.json().revision).toBe(1);
    await app.close();
  });
});
