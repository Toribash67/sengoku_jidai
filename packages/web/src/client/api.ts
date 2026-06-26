import type {
  CreateGameResponse,
  PlayerGameViewEnvelope,
  SubmitCommandResponse
} from "@sengoku-jidai/shared";
import type { Command, PlayerGameEvent, PlayerGameView, SeatId } from "@sengoku-jidai/engine";

export async function createGame(input: {
  name: string;
  side: SeatId;
}): Promise<CreateGameResponse<PlayerGameView>> {
  return request("/api/games", {
    method: "POST",
    body: JSON.stringify({ mode: "private_multiplayer", name: input.name, side: input.side })
  });
}

export async function claimSeat(
  gameId: string,
  token: string,
  name: string
): Promise<PlayerGameViewEnvelope<PlayerGameView>> {
  return request(`/api/games/${gameId}/claim`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name })
  });
}

export async function fetchEvents(
  gameId: string,
  token: string,
  after: number
): Promise<{ events: PlayerGameEvent[] }> {
  return request(`/api/games/${gameId}/events?after=${after}`, {
    headers: authHeaders(token)
  });
}

export async function fetchGameView(
  gameId: string,
  token: string
): Promise<PlayerGameViewEnvelope<PlayerGameView>> {
  return request(`/api/games/${gameId}`, {
    headers: authHeaders(token)
  });
}

export async function submitCommand(
  gameId: string,
  token: string,
  baseRevision: number,
  command: Command
): Promise<SubmitCommandResponse<PlayerGameView, PlayerGameEvent>> {
  return request(`/api/games/${gameId}/commands`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      baseRevision,
      clientCommandId: createClientCommandId(),
      command
    })
  });
}

function authHeaders(token: string) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`
  };
}

function createClientCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return `cmd-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`API request failed with ${status}`);
  }
}
