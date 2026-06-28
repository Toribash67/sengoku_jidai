import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadMapProfile } from "../src/mapProfile.js";
import { runMapPipeline } from "../src/mapPipeline.js";
import { fileURLToPath } from "node:url";

describe("runMapPipeline", () => {
  it("generates two textures, writes intermediates + a webp, returns paths", async () => {
    const profile = loadMapProfile(fileURLToPath(new URL("../profiles/map.json", import.meta.url)));
    // Shrink for a fast test.
    profile.base.outputSize = { width: 32, height: 36 };

    // Each fal call returns a distinct solid PNG so we can tell land/sea apart if needed.
    const png = async (r: number, g: number, b: number) =>
      await sharp({ create: { width: 32, height: 36, channels: 3, background: { r, g, b } } })
        .png()
        .toBuffer();
    const subscribe = vi
      .fn()
      .mockResolvedValueOnce({ data: { images: [{ url: "https://o/land.png" }] } })
      .mockResolvedValueOnce({ data: { images: [{ url: "https://o/sea.png" }] } });
    const fal = { storage: { upload: vi.fn() }, subscribe };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => (await png(0, 180, 0)).buffer
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => (await png(0, 0, 180)).buffer
      });

    const outDir = mkdtempSync(join(tmpdir(), "terrain-"));
    const res = await runMapPipeline({ fal, fetch }, { mapId: "rivers", profile, outDir });

    expect(subscribe).toHaveBeenCalledTimes(2); // land + sea, t2i
    for (const f of [
      "landMask.png",
      "coastStroke.png",
      "land.png",
      "sea.png",
      "composite.png",
      "background.webp"
    ]) {
      expect(existsSync(join(outDir, f))).toBe(true);
    }
    expect(res.webpPath).toBe(join(outDir, "background.webp"));
    // Final webp is a valid image of the requested size.
    const meta = await sharp(readFileSync(res.webpPath)).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(36);
  });
});
