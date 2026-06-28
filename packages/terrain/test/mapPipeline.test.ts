import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadMapProfile } from "../src/mapProfile.js";
import { runMapPipeline } from "../src/mapPipeline.js";
import { fileURLToPath } from "node:url";

describe("runMapPipeline", () => {
  it("renders via the edit model (control + style ref), writing the control, edit + webp", async () => {
    const profile = loadMapProfile(fileURLToPath(new URL("../profiles/map.json", import.meta.url)));
    // Shrink for a fast test; the height (36) is derived from the rivers board viewBox.
    profile.base.outputSize = { width: 32 };

    const editedPng = await sharp({
      create: { width: 32, height: 36, channels: 3, background: { r: 120, g: 90, b: 40 } }
    })
      .png()
      .toBuffer();
    // One model call: the edit pass over [control, styleRef].
    const subscribe = vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
      data: { images: [{ url: "https://o/edited.png" }] }
    }));
    const fal = {
      storage: { upload: vi.fn(async () => "https://up/img.png") },
      subscribe
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array(editedPng).buffer
    }));

    const outDir = mkdtempSync(join(tmpdir(), "terrain-"));
    const res = await runMapPipeline({ fal, fetch }, { mapId: "rivers", profile, outDir });

    expect(subscribe).toHaveBeenCalledTimes(1); // single edit-model call
    expect(fal.storage.upload).toHaveBeenCalledTimes(2); // control + style reference uploaded
    // image_urls carries both uploads, ordered [control, style].
    const [model, opts] = subscribe.mock.calls[0]!;
    expect(model).toBe("fal-ai/nano-banana-pro/edit");
    expect((opts.input as { image_urls: string[] }).image_urls).toHaveLength(2);
    for (const f of ["landMask.png", "control.png", "edited.png", "background.webp"]) {
      expect(existsSync(join(outDir, f))).toBe(true);
    }
    expect(res.webpPath).toBe(join(outDir, "background.webp"));
    const meta = await sharp(readFileSync(res.webpPath)).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(36);
  });
});
