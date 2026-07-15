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

/**
 * Committed *alternate* built-in terrains, beyond the default "Original" background. A built-in
 * map (e.g. rivers) can't hold DB terrains, so extra styles ship as static assets at
 * `assets/<mapId>/terrain-<styleKey>.webp` (e.g. `terrain-ink.webp` → an "Ink" option). The
 * `terrain-` prefix keeps them clear of `background.webp` and the nested card assets.
 */
const BUILTIN_TERRAIN_MODULES = import.meta.glob("../../assets/*/terrain-*.webp", {
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
/** Picker keys for committed alternate built-in terrains are `builtin-<styleKey>`. */
export const BUILTIN_TERRAIN_KEY_PREFIX = "builtin-";

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

/** Pure: the committed alternate built-in terrains for a map, as picker options in stable
 *  (key-sorted) order. Path convention `…/<mapId>/terrain-<styleKey>.webp` → key
 *  `builtin-<styleKey>`, label the capitalised style key (e.g. "Ink"). */
export function builtinTerrainOptions(
  modules: Record<string, string>,
  mapId: string
): TerrainOption[] {
  const marker = `/${mapId}/terrain-`;
  const found: TerrainOption[] = [];
  for (const [path, url] of Object.entries(modules)) {
    const at = path.indexOf(marker);
    if (at === -1 || !path.endsWith(".webp")) {
      continue;
    }
    const styleKey = path.slice(at + marker.length, -".webp".length);
    if (!styleKey) {
      continue;
    }
    found.push({
      key: `${BUILTIN_TERRAIN_KEY_PREFIX}${styleKey}`,
      label: styleKey.charAt(0).toUpperCase() + styleKey.slice(1),
      url
    });
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

/** Committed alternate built-in terrain options for a map id (empty if none committed). */
export function builtinTerrains(mapId: string): TerrainOption[] {
  return builtinTerrainOptions(BUILTIN_TERRAIN_MODULES, mapId);
}

/** Play-view options: Flat first (the default), then Original for a built-in committed asset,
 *  then any committed alternate built-in styles (e.g. "Ink"), then each READY terrain (oldest
 *  first). Pending/failed terrains are omitted. */
export function buildTerrainOptions(args: {
  mapId: string;
  committed: string | null;
  builtins?: TerrainOption[];
  terrains: TerrainInfo[];
}): TerrainOption[] {
  const options: TerrainOption[] = [{ key: FLAT_TERRAIN_KEY, label: "Flat", url: null }];
  if (args.committed) {
    options.push({ key: ORIGINAL_TERRAIN_KEY, label: "Original", url: args.committed });
  }
  for (const builtin of args.builtins ?? []) {
    options.push(builtin);
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
