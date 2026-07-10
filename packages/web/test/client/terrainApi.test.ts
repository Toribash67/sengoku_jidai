import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, generateTerrain } from "../../src/client/api.js";

afterEach(() => vi.restoreAllMocks());

describe("generateTerrain", () => {
  it("resolves on 202", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ status: "pending" }) }))
    );
    await expect(generateTerrain("m1")).resolves.toBeUndefined();
  });

  it("throws ApiError with the status on 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: { code: "terrainUnavailable", message: "nope" } })
      }))
    );
    await expect(generateTerrain("m1")).rejects.toMatchObject({ status: 503 });
    await expect(generateTerrain("m1")).rejects.toBeInstanceOf(ApiError);
  });
});
