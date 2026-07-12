import { describe, expect, it } from "vitest";
import {
  resolveTerrain,
  resolveTerrainUrl,
  terrainApiUrl,
  defaultSelection,
  previewTerrainUrl,
  terrainByIdApiUrl
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

describe("resolveTerrainUrl", () => {
  it("prefers a committed asset (built-ins) regardless of status", () => {
    expect(
      resolveTerrainUrl({ committed: "/assets/rivers/bg.webp", terrain: "none", mapId: "rivers" })
    ).toBe("/assets/rivers/bg.webp");
  });

  it("uses the API url for a custom map only when terrain is ready", () => {
    expect(resolveTerrainUrl({ committed: null, terrain: "ready", mapId: "abc" })).toBe(
      terrainApiUrl("abc")
    );
    expect(resolveTerrainUrl({ committed: null, terrain: "pending", mapId: "abc" })).toBeNull();
    expect(resolveTerrainUrl({ committed: null, terrain: "failed", mapId: "abc" })).toBeNull();
    expect(resolveTerrainUrl({ committed: null, terrain: "none", mapId: "abc" })).toBeNull();
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
