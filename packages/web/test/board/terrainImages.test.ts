import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  previewTerrainUrl,
  terrainByIdApiUrl,
  buildTerrainOptions,
  resolveTerrainOption,
  terrainByIdCacheBustedUrl,
  FLAT_TERRAIN_KEY
} from "../../src/components/board/terrainImages.js";
import type { TerrainInfo } from "@sengoku-jidai/shared";

const t = (
  id: string,
  status: TerrainInfo["status"],
  updatedAt = "2026-07-12T00:00:00Z"
): TerrainInfo => ({
  id,
  name: id,
  styleId: "antique",
  status,
  updatedAt
});

describe("terrainByIdApiUrl", () => {
  it("builds the per-terrain webp path with encoded ids", () => {
    expect(terrainByIdApiUrl("m 1", "t/1")).toBe("/api/maps/m%201/terrains/t%2F1.webp");
  });
});

describe("defaultSelection", () => {
  it("returns the first ready terrain's id", () => {
    expect(defaultSelection([t("a", "failed"), t("b", "ready"), t("c", "ready")])).toBe("b");
  });
  it("returns null when no terrain is ready", () => {
    expect(defaultSelection([t("a", "pending"), t("b", "failed")])).toBeNull();
    expect(defaultSelection([])).toBeNull();
  });
});

describe("previewTerrainUrl", () => {
  const terrains = [t("a", "ready", "2026-01-01T00:00:00Z"), t("b", "pending")];
  it("returns null for the Flat selection", () => {
    expect(previewTerrainUrl({ terrains, selectedTerrainId: null, mapId: "m1" })).toBeNull();
  });
  it("returns null when the selected terrain is missing or not ready", () => {
    expect(previewTerrainUrl({ terrains, selectedTerrainId: "b", mapId: "m1" })).toBeNull();
    expect(previewTerrainUrl({ terrains, selectedTerrainId: "zzz", mapId: "m1" })).toBeNull();
  });
  it("returns the cache-busted per-terrain url for a ready selection", () => {
    expect(previewTerrainUrl({ terrains, selectedTerrainId: "a", mapId: "m1" })).toBe(
      "/api/maps/m1/terrains/a.webp?v=2026-01-01T00%3A00%3A00Z"
    );
  });
});

describe("terrainByIdCacheBustedUrl", () => {
  it("appends the encoded updatedAt", () => {
    expect(terrainByIdCacheBustedUrl("m1", t("a", "ready", "2026-01-01T00:00:00Z"))).toBe(
      "/api/maps/m1/terrains/a.webp?v=2026-01-01T00%3A00%3A00Z"
    );
  });
});

describe("buildTerrainOptions", () => {
  it("lists Flat then ready terrains oldest-first, skipping non-ready", () => {
    const terrains = [
      t("a", "ready", "2026-01-01T00:00:00Z"),
      t("b", "pending"),
      t("c", "ready", "2026-02-02T00:00:00Z")
    ];
    const opts = buildTerrainOptions({ mapId: "m1", terrains });
    expect(opts.map((o) => o.key)).toEqual([FLAT_TERRAIN_KEY, "a", "c"]);
    expect(opts[1]).toEqual({
      key: "a",
      label: "a",
      url: "/api/maps/m1/terrains/a.webp?v=2026-01-01T00%3A00%3A00Z"
    });
  });

  it("nothing to pick yields just Flat", () => {
    expect(buildTerrainOptions({ mapId: "m1", terrains: [] })).toEqual([
      { key: FLAT_TERRAIN_KEY, label: "Flat", url: null }
    ]);
  });
});

describe("resolveTerrainOption", () => {
  const opts = buildTerrainOptions({ mapId: "m1", terrains: [t("a", "ready")] });
  it("returns the option matching the key", () => {
    expect(resolveTerrainOption(opts, "a").key).toBe("a");
  });
  it("falls back to Flat for null / stale / deleted keys", () => {
    expect(resolveTerrainOption(opts, null).key).toBe(FLAT_TERRAIN_KEY);
    expect(resolveTerrainOption(opts, "gone").key).toBe(FLAT_TERRAIN_KEY);
  });
});
