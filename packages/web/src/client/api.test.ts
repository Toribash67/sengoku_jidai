import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiErrorMessage,
  candidatePreviewUrl,
  chooseTerrainCandidate,
  claimSeat,
  createGame,
  createMap,
  deleteMap,
  listMaps,
  regenerateTerrainCandidates,
  updateMap
} from "./api.js";
import type { HexMapSource } from "@sengoku-jidai/engine/client";

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

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
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

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/games/g1/claim");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Tokugawa" });
  });
});

function stubFetchWithStatus(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const SOURCE: HexMapSource = {
  id: "new-map",
  name: "Test",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [{ id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} }],
  startingDeployment: {},
  bonusSlots: []
};

describe("maps api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists maps", async () => {
    const mock = stubFetchWithStatus(200, { maps: [] });
    await expect(listMaps()).resolves.toEqual({ maps: [] });
    expect(mock).toHaveBeenCalledWith("/api/maps", expect.anything());
  });

  it("creates a map with POST", async () => {
    const mock = stubFetchWithStatus(201, { id: "abc" });
    await createMap(SOURCE);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).name).toBe("Test");
  });

  it("updates a map with PUT", async () => {
    const mock = stubFetchWithStatus(200, { id: "abc" });
    await updateMap("abc", SOURCE);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps/abc");
    expect(init.method).toBe("PUT");
  });

  it("deletes a map and tolerates the empty 204 body", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body"))
    });
    vi.stubGlobal("fetch", mock);
    await expect(deleteMap("abc")).resolves.toBeUndefined();
    expect(mock.mock.calls[0]![1].method).toBe("DELETE");
  });

  it("sends mapId when creating a game", async () => {
    const mock = stubFetchWithStatus(200, { gameId: "g1" });
    await createGame({ name: "Oda", side: "red", mapId: "abc" });
    expect(JSON.parse(mock.mock.calls[0]![1].body as string).mapId).toBe("abc");
  });

  it("sends opponent in the create-game body", async () => {
    const mock = stubFetchWithStatus(200, { gameId: "g1" });
    await createGame({ name: "N", side: "red", opponent: "ai" });
    expect(JSON.parse(mock.mock.calls[0]![1].body as string).opponent).toBe("ai");
  });

  it("extracts the server error envelope message", () => {
    const err = new ApiError(409, {
      error: { code: "mapInUse", message: "Map is used by existing games.", requestId: "r" }
    });
    expect(apiErrorMessage(err)).toBe("Map is used by existing games.");
    expect(apiErrorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("terrain candidates api", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the chosen index to the choose endpoint", async () => {
    const mock = stubFetchWithStatus(202, { id: "t1" });
    await chooseTerrainCandidate("m", "t1", 0);

    const [url, init] = mock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/maps/m/terrains/t1/choose");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ index: 0 });
  });

  it("builds a cache-busted candidate preview URL with the updatedAt URL-encoded", () => {
    expect(candidatePreviewUrl("m", "t1", 1, "2026-01-02T03:04:05.000Z")).toBe(
      "/api/maps/m/terrains/t1/candidates/1.webp?v=2026-01-02T03%3A04%3A05.000Z"
    );
  });

  it("POSTs to the regenerate endpoint", async () => {
    const mock = stubFetchWithStatus(202, { id: "t1" });
    await regenerateTerrainCandidates("m", "t1");

    const [url, init] = mock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/maps/m/terrains/t1/regenerate");
    expect(init.method).toBe("POST");
  });
});
