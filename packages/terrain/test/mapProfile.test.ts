import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadMapProfile, loadStyleProfile } from "../src/mapProfile.js";

describe("loadMapProfile", () => {
  it("loads the committed default map profile with an edit prompt + style ref", () => {
    const path = fileURLToPath(new URL("../profiles/map.json", import.meta.url));
    const p = loadMapProfile(path);
    expect(p.edit.prompt.length).toBeGreaterThan(0);
    expect(p.edit.styleRef?.length).toBeGreaterThan(0);
    expect(p.base.outputSize.width).toBeGreaterThan(0);
    expect(p.base.organicSigma).toBeGreaterThanOrEqual(0);
    expect(p.base.background).toBe("sea"); // custom maps default to islands-in-an-ocean
  });

  it("throws a clear error on an invalid profile", () => {
    expect(() =>
      loadMapProfile(fileURLToPath(new URL("./mapProfile.test.ts", import.meta.url)))
    ).toThrow(/Invalid map profile/);
  });
});

describe("loadStyleProfile", () => {
  it("resolves antique to the colored profile", () => {
    const p = loadStyleProfile("antique");
    expect(p.edit.styleRef).toBe("assets/texture-ref.jpeg");
    expect(p.edit.prompt.length).toBeGreaterThan(0);
  });

  it("resolves ink to the greyscale profile", () => {
    const p = loadStyleProfile("ink");
    expect(p.edit.styleRef).toBe("assets/ink-texture-ref.png");
  });

  it("throws a clear error on an unknown style id", () => {
    expect(() => loadStyleProfile("watercolour")).toThrow(/unknown terrain style/i);
  });
});
