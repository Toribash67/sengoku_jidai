import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadStyleProfile } from "../src/mapProfile.js";

describe("fantasy profile", () => {
  it("resolves via style id and points at a committed swatch", () => {
    const p = loadStyleProfile("fantasy");
    expect(p.edit.model).toBe("fal-ai/gpt-image-1.5/edit");
    expect(p.edit.styleRef).toBe("assets/fantasy-texture-ref.png");
    expect(p.edit.inputFidelity).toBe("high");
    expect(p.base.background).toBe("sea");
    expect(p.edit.prompt).toMatch(/fantasy/i);
    expect(p.fortPass.inpaintPrompt).toMatch(/castle/i);
    const swatch = fileURLToPath(new URL(`../${p.edit.styleRef}`, import.meta.url));
    expect(existsSync(swatch)).toBe(true);
  });
});
