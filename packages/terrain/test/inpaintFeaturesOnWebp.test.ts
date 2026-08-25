import { compileHexMap } from "@sengoku-jidai/engine";
import { buildScene } from "@sengoku-jidai/board-render";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { EditDeps } from "../src/editPass.js";
import { inpaintFeaturesOnWebp } from "../src/mapPipeline.js";
import type { MapProfile } from "../src/mapProfile.js";

const FORT_SOURCE = {
  id: "mf",
  name: "Fort",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { fort: true } },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 3
};
// A land harbour tile beside a sea tile: the sea-facing edge gives it a port so the harbour pass
// fires.
const HARBOR_SOURCE = {
  ...FORT_SOURCE,
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { harbor: true } },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
  ]
};
// Both a fort AND a harbour (on separate land tiles) → both passes run.
const FORT_AND_HARBOR_SOURCE = {
  ...FORT_SOURCE,
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { fort: true } },
    { id: "t2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} },
    { id: "t3", kind: "land", hexes: [{ q: 2, r: 0 }], features: { harbor: true } }
  ],
  nextTileNumber: 4
};
const NO_FEATURE_SOURCE = {
  ...FORT_SOURCE,
  tiles: [{ ...FORT_SOURCE.tiles[0], features: {} }, FORT_SOURCE.tiles[1]]
};

const PROFILE = {
  base: {
    landColor: "#2e7d32",
    seaColor: "#1565c0",
    outputSize: { width: 64 },
    organicSigma: 0,
    background: "sea",
    coastWarp: { amplitude: 0, scale: 0.003, seed: 7 }
  },
  edit: { model: "fake/model", quality: "high", inputFidelity: "high", prompt: "p" },
  fortPass: {
    method: "inpaint",
    model: "fake/fill",
    inpaintPrompt: "castle",
    prompt: "m",
    markerRadiusFactor: 0.45,
    markerColor: "#ff00ff",
    maskRadiusFactor: 0.7
  },
  harborPass: {
    model: "fake/fill",
    inpaintPrompt: "fishing village",
    maskRadiusFactor: 0.7,
    coastBias: 0.6
  },
  webpQuality: 80
} as unknown as MapProfile;

function fakeDeps(): EditDeps {
  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  return {
    fal: {
      storage: { upload: vi.fn(async () => "https://fal/u") },
      subscribe: vi.fn(async () => ({ data: { images: [{ url: "https://fal/r.png" }] } }))
    },
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        onePxPng.buffer.slice(onePxPng.byteOffset, onePxPng.byteOffset + onePxPng.length)
    }))
  };
}

async function baseWebp(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#888888" } })
    .webp()
    .toBuffer();
}

describe("inpaintFeaturesOnWebp", () => {
  it("runs one inpaint call per fort and returns webp", async () => {
    const scene = buildScene(compileHexMap(FORT_SOURCE as never));
    const deps = fakeDeps();
    const out = await inpaintFeaturesOnWebp(deps, {
      webp: await baseWebp(64, 70),
      profile: PROFILE,
      scene
    });
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(1); // one fort tile
  });

  it("runs one inpaint call per harbour and returns webp", async () => {
    const scene = buildScene(compileHexMap(HARBOR_SOURCE as never));
    const deps = fakeDeps();
    const out = await inpaintFeaturesOnWebp(deps, {
      webp: await baseWebp(64, 70),
      profile: PROFILE,
      scene
    });
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(1); // one harbour tile
  });

  it("runs both the fort and harbour passes when the map has both", async () => {
    const scene = buildScene(compileHexMap(FORT_AND_HARBOR_SOURCE as never));
    const deps = fakeDeps();
    await inpaintFeaturesOnWebp(deps, { webp: await baseWebp(64, 70), profile: PROFILE, scene });
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(2); // one fort + one harbour
  });

  it("is a no-op (no model calls) when the scene has no forts or harbours", async () => {
    const scene = buildScene(compileHexMap(NO_FEATURE_SOURCE as never));
    const deps = fakeDeps();
    const input = await baseWebp(64, 70);
    const out = await inpaintFeaturesOnWebp(deps, { webp: input, profile: PROFILE, scene });
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(deps.fal.subscribe).toHaveBeenCalledTimes(0);
  });
});
