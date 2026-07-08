import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it, vi } from "vitest";
import fastify from "fastify";
import { registerApiRoutes } from "../src/api/routes.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";
import { TerrainService } from "../src/maps/terrainService.js";
import { GameRepository } from "../src/persistence/repository.js";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import type { EditDeps } from "@sengoku-jidai/terrain";

function fakeDeps(): EditDeps {
  const png = Buffer.from(
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
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length)
    }))
  };
}

function buildTestApp(opts: { falKey?: string; deps?: EditDeps } = {}) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const library = new MapLibrary(db);
  const store = new TerrainStore(db);
  // Distinguish "falKey not provided" (default "k") from an explicitly-passed
  // `undefined` (used by the 503 test to simulate no FAL_KEY configured) —
  // `opts.falKey ?? "k"` would collapse both cases to "k".
  const falKey = "falKey" in opts ? opts.falKey : "k";
  const service = new TerrainService({ library, store, falKey, deps: opts.deps ?? fakeDeps() });
  const app = fastify({ logger: false });
  registerApiRoutes(app, new GameRepository(db), library, store, service);
  return { app, library };
}

async function createMap(app: ReturnType<typeof fastify>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/maps",
    payload: structuredClone(FIXTURE_HEX_MAP)
  });
  return res.json().id as string;
}

describe("terrain API", () => {
  it("503 when no FAL_KEY is configured", async () => {
    const { app } = buildTestApp({ falKey: undefined });
    const id = await createMap(app);
    const res = await app.inject({ method: "POST", url: `/api/maps/${id}/terrain` });
    expect(res.statusCode).toBe(503);
  });

  it("404 for an unknown map", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "POST", url: "/api/maps/nope/terrain" });
    expect(res.statusCode).toBe(404);
  });

  it("403 for a built-in map", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "POST", url: "/api/maps/rivers/terrain" });
    expect(res.statusCode).toBe(403);
  });

  it("generates, reports ready, and serves the webp", async () => {
    const { app } = buildTestApp();
    const id = await createMap(app);
    const post = await app.inject({ method: "POST", url: `/api/maps/${id}/terrain` });
    expect(post.statusCode).toBe(202);
    // generation is fire-and-forget; poll the detail until ready
    let terrain = "pending";
    for (let i = 0; i < 50 && terrain !== "ready"; i++) {
      const detail = await app.inject({ method: "GET", url: `/api/maps/${id}` });
      terrain = detail.json().terrain;
      if (terrain !== "ready") await new Promise((r) => setTimeout(r, 20));
    }
    expect(terrain).toBe("ready");
    const img = await app.inject({ method: "GET", url: `/api/maps/${id}/terrain.webp` });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.rawPayload.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("404 on the webp before generation", async () => {
    const { app } = buildTestApp();
    const id = await createMap(app);
    const res = await app.inject({ method: "GET", url: `/api/maps/${id}/terrain.webp` });
    expect(res.statusCode).toBe(404);
  });

  it("409 when generation is already in progress", async () => {
    let resolveGeneration: (value: any) => void;
    const generationDeferred = new Promise((resolve) => {
      resolveGeneration = resolve;
    });

    const customDeps: EditDeps = {
      fal: {
        storage: { upload: vi.fn(async () => "https://fal/u") },
        subscribe: vi.fn(async () => generationDeferred)
      },
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64"
          );
          return png.buffer.slice(png.byteOffset, png.byteOffset + png.length);
        }
      }))
    };

    const { app } = buildTestApp({ deps: customDeps });
    const id = await createMap(app);

    // Fire the first POST - it returns 202 but generation is now in-flight
    const firstRes = await app.inject({ method: "POST", url: `/api/maps/${id}/terrain` });
    expect(firstRes.statusCode).toBe(202);

    // Generation is blocked on the deferred promise, so mapId is still in inflight
    // Fire the second POST - should get 409
    const secondRes = await app.inject({ method: "POST", url: `/api/maps/${id}/terrain` });
    expect(secondRes.statusCode).toBe(409);
    expect(secondRes.json().error.code).toBe("terrainInProgress");

    // Release the deferred promise to clean up and avoid hanging
    resolveGeneration!({ data: { images: [{ url: "https://fal/r.png" }] } });

    // Give the background generation task time to complete and clean up
    await new Promise((r) => setImmediate(r));
  });
});
