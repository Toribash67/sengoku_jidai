/**
 * Committed terrain background assets, keyed by map id. Discovered via Vite's glob so a
 * map without a generated asset is simply absent (graceful fallback to flat tile fills).
 * Each module's key is its source path; the value is the emitted asset URL.
 */
const TERRAIN_MODULES = import.meta.glob("../../assets/terrain/*.webp", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

/** Pure lookup: find the terrain URL whose filename matches `<mapId>.webp`, else null. */
export function resolveTerrain(modules: Record<string, string>, mapId: string): string | null {
  const suffix = `/${mapId}.webp`;
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
