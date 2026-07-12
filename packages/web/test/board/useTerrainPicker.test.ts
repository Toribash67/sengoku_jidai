import type { MapDetail } from "@sengoku-jidai/shared";
import { describe, expect, it, vi } from "vitest";
import { fetchTerrains } from "../../src/components/board/useTerrainPicker.js";

function detail(terrains: MapDetail["terrains"]): MapDetail {
  return {
    id: "abc",
    name: "Custom",
    builtin: false,
    updatedAt: "t",
    // TODO(PR-C Task 5): drop `terrain` once MapDetail.terrain is removed.
    terrain: "none",
    terrains,
    source: {} as never
  };
}

describe("fetchTerrains", () => {
  it("returns the map's terrains", async () => {
    const ts: MapDetail["terrains"] = [
      { id: "a", name: "Terrain 1", styleId: "antique", status: "ready", updatedAt: "u" }
    ];
    expect(await fetchTerrains("abc", vi.fn(async () => detail(ts)))).toEqual(ts);
  });

  it("returns [] when the fetch fails (e.g. built-in 404)", async () => {
    const fetchDetail = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await fetchTerrains("rivers", fetchDetail)).toEqual([]);
  });
});
