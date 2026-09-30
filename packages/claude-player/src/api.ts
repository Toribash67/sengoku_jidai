import type { Command, PlayerGameEvent, PlayerGameView } from "@sengoku-jidai/engine/client";
import type {
  ApiErrorBody,
  ChatResponse,
  EventsResponse,
  MapDetail,
  PlayerGameViewEnvelope,
  SubmitCommandResponse
} from "@sengoku-jidai/shared";

/** An HTTP error response from the game server. Network failures are NOT ApiErrors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type ViewEnvelope = PlayerGameViewEnvelope<PlayerGameView>;

export interface GameApi {
  claim(name: string): Promise<ViewEnvelope>;
  view(): Promise<ViewEnvelope>;
  submit(
    baseRevision: number,
    command: Command
  ): Promise<SubmitCommandResponse<PlayerGameView, PlayerGameEvent>>;
  eventsAfter(revision: number): Promise<EventsResponse<PlayerGameEvent>>;
  chatAfter(id: number): Promise<ChatResponse>;
  say(text: string): Promise<void>;
  map(mapId: string): Promise<MapDetail>;
}

export function createApi(
  link: { baseUrl: string; gameId: string; token: string },
  fetchImpl: typeof fetch = fetch
): GameApi {
  const game = `${link.baseUrl}/api/games/${encodeURIComponent(link.gameId)}`;
  const auth = { authorization: `Bearer ${link.token}` };

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { ...auth, ...(init.body ? { "content-type": "application/json" } : {}) }
    });
    const text = await res.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // A proxy error page (HTML) during a redeploy: keep the status, drop the body.
      if (res.ok)
        throw new ApiError(res.status, "badResponse", "The server sent a non-JSON reply.");
    }
    if (!res.ok) {
      const error = (body as Partial<ApiErrorBody>).error;
      throw new ApiError(
        res.status,
        error?.code ?? "httpError",
        error?.message ?? `HTTP ${res.status}`
      );
    }
    return body as T;
  }

  return {
    claim: (name) => call(`${game}/claim`, { method: "POST", body: JSON.stringify({ name }) }),
    view: () => call(game),
    submit: (baseRevision, command) =>
      call(`${game}/commands`, {
        method: "POST",
        body: JSON.stringify({ baseRevision, clientCommandId: crypto.randomUUID(), command })
      }),
    eventsAfter: (revision) => call(`${game}/events?after=${revision}`),
    chatAfter: (id) => call(`${game}/chat?after=${id}`),
    say: async (text) => {
      await call(`${game}/chat`, { method: "POST", body: JSON.stringify({ text }) });
    },
    map: (mapId) => call(`${link.baseUrl}/api/maps/${encodeURIComponent(mapId)}`)
  };
}
