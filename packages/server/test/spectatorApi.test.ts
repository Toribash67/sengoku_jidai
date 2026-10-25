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
    payload: { mode: "hotseat", seed: "spectator" }
  });
  const body = created.json();
  const tokenOf = (seat: string) =>
    body.seats.find((s: { seat: string }) => s.seat === seat).token as string;
  return { gameId: body.gameId as string, red: tokenOf("red"), black: tokenOf("black") };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function spectators(app: ReturnType<typeof buildApp>, gameId: string, token: string) {
  return app.inject({
    method: "GET",
    url: `/api/games/${gameId}/spectators`,
    headers: auth(token)
  });
}

describe("spectator API", () => {
  it("players get a stable spectator token; an existing game without one gets it lazily", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    const r = await spectators(app, game.gameId, game.red);
    const b = await spectators(app, game.gameId, game.black);
    const again = await spectators(app, game.gameId, game.red);
    expect(r.statusCode).toBe(200);
    expect(r.json().count).toBe(0);
    expect(r.json().spectatorToken).toBeTruthy();
    expect(b.json().spectatorToken).toBe(r.json().spectatorToken);
    expect(again.json().spectatorToken).toBe(r.json().spectatorToken);
  });

  it("spectator reads view, events and chat", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/chat`,
      headers: auth(game.red),
      payload: { text: "hello" }
    });
    const token = (await spectators(app, game.gameId, game.red)).json().spectatorToken;

    const watch = await app.inject({
      method: "GET",
      url: `/api/watch/${game.gameId}`,
      headers: auth(token)
    });
    expect(watch.statusCode).toBe(200);
    expect(watch.json().view.spectator).toBe(true);
    expect(watch.json().view.hand).toEqual([]);

    const events = await app.inject({
      method: "GET",
      url: `/api/watch/${game.gameId}/events?after=0`,
      headers: auth(token)
    });
    expect(events.statusCode).toBe(200);
    expect(Array.isArray(events.json().events)).toBe(true);
    expect(events.json().revisions).toHaveLength(events.json().events.length);

    const chat = await app.inject({
      method: "GET",
      url: `/api/watch/${game.gameId}/chat`,
      headers: auth(token)
    });
    const seatChat = await app.inject({
      method: "GET",
      url: `/api/games/${game.gameId}/chat`,
      headers: auth(game.red)
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().messages).toHaveLength(1);
    expect(chat.json()).toEqual(seatChat.json());
  });

  it("spectator token cannot act or read as a seat", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    const token = (await spectators(app, game.gameId, game.red)).json().spectatorToken;
    const h = auth(token);
    const id = game.gameId;
    const before = (
      await app.inject({ method: "GET", url: `/api/games/${id}`, headers: auth(game.red) })
    ).json().revision;

    const calls = [
      { method: "GET", url: `/api/games/${id}` },
      {
        method: "POST",
        url: `/api/games/${id}/commands`,
        payload: {
          baseRevision: before,
          clientCommandId: "c1",
          command: { type: "pass" }
        }
      },
      { method: "POST", url: `/api/games/${id}/claim`, payload: { name: "x" } },
      { method: "POST", url: `/api/games/${id}/chat`, payload: { text: "hi" } },
      { method: "GET", url: `/api/games/${id}/events` },
      { method: "GET", url: `/api/games/${id}/chat` },
      { method: "GET", url: `/api/games/${id}/spectators` }
    ] as const;
    for (const call of calls) {
      const res = await app.inject({ ...call, headers: h } as never);
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(401);
    }
    const after = (
      await app.inject({ method: "GET", url: `/api/games/${id}`, headers: auth(game.red) })
    ).json().revision;
    expect(after).toBe(before);
  });

  it("seat token cannot use watch routes", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    const res = await app.inject({
      method: "GET",
      url: `/api/watch/${game.gameId}`,
      headers: auth(game.red)
    });
    expect(res.statusCode).toBe(401);
  });

  it("spectator token is bound to its game", async () => {
    const app = buildApp(testConfig());
    const a = await createGame(app);
    const b = await createGame(app);
    const token = (await spectators(app, a.gameId, a.red)).json().spectatorToken;
    const res = await app.inject({
      method: "GET",
      url: `/api/watch/${b.gameId}`,
      headers: auth(token)
    });
    expect(res.statusCode).toBe(403);
  });

  it("count reflects distinct spectator clients", async () => {
    const app = buildApp(testConfig());
    const game = await createGame(app);
    const token = (await spectators(app, game.gameId, game.red)).json().spectatorToken;
    const watch = (client?: string) =>
      app.inject({
        method: "GET",
        url: `/api/watch/${game.gameId}`,
        headers: client ? { ...auth(token), "x-spectator-client": client } : auth(token)
      });
    await watch("aaaaaaaa1");
    await watch("bbbbbbbb2");
    expect((await spectators(app, game.gameId, game.red)).json().count).toBe(2);
    expect((await watch("x")).statusCode).toBe(200);
    expect((await watch()).statusCode).toBe(200);
    expect((await spectators(app, game.gameId, game.red)).json().count).toBe(2);
  });
});
