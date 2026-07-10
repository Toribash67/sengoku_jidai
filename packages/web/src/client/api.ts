import type {
  ApiErrorBody,
  CreateGameResponse,
  ListMapsResponse,
  MapDetail,
  PlayerGameViewEnvelope,
  SubmitCommandResponse
} from "@sengoku-jidai/shared";
import type {
  Command,
  HexMapSource,
  PlayerGameEvent,
  PlayerGameView,
  SeatId
} from "@sengoku-jidai/engine/client";

export async function createGame(input: {
  name: string;
  side: SeatId;
  mapId?: string;
}): Promise<CreateGameResponse<PlayerGameView>> {
  return request("/api/games", {
    method: "POST",
    body: JSON.stringify({
      mode: "private_multiplayer",
      name: input.name,
      side: input.side,
      mapId: input.mapId
    })
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

export async function fetchMap(mapId: string): Promise<MapDetail> {
  return request(`/api/maps/${mapId}`);
}

export async function listMaps(): Promise<ListMapsResponse> {
  return request("/api/maps");
}

export async function createMap(source: HexMapSource): Promise<MapDetail> {
  return request("/api/maps", { method: "POST", body: JSON.stringify(source) });
}

export async function updateMap(mapId: string, source: HexMapSource): Promise<MapDetail> {
  return request(`/api/maps/${encodeURIComponent(mapId)}`, {
    method: "PUT",
    body: JSON.stringify(source)
  });
}

export async function deleteMap(mapId: string): Promise<void> {
  return request(`/api/maps/${encodeURIComponent(mapId)}`, { method: "DELETE" });
}

export async function generateTerrain(mapId: string): Promise<void> {
  await request(`/api/maps/${encodeURIComponent(mapId)}/terrain`, { method: "POST" });
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
  if (response.status === 204) {
    return undefined as T;
  }
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

/** Human-readable message for a failed call: the server envelope's message when present. */
export function apiErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as Partial<ApiErrorBody> | null;
    const message = body?.error?.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return caught instanceof Error ? caught.message : "Something went wrong.";
}
