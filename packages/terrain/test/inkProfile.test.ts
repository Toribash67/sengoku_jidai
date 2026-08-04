import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadMapProfile } from "../src/mapProfile.js";

describe("ink profile", () => {
  it("parses ink.json and points at a committed swatch", () => {
    const p = loadMapProfile(fileURLToPath(new URL("../profiles/ink.json", import.meta.url)));
    expect(p.edit.model).toBe("fal-ai/gpt-image-1.5/edit");
    expect(p.edit.styleRef).toBe("assets/ink-ref.jpeg");
    expect(p.edit.inputFidelity).toBe("high");
    expect(p.base.background).toBe("sea");
    expect(p.edit.prompt).toMatch(/pen-and-ink|ink map/i);
    const swatch = fileURLToPath(new URL(`../${p.edit.styleRef}`, import.meta.url));
    expect(existsSync(swatch)).toBe(true);
  });
});
