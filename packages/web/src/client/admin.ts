import type { AdminGamesResponse } from "@sengoku-jidai/shared";
import { ApiError } from "./api.js";

async function adminRequest<T>(
  url: string,
  password: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${password}`);

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

export async function fetchAdminGames(password: string): Promise<AdminGamesResponse> {
  return adminRequest("/api/admin/games", password);
}

export async function deleteAdminGame(password: string, gameId: string): Promise<void> {
  await adminRequest(`/api/admin/games/${encodeURIComponent(gameId)}`, password, {
    method: "DELETE"
  });
}
