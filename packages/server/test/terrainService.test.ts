import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it, vi } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";
import { TerrainService } from "../src/maps/terrainService.js";
import type { EditDeps } from "@sengoku-jidai/terrain";

// Generation is fire-and-forget and does real sharp image work, which is markedly slower under
// the full parallel suite — poll with a generous budget (exits as soon as the condition holds).
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 20000, interval: 50 });

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

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const library = new MapLibrary(db);
  const created = library.create(structuredClone(FIXTURE_HEX_MAP));
  if (!created.ok) throw new Error("fixture create failed");
  const store = new TerrainStore(db);
  return { library, store, mapId: created.value.id };
}

describe("TerrainService", () => {
  it("available() reflects whether a fal key is set", () => {
    const { library, store } = setup();
    expect(new TerrainService({ library, store, falKey: undefined }).available()).toBe(false);
    expect(new TerrainService({ library, store, falKey: "k" }).available()).toBe(true);
  });

  it("generate() creates a ready terrain and returns its id", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = service.generate(mapId, "antique");
    await waitFor(() => expect(store.get(id)?.status).toBe("ready"));
    expect(store.webpById(id)?.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(store.list(mapId).map((t) => t.name)).toEqual(["Terrain 1"]);
  });

  it("generate() uses the requested style profile", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = service.generate(mapId, "ink");
    await waitFor(() => expect(store.get(id)?.status).toBe("ready"));
    expect(store.styleIdOf(id)).toBe("ink");
  });

  it("is one-at-a-time per map (guard)", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    service.generate(mapId, "antique");
    expect(service.isGenerating(mapId)).toBe(true);
    await waitFor(() => expect(service.isGenerating(mapId)).toBe(false));
  });

  it("sends no seed/resolution — gpt-image has none and varies naturally", async () => {
    const { library, store, mapId } = setup();
    const inputs: Record<string, unknown>[] = [];
    const deps = fakeDeps();
    deps.fal.subscribe = vi.fn(async (_model: string, opts: { input: Record<string, unknown> }) => {
      inputs.push(opts.input);
      return { data: { images: [{ url: "https://fal/r.png" }] } };
    });
    const service = new TerrainService({ library, store, falKey: "k", deps });
    const id = service.generate(mapId, "antique");
    await waitFor(() => expect(store.get(id)?.status).toBe("ready"));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).not.toHaveProperty("seed");
    expect(inputs[0]).not.toHaveProperty("resolution");
  });

  it("records failure on the right terrain when the model errors", async () => {
    const { library, store, mapId } = setup();
    const deps = fakeDeps();
    deps.fal.subscribe = vi.fn(async () => {
      throw new Error("fal down");
    });
    const service = new TerrainService({ library, store, falKey: "k", deps });
    const id = service.generate(mapId, "antique");
    await waitFor(() => expect(store.get(id)?.status).toBe("failed"));
  });
});
