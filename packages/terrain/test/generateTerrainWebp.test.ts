import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { EditDeps } from "../src/editPass.js";
import { generateTerrainWebp } from "../src/mapPipeline.js";
import { renderLandMask } from "../src/masks.js";
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

const FORT_SOURCE = {
  id: "mf",
  name: "Fort Gen Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { fort: true } },
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
    background: "sea",
    coastWarp: { amplitude: 0, scale: 0.003, seed: 7 }
  },
  edit: {
    model: "fake/model",
    styleRef: "assets/style-ref.jpeg",
    quality: "high",
    inputFidelity: "high",
    prompt: "draw a map"
  },
  fortPass: {
    prompt: "draw a fort at each marker",
    markerRadiusFactor: 0.45,
    markerColor: "#ff00ff",
    maskRadiusFactor: 0.7
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

  it("runs a second edit pass when the scene has a fort", async () => {
    const compiled = compileHexMap(FORT_SOURCE as never);
    const scene = buildScene(compiled);
    const svgMarkup = assembleBoardSvg(scene);
    const deps = fakeDeps();
    const out = await generateTerrainWebp(deps, {
      svgMarkup,
      map: compiled.definition,
      profile: PROFILE,
      scene
    });
    expect(out.subarray(0, 4).toString("ascii")).toBe("RIFF");
    // Pass 1 (control + style) + pass 2 (marker control + mask, no style) = 2 model calls, 4 uploads.
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(2);
    expect(deps.fal.storage.upload).toHaveBeenCalledTimes(4);
  });

  it("skips the second pass when the scene has no fort", async () => {
    const compiled = compileHexMap(SOURCE as never);
    const scene = buildScene(compiled);
    const svgMarkup = assembleBoardSvg(scene);
    const deps = fakeDeps();
    await generateTerrainWebp(deps, {
      svgMarkup,
      map: compiled.definition,
      profile: PROFILE,
      scene
    });
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(1);
  });

  it("background sets the outside-tiles region; the land tile is never inverted to sea", async () => {
    const compiled = compileHexMap(SOURCE as never);
    const svgMarkup = assembleBoardSvg(buildScene(compiled));

    async function ratios(background: "land" | "sea") {
      const landMask = await renderLandMask({
        svgMarkup,
        map: compiled.definition,
        width: 64,
        height: 64,
        organicSigma: 0,
        background
      });
      const mask = await sharp(landMask).greyscale().raw().toBuffer();
      let white = 0;
      let black = 0;
      for (const v of mask) {
        if (v > 200) white += 1;
        else if (v < 50) black += 1;
      }
      expect(white + black).toBe(mask.length); // strictly binary
      return { white: white / mask.length, black: black / mask.length };
    }

    // Continent look: outside reads as land → land-dominant, sea tile still present (not inverted).
    const land = await ratios("land");
    expect(land.white).toBeGreaterThan(0.4);
    expect(land.black).toBeGreaterThan(0);

    // Islands look (the custom-map default): outside reads as sea → sea-dominant, and the land
    // tile survives as a white island rather than being swallowed (guards land→sea inversion).
    const sea = await ratios("sea");
    expect(sea.black).toBeGreaterThan(0.4);
    expect(sea.white).toBeGreaterThan(0);
  });
});
