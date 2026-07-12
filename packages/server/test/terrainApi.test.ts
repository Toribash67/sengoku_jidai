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
  return { app, library, store };
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
    // Generation is fire-and-forget and does real sharp image work, which is markedly
    // slower on CI's shared runners — poll with a generous budget (exits as soon as ready).
    let terrain = "pending";
    for (let i = 0; i < 150 && terrain !== "ready"; i++) {
      const detail = await app.inject({ method: "GET", url: `/api/maps/${id}` });
      terrain = detail.json().terrain;
      if (terrain !== "ready") await new Promise((r) => setTimeout(r, 100));
    }
    expect(terrain).toBe("ready");
    const img = await app.inject({ method: "GET", url: `/api/maps/${id}/terrain.webp` });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.rawPayload.subarray(8, 12).toString("ascii")).toBe("WEBP");
  }, 20000);

  it("404 on the webp before generation", async () => {
    const { app } = buildTestApp();
    const id = await createMap(app);
    const res = await app.inject({ method: "GET", url: `/api/maps/${id}/terrain.webp` });
    expect(res.statusCode).toBe(404);
  });

  it("409 when generation is already in progress", async () => {
    let resolveGeneration: (value: { data: { images: { url: string }[] } }) => void;
    const generationDeferred = new Promise<{ data: { images: { url: string }[] } }>((resolve) => {
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

  it("POST /terrains creates a terrain and returns its id", async () => {
    const { app } = buildTestApp();
    const id = await createMap(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/maps/${id}/terrains`,
      payload: { styleId: "ink" }
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toEqual(expect.any(String));
  });

  it("POST /terrains rejects an invalid style with 400", async () => {
    const { app } = buildTestApp();
    const id = await createMap(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/maps/${id}/terrains`,
      payload: { styleId: "watercolour" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /terrains 422s at the cap", async () => {
    const { app, store } = buildTestApp();
    const id = await createMap(app);
    for (let i = 0; i < 6; i++) store.create(id, `Terrain ${i + 1}`, "antique");
    const res = await app.inject({ method: "POST", url: `/api/maps/${id}/terrains`, payload: {} });
    expect(res.statusCode).toBe(422);
  });

  it("PATCH renames and DELETE removes a terrain", async () => {
    const { app, store } = buildTestApp();
    const mapId = await createMap(app);
    const tid = store.create(mapId, "Terrain 1", "antique");
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/maps/${mapId}/terrains/${tid}`,
      payload: { name: "Coast" }
    });
    expect(patch.statusCode).toBe(200);
    expect(store.get(tid)?.name).toBe("Coast");
    const del = await app.inject({ method: "DELETE", url: `/api/maps/${mapId}/terrains/${tid}` });
    expect(del.statusCode).toBe(204);
    expect(store.get(tid)).toBeNull();
  });

  it("PATCH/DELETE 404 for an unknown terrain id", async () => {
    const { app } = buildTestApp();
    const mapId = await createMap(app);
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/maps/${mapId}/terrains/nope`,
      payload: { name: "X" }
    });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({ method: "DELETE", url: `/api/maps/${mapId}/terrains/nope` });
    expect(del.statusCode).toBe(404);
  });

  it("GET /terrains/:tid.webp serves a ready terrain and 404s otherwise", async () => {
    const { app, store } = buildTestApp();
    const mapId = await createMap(app);
    const tid = store.create(mapId, "Terrain 1", "antique");
    const before = await app.inject({ method: "GET", url: `/api/maps/${mapId}/terrains/${tid}.webp` });
    expect(before.statusCode).toBe(404);
    store.markReadyById(tid, Buffer.from([1, 2, 3]));
    const ok = await app.inject({ method: "GET", url: `/api/maps/${mapId}/terrains/${tid}.webp` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/webp");
  });

  it("MapDetail exposes terrains[] and the legacy terrain field", async () => {
    const { app, store } = buildTestApp();
    const mapId = await createMap(app);
    const tid = store.create(mapId, "Terrain 1", "antique");
    store.markReadyById(tid, Buffer.from([1]));
    const res = await app.inject({ method: "GET", url: `/api/maps/${mapId}` });
    const body = res.json();
    expect(body.terrain).toBe("ready"); // legacy primary status
    expect(body.terrains).toHaveLength(1);
    expect(body.terrains[0]).toMatchObject({
      id: tid,
      name: "Terrain 1",
      styleId: "antique",
      status: "ready"
    });
  });
});
