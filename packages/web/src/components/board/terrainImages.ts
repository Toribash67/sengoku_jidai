import type { TerrainStatus } from "@sengoku-jidai/shared";

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

/** SVG `<image>` geometry for a terrain background: fill the whole viewBox and stretch to it
 *  (`preserveAspectRatio="none"`) so terrain aligns with the board regardless of aspect. */
export function terrainImageAttrs(viewBox: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: viewBox.x,
    y: viewBox.y,
    width: viewBox.width,
    height: viewBox.height,
    preserveAspectRatio: "none" as const
  };
}
