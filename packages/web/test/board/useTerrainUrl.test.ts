import type { MapDetail } from "@sengoku-jidai/shared";
import { describe, expect, it, vi } from "vitest";
import { fetchTerrainUrl } from "../../src/components/board/useTerrainUrl.js";

function detail(terrain: MapDetail["terrain"]): MapDetail {
  return {
    id: "abc",
    name: "Custom",
    builtin: false,
    updatedAt: "t",
    terrain,
    source: {} as never
  };
}

describe("fetchTerrainUrl", () => {
  it("returns the committed asset without fetching (built-ins)", async () => {
    const fetchDetail = vi.fn();
    expect(await fetchTerrainUrl("rivers", "/assets/rivers/bg.webp", fetchDetail)).toBe(
      "/assets/rivers/bg.webp"
    );
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it("resolves the API url when a custom map is ready", async () => {
    const fetchDetail = vi.fn(async () => detail("ready"));
    expect(await fetchTerrainUrl("abc", null, fetchDetail)).toBe("/api/maps/abc/terrain.webp");
  });

  it("returns null when the map is not ready", async () => {
    const fetchDetail = vi.fn(async () => detail("pending"));
    expect(await fetchTerrainUrl("abc", null, fetchDetail)).toBeNull();
  });

  it("returns null when the fetch fails", async () => {
    const fetchDetail = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await fetchTerrainUrl("abc", null, fetchDetail)).toBeNull();
  });
});
