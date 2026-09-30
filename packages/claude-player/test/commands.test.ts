import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../server/src/app.js";
import type { ServerConfig } from "../../server/src/config.js";
import { createApi } from "../src/api.js";
import { EXIT, runJoin, runPlay, runSay, runStatus, runWait, type Ctx } from "../src/commands.js";
import { main } from "../src/main.js";
import { listOrders, type Order } from "../src/orders.js";
import { loadSession } from "../src/session.js";

const config: ServerConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  webOrigin: "http://localhost:5173",
  sqlitePath: ":memory:",
  sessionSecret: "test-session-secret",
  logLevel: "silent"
};

let app: ReturnType<typeof buildApp>;
let base: string;
let dir: string;

beforeAll(async () => {
  app = buildApp(config);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  base = `http://127.0.0.1:${addr.port}`;
  dir = mkdtempSync(join(tmpdir(), "sengoku-cli-"));
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

function ctxFor(name: string): Ctx & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    sessionPath: join(dir, `${name}-${Math.random().toString(36).slice(2)}.json`),
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR ${l}`),
    sleep: async () => undefined
  };
}

async function newGame(seed: string) {
  const res = await fetch(`${base}/api/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "private_multiplayer", seed, name: "Human", side: "red" })
  });
  const body = (await res.json()) as { gameId: string; seats: { seat: string; token: string }[] };
  const link = (seat: string) =>
    `${base}/g/${body.gameId}#${body.seats.find((s) => s.seat === seat)!.token}`;
  return { gameId: body.gameId, red: link("red"), black: link("black") };
}

function minimalArgs(order: Order) {
  const t = order.template;
  if (t.kind === "move") return { from: `${t.sources[0]!.areaId}:1` };
  if (t.kind === "placement") return { place: `${t.targets[0]!}:1` };
  return {};
}

async function ordersFor(ctx: Ctx) {
  const s = loadSession(ctx.sessionPath);
  const env = await createApi(s).view();
  return { env, orders: listOrders(env.view) };
}

