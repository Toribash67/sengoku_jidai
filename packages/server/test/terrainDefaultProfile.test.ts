import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_STYLE } from "@sengoku-jidai/shared";
import { loadStyleProfile } from "@sengoku-jidai/terrain";

// The server's default terrain profile must be exactly the shared default style's profile,
// resolved through the terrain resolver (not a hand-built relative path).
describe("server default terrain profile", () => {
  it("uses the shared default style via loadStyleProfile", () => {
    const p = loadStyleProfile(DEFAULT_TERRAIN_STYLE);
    expect(DEFAULT_TERRAIN_STYLE).toBe("antique");
    expect(p.edit.styleRef).toBe("assets/antique-ref.jpeg");
  });
});
