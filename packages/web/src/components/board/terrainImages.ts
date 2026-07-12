import type { TerrainInfo, TerrainStatus } from "@sengoku-jidai/shared";

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

export function terrainApiUrl(mapId: string): string {
  return `/api/maps/${encodeURIComponent(mapId)}/terrain.webp`;
}

/** Pick the terrain background URL for a map: a committed asset (built-ins) always wins;
 *  a custom map uses the server-generated image only once its status is "ready". */
export function resolveTerrainUrl(args: {
  committed: string | null;
  terrain: TerrainStatus;
  mapId: string;
}): string | null {
  if (args.committed) {
    return args.committed;
  }
  return args.terrain === "ready" ? terrainApiUrl(args.mapId) : null;
}

/** Per-terrain background webp URL (many-terrains API). */
export function terrainByIdApiUrl(mapId: string, terrainId: string): string {
  return `/api/maps/${encodeURIComponent(mapId)}/terrains/${encodeURIComponent(terrainId)}.webp`;
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
  return `${terrainByIdApiUrl(args.mapId, selected.id)}?v=${encodeURIComponent(selected.updatedAt)}`;
}
