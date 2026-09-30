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

async function createGame(app: ReturnType<typeof buildApp>) {
  const created = await app.inject({
    method: "POST",
    url: "/api/games",
    payload: { mode: "hotseat", seed: "chat" }
  });
  const body = created.json();
  const tokenOf = (seat: string) =>
    body.seats.find((s: { seat: string }) => s.seat === seat).token as string;
  return {
    gameId: body.gameId as string,
    activeSeat: body.view.activeSeat as "red" | "black",
    red: tokenOf("red"),
    black: tokenOf("black")
  };
}

describe("chat API", () => {
  it("posts chat from the session's seat and shows it to both seats, oldest first", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);

    const first = await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/chat`,
      headers: { authorization: `Bearer ${game.red}` },
      // A spoofed seat in the body is ignored: the seat comes from the token.
      payload: { text: "  Good luck!  ", seat: "black" }
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().message).toMatchObject({ seat: "red", text: "Good luck!", revision: 0 });

    await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/chat`,
      headers: { authorization: `Bearer ${game.black}` },
      payload: { text: "You too" }
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/chat`,
      headers: { authorization: `Bearer ${game.black}` }
    });
    expect(listed.statusCode).toBe(200);
    const messages = listed.json().messages as { id: number; seat: string; text: string }[];
    expect(messages.map((m) => [m.seat, m.text])).toEqual([
      ["red", "Good luck!"],
      ["black", "You too"]
    ]);

    const after = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/chat?after=${messages[0]!.id}`,
      headers: { authorization: `Bearer ${game.red}` }
    });
    expect(after.json().messages.map((m: { text: string }) => m.text)).toEqual(["You too"]);
    await app.close();
  });

  it("stamps chat with the current game revision", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    const token = game.activeSeat === "red" ? game.red : game.black;
    await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/commands`,
      headers: { authorization: `Bearer ${token}` },
      payload: { baseRevision: 0, clientCommandId: "c1", command: { type: "pass" } }
    });
    const posted = await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/chat`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "hi" }
    });
    expect(posted.json().message.revision).toBe(1);
    await app.close();
  });

  it("rejects empty, over-long, unauthenticated and cross-game chat", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    const other = await createGame(app);
    const post = (gameId: string, token: string | null, text: string) =>
      app.inject({
        method: "POST",
        url: `/api/games/${gameId}/chat`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: { text }
      });

    expect((await post(game.gameId, game.red, "   ")).statusCode).toBe(400);
    expect((await post(game.gameId, game.red, "x".repeat(501))).statusCode).toBe(400);
    expect((await post(game.gameId, null, "hi")).statusCode).toBe(401);
    expect((await post(game.gameId, other.red, "hi")).statusCode).toBe(403);
    const listed = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/chat`,
      headers: { authorization: `Bearer ${other.red}` }
    });
    expect(listed.statusCode).toBe(403);
    await app.close();
  });

  it("returns a revision for every event", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    const token = game.activeSeat === "red" ? game.red : game.black;
    await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/commands`,
      headers: { authorization: `Bearer ${token}` },
      payload: { baseRevision: 0, clientCommandId: "c1", command: { type: "pass" } }
    });
    const events = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/events?after=0`,
      headers: { authorization: `Bearer ${token}` }
    });
    const body = events.json() as { events: unknown[]; revisions: number[] };
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.revisions).toHaveLength(body.events.length);
    expect(body.revisions.every((r) => r === 1)).toBe(true);
    await app.close();
  });
});
