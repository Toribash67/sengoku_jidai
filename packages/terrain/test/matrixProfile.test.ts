import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrixConfig } from "../src/matrixProfile.js";

const COMMITTED = fileURLToPath(new URL("../profiles/matrix.json", import.meta.url));

function writeConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "matrix-"));
  const path = join(dir, "matrix.json");
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

const validCandidate = {
  label: "flux-i2i-parchment",
  method: "flux-img2img",
  model: "fal-ai/flux/dev/image-to-image",
  prompt: "antique map",
  seed: 1568,
  strength: 0.9
};

const validConfig = {
  base: { landColor: "#7e8c5a", seaColor: "#566f80", outputSize: { width: 1024, height: 1164 } },
  candidates: [validCandidate]
};

describe("loadMatrixConfig", () => {
  it("loads a valid config and applies defaults", () => {
    const cfg = loadMatrixConfig(writeConfig(validConfig));
    expect(cfg.columns).toBe(3); // default
    expect(cfg.base.blurSigma).toBe(4); // default
    expect(cfg.candidates[0]!.guidanceScale).toBe(3.5); // default
    expect(cfg.candidates[0]!.numInferenceSteps).toBe(34); // default
    expect(cfg.candidates[0]!.enableSafetyChecker).toBe(false); // default
  });

  it("rejects an invalid method", () => {
    const bad = { ...validConfig, candidates: [{ ...validCandidate, method: "midjourney" }] };
    expect(() => loadMatrixConfig(writeConfig(bad))).toThrow();
  });

  it("rejects a label with illegal characters", () => {
    const bad = { ...validConfig, candidates: [{ ...validCandidate, label: "Flux I2I" }] };
    expect(() => loadMatrixConfig(writeConfig(bad))).toThrow();
  });

  it("rejects duplicate labels", () => {
    const bad = { ...validConfig, candidates: [validCandidate, validCandidate] };
    expect(() => loadMatrixConfig(writeConfig(bad))).toThrow(/duplicate|unique/i);
  });
});

describe("committed matrix.json", () => {
  it("loads, has 15 candidates and 3 columns", () => {
    const cfg = loadMatrixConfig(COMMITTED);
    expect(cfg.columns).toBe(3);
    expect(cfg.candidates).toHaveLength(15);
    // 5 distinct methods present.
    expect(new Set(cfg.candidates.map((c) => c.method)).size).toBe(5);
  });
});