describe("claude-player commands against a real server", () => {
  it("join claims the seat under the given name and prints the board", async () => {
    const game = await newGame("join");
    const claude = ctxFor("claude");
    expect(await runJoin(claude, game.black, "Claude")).toBe(EXIT.ok);
    expect(claude.lines.join("\n")).toContain("You are BLACK");
    const env = await createApi(loadSession(claude.sessionPath)).view();
    expect(env.seatInfo.find((s) => s.seat === "black")).toMatchObject({
      name: "Claude",
      status: "claimed"
    });
  });

  it("play refuses when the game moved on since status", async () => {
    const game = await newGame("stale");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    const mover = (await ordersFor(red)).orders.length ? red : black;
    expect(await runStatus(mover)).toBe(EXIT.ok);
    // The game advances behind the CLI's back (same seat, direct API call).
    const { env, orders } = await ordersFor(mover);
    const pass = orders.at(-1)!.template;
    if (pass.kind !== "fixed" || pass.command.type !== "pass")
      throw new Error("expected pass last");
    const s = loadSession(mover.sessionPath);
    await createApi(s).submit(env.revision, pass.command);
    const before = (await createApi(s).view()).revision;
    expect(await runPlay(mover, 1, {})).toBe(EXIT.rejected);
    expect(mover.lines.join("\n")).toMatch(/moved on/);
    expect((await createApi(s).view()).revision).toBe(before);
  });

  it("play reports local argument errors with exit 1 and submits nothing", async () => {
    const game = await newGame("args");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    const mover = (await ordersFor(red)).orders.length ? red : black;
    expect(await runStatus(mover)).toBe(EXIT.ok);
    const { env, orders } = await ordersFor(mover);
    const move = orders.find((o) => o.template.kind === "move");
    expect(move, "opening should offer a move").toBeDefined();
    expect(await runPlay(mover, move!.n, { from: "NOPE:1" })).toBe(EXIT.local);
    expect(mover.lines.join("\n")).toMatch(/NOPE is not a legal source/);
    expect((await ordersFor(mover)).env.revision).toBe(env.revision);
  });

  it("wait times out with exit 3 while the opponent is on the clock, and survives a network error", async () => {
    const game = await newGame("wait");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    const idle = (await ordersFor(red)).orders.length ? black : red;
    const busy = idle === red ? black : red;

    expect(await runWait(idle, { timeoutSec: 0, intervalMs: 1 })).toBe(EXIT.waiting);

    // The busy seat passes; the idle seat's wait should then return 0 despite one failed fetch.
    await runStatus(busy);
    const passN = (await ordersFor(busy)).orders.at(-1)!.n;
    expect(await runPlay(busy, passN, {})).toBe(EXIT.ok);
    let failed = false;
    const flaky: typeof fetch = async (input, init) => {
      if (!failed) {
        failed = true;
        throw new TypeError("fetch failed");
      }
      return fetch(input, init);
    };
    const code = await runWait({ ...idle, fetch: flaky }, { timeoutSec: 30, intervalMs: 1 });
    expect(code).toBe(EXIT.ok);
    expect(idle.lines.join("\n")).toMatch(/passed/);
    expect(idle.lines.join("\n")).toMatch(/Your turn/);
  });

  it("wait prints the opponent's chat", async () => {
    const game = await newGame("chat");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    expect(await runSay(red, "good luck")).toBe(EXIT.ok);
    await runWait(black, { timeoutSec: 0, intervalMs: 1 });
    expect(black.lines.join("\n")).toContain("💬 red: good luck");
  });

  it("an invalid token exits 5", async () => {
    const game = await newGame("auth");
    const bad = ctxFor("bad");
    expect(await runJoin(bad, `${game.red.split("#")[0]}#not-a-token`, "X")).toBe(EXIT.auth);
  });

  it("main parses argv and dispatches", async () => {
    const game = await newGame("main");
    const lines: string[] = [];
    const io = {
      out: (l: string) => lines.push(l),
      err: (l: string) => lines.push(l),
      sleep: async () => undefined
    };
    const session = join(dir, "main.json");
    expect(await main(["join", game.black, "--name", "Claude", "--session", session], io)).toBe(
      EXIT.ok
    );
    expect(await main(["status", "--session", session], io)).toBe(EXIT.ok);
    expect(await main(["play", "abc", "--session", session], io)).toBe(EXIT.local);
    expect(lines.at(-1)).toMatch(/no order named "abc"/);
    expect(await main(["bogus"], io)).toBe(EXIT.local);
  });

  it("wait retries through 5xx responses and non-JSON error pages", async () => {
    const game = await newGame("wait-5xx");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    const idle = (await ordersFor(red)).orders.length ? black : red;
    const busy = idle === red ? black : red;
    await runStatus(busy);
    expect(await runPlay(busy, (await ordersFor(busy)).orders.at(-1)!.n, {})).toBe(EXIT.ok);
    const failures = [
      new Response("", { status: 502 }),
      new Response(JSON.stringify({ error: { code: "down", message: "down", requestId: "r" } }), {
        status: 503
      }),
      new Response("<html>Bad Gateway</html>", { status: 502 })
    ];
    const flaky: typeof fetch = async (input, init) => failures.shift() ?? fetch(input, init);
    expect(await runWait({ ...idle, fetch: flaky }, { timeoutSec: 30, intervalMs: 1 })).toBe(
      EXIT.ok
    );
    expect(failures).toHaveLength(0);
  });

  it("say rejects over-long chat locally with exit 1", async () => {
    const game = await newGame("say-long");
    const red = ctxFor("red");
    await runJoin(red, game.red, "Human");
    expect(await runSay(red, "x".repeat(501))).toBe(EXIT.local);
    expect(red.lines.join("\n")).toMatch(/500 characters/);
    const s = loadSession(red.sessionPath);
    expect((await createApi(s).chatAfter(0)).messages).toHaveLength(0);
  });

  it("wait rejects a non-numeric timeout", async () => {
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const session = join(dir, "none.json");
    expect(await main(["wait", "--timeout", "abc", "--session", session], io)).toBe(EXIT.local);
    expect(lines.join("\n")).toMatch(/--timeout/);
  });

  it("plays a whole game through the CLI with no rejected commands, then reports game over", async () => {
    const game = await newGame("full-game");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Bot A");
    await runJoin(black, game.black, "Bot B");
    let over = false;
    let namedPlays = 0;
    for (let step = 0; step < 5000 && !over; step++) {
      let acted = false;
      for (const seat of [red, black]) {
        const { env, orders } = await ordersFor(seat);
        if (env.view.status === "complete") {
          over = true;
          break;
        }
        if (!orders.length) continue;
        expect(await runStatus(seat)).toBe(EXIT.ok);
        // Combat orders go by name (as the skill advises) to cover that path end to end.
        const first = orders[0]!;
        if (first.name) namedPlays++;
        const code = await runPlay(seat, first.name ?? first.n, minimalArgs(first));
        expect([EXIT.ok, EXIT.over], seat.lines.slice(-5).join("\n")).toContain(code);
        acted = true;
        if (code === EXIT.over) over = true;
        break;
      }
      expect(acted || over, "nobody could act but the game is not over").toBe(true);
    }
    expect(over).toBe(true);
    expect(namedPlays).toBeGreaterThan(0);
    for (const seat of [red, black]) {
      expect(await runStatus(seat)).toBe(EXIT.over);
      expect(await runWait(seat, { timeoutSec: 0, intervalMs: 1 })).toBe(EXIT.over);
      expect(await runPlay(seat, 1, {})).toBe(EXIT.over);
    }
  }, 120_000);
});
