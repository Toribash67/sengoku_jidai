import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { riversSource } from "@sengoku-jidai/engine";
import type { MapLibrary } from "./library.js";
import type { TerrainStore } from "./terrainStore.js";

/** Fixed id for the seeded Rivers "Ink" terrain, so re-seeding is idempotent. */
export const RIVERS_INK_TERRAIN_ID = "rivers-ink";

/**
 * Seed the default Rivers map into the library as an ordinary, editable map (rather than a
 * read-only built-in), plus its one committed terrain ("Ink") as a normal DB terrain. Idempotent:
 * skips the map when the row already exists and the terrain when Rivers already has any terrain, so
 * it is safe to run on every boot. `inkWebp` is the committed Ink art bytes, or null when
 * unavailable (the map is still seeded; the terrain is skipped).
 */
export function seedRivers(
  deps: { library: MapLibrary; store: TerrainStore },
  inkWebp: Buffer | null,
  log?: { info: (obj: object, msg: string) => void }
): void {
  const { library, store } = deps;
  if (!library.has(riversSource.id)) {
    library.insertSeed(riversSource);
    log?.info({ mapId: riversSource.id }, "Seeded default Rivers map");
  }
  if (inkWebp && store.countForMap(riversSource.id) === 0) {
    store.seedReady(RIVERS_INK_TERRAIN_ID, riversSource.id, "Ink", "ink", inkWebp);
    log?.info({ mapId: riversSource.id }, "Seeded Rivers Ink terrain");
  }
}

/**
 * Read the committed Rivers "Ink" terrain art shipped alongside the server (`../../seed` resolves
 * to `packages/server/seed` from both `src` and `dist`, mirroring the migrations layout). Returns
 * null if the asset is missing so seeding degrades to a map-only seed rather than crashing boot.
 */
export function readRiversInkSeed(): Buffer | null {
  try {
    return readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../seed/rivers-ink.webp")
    );
  } catch {
    return null;
  }
}
