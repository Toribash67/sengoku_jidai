import {
  compileHexMap,
  type HexMapSource,
  type PlayerGameView
} from "@sengoku-jidai/engine/client";
import { ApiError, createApi, type GameApi } from "./api.js";
import { gameOverLine, renderBoard } from "./board.js";
import { formatEvent } from "./events.js";
import { LinkError, parseInviteLink } from "./link.js";
import { OrderArgError, buildCommand, listOrders, type OrderArgs } from "./orders.js";
import { SessionError, loadSession, saveSession, type Session } from "./session.js";

export const EXIT = { ok: 0, local: 1, over: 2, waiting: 3, rejected: 4, auth: 5 } as const;

export interface Ctx {
  sessionPath: string;
  out(line: string): void;
  err(line: string): void;
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

const isOver = (view: PlayerGameView) => view.status === "complete" || view.status === "abandoned";

function apiFor(ctx: Ctx, s: Pick<Session, "baseUrl" | "gameId" | "token">): GameApi {
  return createApi(s, ctx.fetch ?? fetch);
}

/** Map thrown errors to exit codes with a message Claude can act on. */
async function guarded(ctx: Ctx, fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      ctx.err(
        "The seat token was rejected — ask for a fresh invite link and run `sengoku join` again."
      );
      return EXIT.auth;
    }
    if (e instanceof ApiError) {
      ctx.err(
        `Server rejected it (${e.code}): ${e.message} — run \`sengoku status\` and try again.`
      );
      return EXIT.rejected;
    }
    if (e instanceof OrderArgError || e instanceof LinkError || e instanceof SessionError) {
      ctx.err(e.message);
      return EXIT.local;
    }
    ctx.err(`Could not reach the game server: ${(e as Error).message}`);
    return EXIT.local;
  }
}

/** Print the board + orders and remember which revision the numbering belongs to. */
function printStatus(ctx: Ctx, s: Session, view: PlayerGameView, revision: number): number {
  ctx.out(renderBoard(view, s.map, isOver(view) ? [] : listOrders(view)));
  s.ordersRevision = revision;
  saveSession(ctx.sessionPath, s);
  return isOver(view) ? EXIT.over : EXIT.ok;
}

export function runJoin(ctx: Ctx, link: string, name: string): Promise<number> {
  return guarded(ctx, async () => {
    const parsed = parseInviteLink(link);
    const api = apiFor(ctx, parsed);
    const env = await api.claim(name);
    const detail = await api.map(env.view.mapId);
    const map = compileHexMap(detail.source as HexMapSource).definition;
    const chat = await api.chatAfter(0);
    const session: Session = {
      ...parsed,
      seat: env.seat,
      map,
      lastSeenRevision: env.revision,
      lastChatId: chat.messages.at(-1)?.id ?? 0,
      ordersRevision: null
    };
    ctx.out(`Joined game ${parsed.gameId} as ${env.seat} ("${name}").`);
    for (const m of chat.messages) ctx.out(`💬 ${m.seat}: ${m.text}`);
    return printStatus(ctx, session, env.view, env.revision);
  });
}

export function runStatus(ctx: Ctx): Promise<number> {
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    const env = await apiFor(ctx, s).view();
    return printStatus(ctx, s, env.view, env.revision);
  });
}

export function runPlay(ctx: Ctx, n: number, args: OrderArgs): Promise<number> {
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    const api = apiFor(ctx, s);
    const env = await api.view();
    if (isOver(env.view)) {
      ctx.out(gameOverLine(env.view));
      return EXIT.over;
    }
    if (s.ordersRevision !== env.revision) {
      ctx.err(
        "The game has moved on since your last `sengoku status` — run it again before playing."
      );
      return EXIT.rejected;
    }
    const orders = listOrders(env.view);
    const order = orders.find((o) => o.n === n);
    if (!order) throw new OrderArgError(`There is no order ${n} (there are ${orders.length}).`);
    const command = buildCommand(order, args);
    const res = await api.submit(env.revision, command);
    ctx.out(`Played: ${order.label}`);
    for (const e of res.events ?? []) ctx.out(`  ${formatEvent(e, s.seat)}`);
    s.lastSeenRevision = res.revision;
    ctx.out("");
    const view = res.view ?? (await api.view()).view;
    return printStatus(ctx, s, view, res.revision);
  });
}

export function runWait(
  ctx: Ctx,
  opts: { timeoutSec: number; intervalMs: number }
): Promise<number> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = ctx.now ?? Date.now;
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    const api = apiFor(ctx, s);
    const deadline = now() + opts.timeoutSec * 1000;
    let reportedOutage = false;
    for (;;) {
      let view: PlayerGameView;
      try {
        const env = await api.view();
        view = env.view;
        if (env.revision !== s.lastSeenRevision) {
          const { events } = await api.eventsAfter(s.lastSeenRevision);
          for (const e of events) ctx.out(formatEvent(e, s.seat));
          s.lastSeenRevision = env.revision;
          saveSession(ctx.sessionPath, s);
        }
        const chat = await api.chatAfter(s.lastChatId);
        for (const m of chat.messages) {
          if (m.seat !== s.seat) ctx.out(`💬 ${m.seat}: ${m.text}`);
          s.lastChatId = m.id;
        }
        if (chat.messages.length) saveSession(ctx.sessionPath, s);
        reportedOutage = false;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        if (!reportedOutage) ctx.err(`Server unreachable (${(e as Error).message}) — retrying…`);
        reportedOutage = true;
        if (now() >= deadline) return EXIT.waiting;
        await sleep(opts.intervalMs);
        continue;
      }
      if (isOver(view)) {
        ctx.out(gameOverLine(view));
        return EXIT.over;
      }
      if (listOrders(view).length) {
        ctx.out("Your turn. Run `sengoku status`.");
        return EXIT.ok;
      }
      if (now() >= deadline) {
        ctx.out("Still the opponent's turn — run `sengoku wait` again.");
        return EXIT.waiting;
      }
      await sleep(opts.intervalMs);
    }
  });
}

export function runSay(ctx: Ctx, text: string): Promise<number> {
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    await apiFor(ctx, s).say(text);
    ctx.out("Sent.");
    return EXIT.ok;
  });
}
