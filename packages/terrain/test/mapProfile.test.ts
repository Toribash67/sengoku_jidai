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
    expect(p.edit.styleRef).toBe("assets/antique-ref.jpeg");
    expect(p.edit.prompt.length).toBeGreaterThan(0);
  });

  it("resolves ink to the greyscale profile", () => {
    const p = loadStyleProfile("ink");
    expect(p.edit.styleRef).toBe("assets/ink-ref.jpeg");
  });

  it("throws a clear error on an unknown style id", () => {
    expect(() => loadStyleProfile("watercolour")).toThrow(/unknown terrain style/i);
  });
});

describe("fortPass profile defaults", () => {
  it("fills fortPass defaults when the profile omits the block", () => {
    const profile = loadStyleProfile("antique"); // profiles/map.json has no fortPass block
    expect(profile.fortPass.markerColor).toBe("#ff00ff");
    expect(profile.fortPass.markerRadiusFactor).toBeCloseTo(0.45, 5);
    expect(profile.fortPass.maskRadiusFactor).toBeCloseTo(0.7, 5);
    expect(profile.fortPass.prompt.toLowerCase()).toContain("castle");
    // Default fort method is true-mask inpainting via FLUX Fill.
    expect(profile.fortPass.method).toBe("inpaint");
    expect(profile.fortPass.model).toBe("fal-ai/flux-pro/v1/fill");
    expect(profile.fortPass.inpaintPrompt.toLowerCase()).toContain("castle");
  });

  it("ink profile overrides the inpaint prompt for its pen-and-ink style", () => {
    const profile = loadStyleProfile("ink");
    expect(profile.fortPass.method).toBe("inpaint");
    expect(profile.fortPass.inpaintPrompt.toLowerCase()).toContain("pen-and-ink");
  });
});

describe("harborPass profile defaults", () => {
  it("fills harborPass defaults when the profile omits the block", () => {
    const profile = loadStyleProfile("antique"); // profiles/map.json has no harborPass block
    expect(profile.harborPass.model).toBe("fal-ai/flux-pro/v1/fill");
    expect(profile.harborPass.maskRadiusFactor).toBeCloseTo(0.45, 5);
    expect(profile.harborPass.coastBias).toBeCloseTo(0.5, 5);
    expect(profile.harborPass.inpaintPrompt.toLowerCase()).toContain("fishing");
  });

  it("ink profile overrides the harbour prompt for its pen-and-ink style", () => {
    const profile = loadStyleProfile("ink");
    expect(profile.harborPass.inpaintPrompt.toLowerCase()).toContain("pen-and-ink");
  });
});
