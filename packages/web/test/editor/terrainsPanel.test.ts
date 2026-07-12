import { describe, expect, it } from "vitest";
import type { TerrainInfo } from "@sengoku-jidai/shared";
import {
  canGenerate,
  generateErrorEffect,
  isGenerating,
  styleLabel
} from "../../src/components/editor/TerrainsPanel.js";

const t = (status: TerrainInfo["status"]): TerrainInfo => ({
  id: status,
  name: status,
  styleId: "antique",
  status,
  updatedAt: "2026-07-12T00:00:00Z"
});

describe("isGenerating", () => {
  it("is true when any terrain is pending", () => {
    expect(isGenerating([t("ready"), t("pending")])).toBe(true);
    expect(isGenerating([t("ready"), t("failed")])).toBe(false);
    expect(isGenerating([])).toBe(false);
  });
});

describe("canGenerate", () => {
  it("blocks when unavailable, with the config reason (highest precedence)", () => {
    const r = canGenerate({ terrains: [], unavailable: true });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/configured/);
  });
  it("blocks while a generation is pending", () => {
    const r = canGenerate({ terrains: [t("pending")], unavailable: false });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/Generating/);
  });
  it("blocks at the cap of 6", () => {
    const six = [t("ready"), t("ready"), t("ready"), t("ready"), t("ready"), t("ready")];
    const r = canGenerate({ terrains: six, unavailable: false });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/6/);
  });
  it("allows when under cap, idle, and available", () => {
    expect(canGenerate({ terrains: [t("ready")], unavailable: false })).toEqual({
      enabled: true,
      reason: null
    });
  });
});

describe("generateErrorEffect", () => {
  it("maps POST error statuses to effects", () => {
    expect(generateErrorEffect(503)).toBe("unavailable");
    expect(generateErrorEffect(422)).toBe("cap");
    expect(generateErrorEffect(409)).toBe("inProgress");
    expect(generateErrorEffect(500)).toBe("failed");
    expect(generateErrorEffect(null)).toBe("failed");
  });
});

describe("styleLabel", () => {
  it("returns the catalog label, falling back to the id", () => {
    expect(styleLabel("antique")).toBe("Antique (colour)");
    expect(styleLabel("ink")).toBe("Ink (greyscale)");
    expect(styleLabel("mystery")).toBe("mystery");
  });
});
