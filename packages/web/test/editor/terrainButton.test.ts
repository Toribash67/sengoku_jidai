import { describe, expect, it } from "vitest";
import { uiFromError, uiFromStatus } from "../../src/components/editor/TerrainButton.js";

describe("uiFromStatus", () => {
  it("maps a persisted/polled terrain status to a UI state (none → idle, not pending)", () => {
    expect(uiFromStatus("ready")).toBe("ready");
    expect(uiFromStatus("pending")).toBe("pending");
    expect(uiFromStatus("failed")).toBe("failed");
    expect(uiFromStatus("none")).toBe("idle");
  });
});

describe("uiFromError", () => {
  it("distinguishes unavailable (503), already-in-progress (409), and generic failure", () => {
    expect(uiFromError(503)).toBe("unavailable");
    expect(uiFromError(409)).toBe("pending");
    expect(uiFromError(500)).toBe("failed");
    expect(uiFromError(null)).toBe("failed");
  });
});
