import { getMap } from "@sengoku-jidai/engine/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardSvgFor, ensureMapLoaded } from "../../src/client/maps.js";

/** Minimal valid HexMapSource (client compile only; no server-side validation here). */
const CUSTOM_SOURCE = {
  id: "custom-1",
  name: "Custom One",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "A", kind: "land", hexes: [{ q: 0, r: 0 }], features: { hq: "red" } },
    { id: "B", kind: "land", hexes: [{ q: 1, r: 0 }], features: { hq: "black" } },
    { id: "C", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} }
  ],
  startingDeployment: { A: { seat: "red", troop: 3 }, B: { seat: "black", troop: 3 } },
  bonusSlots: []
};

function mockFetchOnce(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureMapLoaded", () => {
  it("resolves rivers without fetching (bundled)", async () => {
    const mock = mockFetchOnce(200, {});
    await ensureMapLoaded("rivers");
    expect(mock).not.toHaveBeenCalled();
    expect(boardSvgFor("rivers")).toContain("<svg");
  });

  it("fetches, registers, and caches a custom map once", async () => {
    const detail = {
      id: "custom-1",
      name: "Custom One",
      builtin: false,
      updatedAt: "2026-07-03T00:00:00.000Z",
      source: CUSTOM_SOURCE
    };
    const mock = mockFetchOnce(200, detail);

    await ensureMapLoaded("custom-1");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]![0]).toBe("/api/maps/custom-1");
    // Registered client-side: App's getMap(view.mapId) lookups now work.
    expect(getMap("custom-1").name).toBe("Custom One");
    expect(boardSvgFor("custom-1")).toContain("<svg");

    // Second call is a cache hit.
    await ensureMapLoaded("custom-1");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("rejects when the map fetch fails and caches nothing", async () => {
    mockFetchOnce(404, { error: { code: "mapNotFound", message: "nope", requestId: "r" } });
    await expect(ensureMapLoaded("missing-map")).rejects.toThrow();
    expect(boardSvgFor("missing-map")).toBeNull();
  });

  it("coalesces concurrent callers into one fetch", async () => {
    const detail = {
      id: "custom-coalesce",
      name: "Custom Coalesce",
      builtin: false,
      updatedAt: "2026-07-03T00:00:00.000Z",
      source: { ...CUSTOM_SOURCE, id: "custom-coalesce" }
    };
    const mock = mockFetchOnce(200, detail);

    const p1 = ensureMapLoaded("custom-coalesce");
    const p2 = ensureMapLoaded("custom-coalesce");
    await Promise.all([p1, p2]);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(boardSvgFor("custom-coalesce")).toContain("<svg");
  });

  it("allows retrying after a failed load", async () => {
    mockFetchOnce(404, { error: { code: "mapNotFound", message: "nope", requestId: "r" } });
    await expect(ensureMapLoaded("custom-retry")).rejects.toThrow();
    expect(boardSvgFor("custom-retry")).toBeNull();

    const detail = {
      id: "custom-retry",
      name: "Custom Retry",
      builtin: false,
      updatedAt: "2026-07-03T00:00:00.000Z",
      source: { ...CUSTOM_SOURCE, id: "custom-retry" }
    };
    mockFetchOnce(200, detail);

    await ensureMapLoaded("custom-retry");
    expect(boardSvgFor("custom-retry")).toContain("<svg");
  });
});
