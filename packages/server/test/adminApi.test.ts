import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

function testConfig(adminPassword?: string): ServerConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:18081",
    sqlitePath: ":memory:",
    sessionSecret: "test-session-secret",
    logLevel: "silent",
    adminPassword
  };
}

async function createGame(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/games",
    payload: { mode: "hotseat", seed: "seed" }
  });
  return res.json() as { gameId: string; seats: { seat: string; token: string }[] };
}

describe("admin API", () => {
  it("rejects a missing password with 401", async () => {
    const app = buildApp(testConfig("secret"));
    const res = await app.inject({ method: "GET", url: "/api/admin/games" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalidAdmin");
  });

  it("rejects a wrong password with 401", async () => {
    const app = buildApp(testConfig("secret"));
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer nope" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when admin is not configured", async () => {
    const app = buildApp(testConfig(undefined));
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer anything" }
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("adminDisabled");
  });

  it("lists games with recoverable tokens for the right password", async () => {
    const app = buildApp(testConfig("secret"));
    const created = await createGame(app);

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer secret" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { games } = res.json();
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe(created.gameId);
    const redSeat = games[0].seats.find((s: { seat: string }) => s.seat === "red");
    const redToken = created.seats.find((s) => s.seat === "red")!.token;
    expect(redSeat.token).toBe(redToken);
  });

  it("deletes a game and 404s on a second delete", async () => {
    const app = buildApp(testConfig("secret"));
    const created = await createGame(app);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/admin/games/${created.gameId}`,
      headers: { authorization: "Bearer secret" }
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer secret" }
    });
    expect(list.json().games).toHaveLength(0);

    const again = await app.inject({
      method: "DELETE",
      url: `/api/admin/games/${created.gameId}`,
      headers: { authorization: "Bearer secret" }
    });
    expect(again.statusCode).toBe(404);
  });
});
