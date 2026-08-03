import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadStyleProfile } from "../src/mapProfile.js";

describe("fantasy profile", () => {
  it("resolves via style id and points at the committed full-reference image", () => {
    const p = loadStyleProfile("fantasy");
    expect(p.edit.model).toBe("fal-ai/gpt-image-1.5/edit");
    // Fantasy uses the full example map as its style reference (not a texture legend).
    expect(p.edit.styleRef).toBe("assets/fantasy-ref.jpeg");
    expect(p.edit.inputFidelity).toBe("high");
    expect(p.base.background).toBe("sea");
    expect(p.edit.prompt).toMatch(/fantasy/i);
    // The base pass must draw natural terrain only — forts/buildings are inpainted later.
    expect(p.edit.prompt).toMatch(/do not draw any castles/i);
    expect(p.fortPass.inpaintPrompt).toMatch(/castle/i);
    const ref = fileURLToPath(new URL(`../${p.edit.styleRef}`, import.meta.url));
    expect(existsSync(ref)).toBe(true);
  });
});
