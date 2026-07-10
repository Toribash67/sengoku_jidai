import { describe, expect, it } from "vitest";
import { nextTerrainUiState } from "../../src/components/editor/TerrainButton.js";

describe("nextTerrainUiState", () => {
  it("start → pending", () => {
    expect(nextTerrainUiState({ kind: "start" })).toBe("pending");
  });
  it("poll maps terrain status", () => {
    expect(nextTerrainUiState({ kind: "poll", terrain: "ready" })).toBe("ready");
    expect(nextTerrainUiState({ kind: "poll", terrain: "failed" })).toBe("failed");
    expect(nextTerrainUiState({ kind: "poll", terrain: "pending" })).toBe("pending");
    expect(nextTerrainUiState({ kind: "poll", terrain: "none" })).toBe("pending");
  });
  it("error distinguishes unavailable (503) from failure", () => {
    expect(nextTerrainUiState({ kind: "error", unavailable: true })).toBe("unavailable");
    expect(nextTerrainUiState({ kind: "error", unavailable: false })).toBe("failed");
  });
});
