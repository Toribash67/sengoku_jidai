import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { describe, expect, it, vi } from "vitest";
import type { EditDeps } from "../src/editPass.js";
import { generateTerrainWebp } from "../src/mapPipeline.js";
import type { MapProfile } from "../src/mapProfile.js";

// Real source → real (svgMarkup, map) pair that correspond (same tile ids).
const SOURCE = {
  id: "m",
  name: "Gen Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 3
};

const PROFILE: MapProfile = {
  base: {
    landColor: "#2e7d32",
    seaColor: "#1565c0",
    outputSize: { width: 64 },
    organicSigma: 2,
    coastWarp: { amplitude: 0, scale: 0.003, seed: 7 }
  },
  edit: {
    model: "fake/model",
    styleRef: "assets/style-ref.jpeg",
    resolution: "1K",
    seed: 1,
    prompt: "draw a map"
  },
  webpQuality: 80
};

function fakeDeps(): EditDeps {
  // A tiny valid PNG the edit model "returns"; the pipeline converts it to webp.
  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  return {
    fal: {
      storage: { upload: vi.fn(async () => "https://fal/uploaded") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://fal/result.png" }] } }))
    },
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        onePxPng.buffer.slice(onePxPng.byteOffset, onePxPng.byteOffset + onePxPng.length)
    }))
  };
}

describe("generateTerrainWebp", () => {
  it("runs the pipeline from a source and returns webp bytes", async () => {
    const compiled = compileHexMap(SOURCE as never);
    const svgMarkup = assembleBoardSvg(buildScene(compiled));
    const deps = fakeDeps();
    const out = await generateTerrainWebp(deps, {
      svgMarkup,
      map: compiled.definition,
      profile: PROFILE
    });
    // WebP magic: "RIFF"...."WEBP"
    expect(out.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // Uploaded exactly two images (control + style) and called the model once.
    expect(deps.fal.storage.upload).toHaveBeenCalledTimes(2);
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(1);
  });
});
