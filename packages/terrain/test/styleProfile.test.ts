import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStyleProfile } from "../src/styleProfile.js";

const ANTIQUE = fileURLToPath(new URL("../profiles/antique.json", import.meta.url));

describe("loadStyleProfile", () => {
  it("loads and validates the committed antique profile", () => {
    const profile = loadStyleProfile(ANTIQUE);
    expect(profile.outputSize).toEqual({ width: 1024, height: 1164 });
    expect(typeof profile.prompt).toBe("string");
    expect(profile.seed).toBeTypeOf("number");
    expect(profile.strength).toBeGreaterThan(0);
    expect(profile.landColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(profile.seaColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("applies defaults for optional fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "profile-"));
    const path = join(dir, "minimal.json");
    writeFileSync(
      path,
      JSON.stringify({
        model: "fal-ai/test",
        prompt: "x",
        seed: 1,
        outputSize: { width: 1024, height: 1164 }
      })
    );
    const profile = loadStyleProfile(path);
    expect(profile.strength).toBe(0.92);
    expect(profile.blurSigma).toBe(4);
    expect(profile.enableSafetyChecker).toBe(false);
  });

  it("throws a clear error on an invalid profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "profile-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ prompt: "x" }));
    expect(() => loadStyleProfile(bad)).toThrow();
  });
});
