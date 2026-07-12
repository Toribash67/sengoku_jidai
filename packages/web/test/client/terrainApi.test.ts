import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createTerrain, deleteTerrain, renameTerrain } from "../../src/client/api.js";

afterEach(() => vi.restoreAllMocks());

describe("createTerrain", () => {
  it("POSTs the styleId and returns the new id on 202", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ id: "t1" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createTerrain("m1", "ink")).resolves.toEqual({ id: "t1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/m1/terrains",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ styleId: "ink" }) })
    );
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
    await expect(createTerrain("m1", "antique")).rejects.toMatchObject({ status: 503 });
    await expect(createTerrain("m1", "antique")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("renameTerrain", () => {
  it("PATCHes the name and resolves on 200", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(renameTerrain("m1", "t1", "Coast")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/m1/terrains/t1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Coast" }) })
    );
  });
});

describe("deleteTerrain", () => {
  it("DELETEs and resolves on 204", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteTerrain("m1", "t1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/m1/terrains/t1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
