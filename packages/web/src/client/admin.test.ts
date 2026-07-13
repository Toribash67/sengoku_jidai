import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminGames, deleteAdminGame } from "./admin.js";
import { ApiError } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAdminGames", () => {
  it("GETs the admin list with a bearer password", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ games: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdminGames("secret");
    expect(result).toEqual({ games: [] });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/games");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
  });

  it("throws ApiError on a 401", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "invalidAdmin", message: "bad" } })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminGames("wrong")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("deleteAdminGame", () => {
  it("DELETEs the game with a bearer password", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteAdminGame("secret", "g1");

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/games/g1");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
  });
});
