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

  it("generate() lands in choosing with two candidates and a default name", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = service.generate(mapId, "antique");
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
    expect(store.candidateCount(id)).toBe(2);
    expect(store.list(mapId).map((t) => t.name)).toEqual(["Terrain 1"]);
  });

  it("generate() uses the requested style profile", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = service.generate(mapId, "ink");
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
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
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).not.toHaveProperty("seed");
      expect(input).not.toHaveProperty("resolution");
    }
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

  it("generate() renders two base candidates and lands in choosing", async () => {
    const { library, store, mapId } = setup();
    const deps = fakeDeps();
    const service = new TerrainService({ library, store, falKey: "k", deps });
    const id = service.generate(mapId, "fantasy");
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
    expect(store.candidateCount(id)).toBe(2);
    // Two base passes (control+style upload each), zero fort model calls at generate time.
    // Each base pass calls subscribe once → two subscribe calls total for a fort-less base.
    expect((deps.fal.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("choose() finalises the picked candidate to ready and clears candidates", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    const id = service.generate(mapId, "fantasy");
    await waitFor(() => expect(store.get(id)?.status).toBe("choosing"));
    service.choose(mapId, id, 0);
    await waitFor(() => expect(store.get(id)?.status).toBe("ready"));
    expect(store.webpById(id)?.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(store.candidateCount(id)).toBe(0);
  });
});
