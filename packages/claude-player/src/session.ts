import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MapDefinition, SeatId } from "@sengoku-jidai/engine/client";

/** Everything the CLI remembers between invocations (one game at a time). */
export interface Session {
  baseUrl: string;
  gameId: string;
  token: string;
  seat: SeatId;
  map: MapDefinition;
  /** Last revision whose events were printed (by play or wait). */
  lastSeenRevision: number;
  /** Highest chat message id already printed. */
  lastChatId: number;
  /** Revision the last printed order list was computed from; `play` requires it to be current. */
  ordersRevision: number | null;
}

export class SessionError extends Error {}

export function defaultSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SENGOKU_SESSION ?? join(homedir(), ".sengoku", "session.json");
}

export function loadSession(path: string): Session {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new SessionError("No game joined yet — run `sengoku join <invite-link>` first.");
  }
  return JSON.parse(raw) as Session;
}

export function saveSession(path: string, session: Session): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
}
