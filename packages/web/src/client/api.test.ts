import { afterEach, describe, expect, it, vi } from "vitest";
import { claimSeat, createGame } from "./api.js";

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGame", () => {
  it("POSTs a private_multiplayer game with the name and side", async () => {
    const fetchMock = stubFetch({ gameId: "g1" });
    await createGame({ name: "Oda", side: "black" });

    const [url, init] = (fetchMock.mock.calls[0]! as unknown) as [string, RequestInit];
    expect(url).toBe("/api/games");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      mode: "private_multiplayer",
      name: "Oda",
      side: "black"
    });
  });
});

describe("claimSeat", () => {
  it("POSTs the name with a bearer token to the claim endpoint", async () => {
    const fetchMock = stubFetch({ gameId: "g1", seat: "black" });
    await claimSeat("g1", "tok", "Tokugawa");

    const [url, init] = (fetchMock.mock.calls[0]! as unknown) as [string, RequestInit];
    expect(url).toBe("/api/games/g1/claim");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Tokugawa" });
  });
});
