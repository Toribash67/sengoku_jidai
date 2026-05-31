import type {
  CreateGameResponse,
  PlayerGameViewEnvelope,
  SubmitCommandResponse
} from "@sengoku-jidai/shared";
import type { Command, PlayerGameEvent, PlayerGameView } from "@sengoku-jidai/engine";

export async function createHotseatGame(): Promise<CreateGameResponse<PlayerGameView>> {
  return request("/api/games", {
    method: "POST",
    body: JSON.stringify({ mode: "hotseat" })
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
      clientCommandId: crypto.randomUUID(),
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
