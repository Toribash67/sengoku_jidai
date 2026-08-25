import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";
import { seedRivers, RIVERS_INK_TERRAIN_ID } from "../src/maps/seedRivers.js";

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return { library: new MapLibrary(db), store: new TerrainStore(db) };
}

const INK = Buffer.from("fake-webp-bytes");

describe("seedRivers", () => {
  it("seeds Rivers as a normal (non-builtin) map with the committed Ink terrain", () => {
    const { library, store } = setup();
    seedRivers({ library, store }, INK);

    const rivers = library.get("rivers", (id) => store.list(id));
    expect(rivers).not.toBeNull();
    expect(rivers!.builtin).toBe(false);
    expect(rivers!.source.tiles.length).toBeGreaterThan(20);

    const terrains = store.list("rivers");
    expect(terrains).toHaveLength(1);
    expect(terrains[0]).toMatchObject({
      id: RIVERS_INK_TERRAIN_ID,
      name: "Ink",
      styleId: "ink",
      status: "ready"
    });
  });

  it("is idempotent — a second call adds nothing", () => {
    const { library, store } = setup();
    seedRivers({ library, store }, INK);
    seedRivers({ library, store }, INK);

    expect(library.list().filter((m) => m.id === "rivers")).toHaveLength(1);
    expect(store.list("rivers")).toHaveLength(1);
  });

  it("seeds the map even when the terrain art is unavailable", () => {
    const { library, store } = setup();
    seedRivers({ library, store }, null);

    expect(library.has("rivers")).toBe(true);
    expect(store.list("rivers")).toHaveLength(0);
  });
});
