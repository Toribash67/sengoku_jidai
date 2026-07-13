import type { TerrainInfo } from "@sengoku-jidai/shared";

/**
 * Committed terrain background assets, keyed by map id. Each map's background lives at
 * `assets/<mapId>/background.webp`; discovered via Vite's glob so a map without a generated
 * asset is simply absent (graceful fallback to flat tile fills).
 */
const TERRAIN_MODULES = import.meta.glob("../../assets/*/background.webp", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

/** Pure lookup: find the terrain URL whose path is `…/<mapId>/background.webp`, else null. */
export function resolveTerrain(modules: Record<string, string>, mapId: string): string | null {
  const suffix = `/${mapId}/background.webp`;
  for (const [path, url] of Object.entries(modules)) {
    if (path.endsWith(suffix)) {
      return url;
    }
  }
  return null;
}

/** Terrain background URL for a map id, or null if no asset is committed. */
export function terrainImage(mapId: string): string | null {
  return resolveTerrain(TERRAIN_MODULES, mapId);
}

/** Per-terrain background webp URL (many-terrains API). */
export function terrainByIdApiUrl(mapId: string, terrainId: string): string {
  return `/api/maps/${encodeURIComponent(mapId)}/terrains/${encodeURIComponent(terrainId)}.webp`;
}

export const FLAT_TERRAIN_KEY = "flat";
export const ORIGINAL_TERRAIN_KEY = "original";

/** One selectable terrain in the play-view picker: a stable key, a display label, and the
 *  background URL to paint (null = the Flat shaded look). */
export interface TerrainOption {
  key: string;
  label: string;
  url: string | null;
}

/** Per-terrain webp url cache-busted by updatedAt (which also keys the server ETag). */
export function terrainByIdCacheBustedUrl(mapId: string, terrain: TerrainInfo): string {
  return `${terrainByIdApiUrl(mapId, terrain.id)}?v=${encodeURIComponent(terrain.updatedAt)}`;
}

/** Play-view options: Flat first (the default), then Original for a built-in committed asset,
 *  then each READY terrain (oldest first). Pending/failed terrains are omitted. */
export function buildTerrainOptions(args: {
  mapId: string;
  committed: string | null;
  terrains: TerrainInfo[];
}): TerrainOption[] {
  const options: TerrainOption[] = [{ key: FLAT_TERRAIN_KEY, label: "Flat", url: null }];
  if (args.committed) {
    options.push({ key: ORIGINAL_TERRAIN_KEY, label: "Original", url: args.committed });
  }
  for (const terrain of args.terrains) {
    if (terrain.status === "ready") {
      options.push({
        key: terrain.id,
        label: terrain.name,
        url: terrainByIdCacheBustedUrl(args.mapId, terrain)
      });
    }
  }
  return options;
}

/** The option a persisted key selects, or the Flat option (always options[0]) if absent/stale.
 *  Falls back to a literal Flat option should an empty list ever be passed. */
export function resolveTerrainOption(options: TerrainOption[], key: string | null): TerrainOption {
  return (
    options.find((option) => option.key === key) ??
    options[0] ?? { key: FLAT_TERRAIN_KEY, label: "Flat", url: null }
  );
}

/** The id the editor preview selects on load: the first ready terrain, else null (Flat). */
export function defaultSelection(terrains: TerrainInfo[]): string | null {
  return terrains.find((terrain) => terrain.status === "ready")?.id ?? null;
}

/** The terrain background URL for the editor preview given the current selection: null for the
 *  Flat selection or a non-ready/absent terrain; otherwise the per-terrain webp cache-busted with
 *  the terrain's updatedAt (which also keys the server ETag). */
export function previewTerrainUrl(args: {
  terrains: TerrainInfo[];
  selectedTerrainId: string | null;
  mapId: string;
}): string | null {
  if (args.selectedTerrainId === null) {
    return null;
  }
  const selected = args.terrains.find((terrain) => terrain.id === args.selectedTerrainId);
  if (!selected || selected.status !== "ready") {
    return null;
  }
  return terrainByIdCacheBustedUrl(args.mapId, selected);
}
