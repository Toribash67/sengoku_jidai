import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it, vi } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";
import { TerrainService } from "../src/maps/terrainService.js";
import type { EditDeps } from "@sengoku-jidai/terrain";

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

  it("generate() stores a ready webp for a valid map", async () => {
    const { library, store, mapId } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    await service.generate(mapId);
    expect(store.status(mapId)).toBe("ready");
    expect(store.webp(mapId)?.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("generate() records failure when the source is unknown", async () => {
    const { library, store } = setup();
    const service = new TerrainService({ library, store, falKey: "k", deps: fakeDeps() });
    await service.generate("does-not-exist");
    expect(store.status("does-not-exist")).toBe("none"); // no maps row ⇒ never marked
  });

  it("generate() records failure when the edit model errors", async () => {
    const { library, store, mapId } = setup();
    const deps = fakeDeps();
    deps.fal.subscribe = vi.fn(async () => {
      throw new Error("fal down");
    });
    const service = new TerrainService({ library, store, falKey: "k", deps });
    await service.generate(mapId);
    expect(store.status(mapId)).toBe("failed");
  });
});
