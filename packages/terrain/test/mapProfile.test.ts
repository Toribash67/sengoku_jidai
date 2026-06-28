import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadMapProfile } from "../src/mapProfile.js";

describe("loadMapProfile", () => {
  it("loads the committed default map profile with an edit prompt + style ref", () => {
    const path = fileURLToPath(new URL("../profiles/map.json", import.meta.url));
    const p = loadMapProfile(path);
    expect(p.edit.prompt.length).toBeGreaterThan(0);
    expect(p.edit.styleRef.length).toBeGreaterThan(0);
    expect(p.base.outputSize.width).toBeGreaterThan(0);
    expect(p.base.organicSigma).toBeGreaterThanOrEqual(0);
  });

  it("throws a clear error on an invalid profile", () => {
    expect(() =>
      loadMapProfile(fileURLToPath(new URL("./mapProfile.test.ts", import.meta.url)))
    ).toThrow(/Invalid map profile/);
  });
});
