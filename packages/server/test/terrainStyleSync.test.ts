import { describe, expect, it } from "vitest";
import { TERRAIN_STYLES } from "@sengoku-jidai/shared";
import { loadStyleProfile } from "@sengoku-jidai/terrain";

// Every catalogued style must resolve to a committed, valid profile with a non-empty prompt.
// Guards against a style added to the shared catalog but not to the terrain resolver.
describe("terrain style catalog ↔ resolver sync", () => {
  for (const style of TERRAIN_STYLES) {
    it(`resolves a profile for "${style.id}"`, () => {
      const p = loadStyleProfile(style.id);
      expect(p.edit.prompt.length).toBeGreaterThan(0);
    });
  }
});
