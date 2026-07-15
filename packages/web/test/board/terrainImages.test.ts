import { describe, expect, it } from "vitest";
import {
  resolveTerrain,
  builtinTerrainOptions,
  defaultSelection,
  previewTerrainUrl,
  terrainByIdApiUrl,
  buildTerrainOptions,
  resolveTerrainOption,
  terrainByIdCacheBustedUrl,
  FLAT_TERRAIN_KEY,
  ORIGINAL_TERRAIN_KEY
} from "../../src/components/board/terrainImages.js";
import type { TerrainInfo } from "@sengoku-jidai/shared";

const modules = {
  "/src/assets/rivers/background.webp": "/assets/rivers.hash.webp"
};

describe("resolveTerrain", () => {
  it("returns the asset url for a map that has terrain", () => {
    expect(resolveTerrain(modules, "rivers")).toBe("/assets/rivers.hash.webp");
  });

  it("returns null for a map with no committed terrain", () => {
    expect(resolveTerrain(modules, "mountains")).toBeNull();
  });
});

describe("builtinTerrainOptions", () => {
  const builtinModules = {
    "/src/assets/rivers/background.webp": "/assets/rivers.bg.webp",
    "/src/assets/rivers/terrain-ink.webp": "/assets/rivers.ink.webp",
    "/src/assets/rivers/terrain-antique.webp": "/assets/rivers.antique.webp",
    "/src/assets/rivers/cards/counterattack.webp": "/assets/card.webp"
  };

  it("maps terrain-<style>.webp to a capitalised, key-sorted option", () => {
    expect(builtinTerrainOptions(builtinModules, "rivers")).toEqual([
      { key: "builtin-antique", label: "Antique", url: "/assets/rivers.antique.webp" },
      { key: "builtin-ink", label: "Ink", url: "/assets/rivers.ink.webp" }
    ]);
  });

  it("ignores background.webp and nested card assets", () => {
    const keys = builtinTerrainOptions(builtinModules, "rivers").map((o) => o.key);
    expect(keys).not.toContain("builtin-background");
    expect(keys).not.toContain("builtin-counterattack");
  });

  it("returns nothing for a map with no alternate built-in terrains", () => {
    expect(builtinTerrainOptions(builtinModules, "mountains")).toEqual([]);
  });
});

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
  it("built-in with a committed asset yields Flat + Original", () => {
    const opts = buildTerrainOptions({
      mapId: "rivers",
      committed: "/a/rivers.webp",
      terrains: []
    });
    expect(opts).toEqual([
      { key: FLAT_TERRAIN_KEY, label: "Flat", url: null },
      { key: ORIGINAL_TERRAIN_KEY, label: "Original", url: "/a/rivers.webp" }
    ]);
  });

  it("built-in with committed asset + alternate styles yields Flat + Original + the styles", () => {
    const opts = buildTerrainOptions({
      mapId: "rivers",
      committed: "/a/rivers.webp",
      builtins: [{ key: "builtin-ink", label: "Ink", url: "/a/rivers.ink.webp" }],
      terrains: []
    });
    expect(opts).toEqual([
      { key: FLAT_TERRAIN_KEY, label: "Flat", url: null },
      { key: ORIGINAL_TERRAIN_KEY, label: "Original", url: "/a/rivers.webp" },
      { key: "builtin-ink", label: "Ink", url: "/a/rivers.ink.webp" }
    ]);
  });

  it("custom map lists Flat then ready terrains oldest-first, skipping non-ready", () => {
    const terrains = [
      t("a", "ready", "2026-01-01T00:00:00Z"),
      t("b", "pending"),
      t("c", "ready", "2026-02-02T00:00:00Z")
    ];
    const opts = buildTerrainOptions({ mapId: "m1", committed: null, terrains });
    expect(opts.map((o) => o.key)).toEqual([FLAT_TERRAIN_KEY, "a", "c"]);
    expect(opts[1]).toEqual({
      key: "a",
      label: "a",
      url: "/api/maps/m1/terrains/a.webp?v=2026-01-01T00%3A00%3A00Z"
    });
  });

  it("nothing to pick yields just Flat", () => {
    expect(buildTerrainOptions({ mapId: "m1", committed: null, terrains: [] })).toEqual([
      { key: FLAT_TERRAIN_KEY, label: "Flat", url: null }
    ]);
  });
});

describe("resolveTerrainOption", () => {
  const opts = buildTerrainOptions({ mapId: "m1", committed: null, terrains: [t("a", "ready")] });
  it("returns the option matching the key", () => {
    expect(resolveTerrainOption(opts, "a").key).toBe("a");
  });
  it("falls back to Flat for null / stale / deleted keys", () => {
    expect(resolveTerrainOption(opts, null).key).toBe(FLAT_TERRAIN_KEY);
    expect(resolveTerrainOption(opts, "gone").key).toBe(FLAT_TERRAIN_KEY);
  });
});
