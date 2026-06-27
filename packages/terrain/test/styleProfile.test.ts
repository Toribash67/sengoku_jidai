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
    expect(profile.outputSize).toEqual({ width: 1024, height: 1160 });
    expect(typeof profile.prompt).toBe("string");
    expect(profile.seed).toBeTypeOf("number");
  });

  it("throws a clear error on an invalid profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "profile-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ prompt: "x" }));
    expect(() => loadStyleProfile(bad)).toThrow();
  });
});
