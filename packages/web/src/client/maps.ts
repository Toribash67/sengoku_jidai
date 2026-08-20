import type { HexMapSource } from "@sengoku-jidai/engine/client";
import {
  compileHexMap,
  registerMap,
  riversMapId,
  riversSource
} from "@sengoku-jidai/engine/client";
import { assembleBoardSvg, buildScene, mapThumbnailSvg } from "@sengoku-jidai/board-render";
import { fetchMap } from "./api.js";

function buildSvg(source: HexMapSource): string {
  return assembleBoardSvg(buildScene(compileHexMap(source)));
}

function buildThumbnail(source: HexMapSource): string {
  return mapThumbnailSvg(buildScene(compileHexMap(source)));
}

/** Assembled board SVG per map id. Rivers is bundled (same work MapBoard's old
 *  module-level constant did); custom maps are added by `ensureMapLoaded`. */
const svgCache = new Map<string, string>([[riversMapId, buildSvg(riversSource)]]);

const pending = new Map<string, Promise<void>>();

/**
 * Make a map usable by the app: registered in the client-side engine registry
 * (so `getMap(view.mapId)` works in App/labels) and its board SVG cached for
 * `boardSvgFor`. Instant for bundled/already-loaded maps; fetches each custom
 * map at most once, coalescing concurrent callers.
 */
export async function ensureMapLoaded(mapId: string): Promise<void> {
  if (svgCache.has(mapId)) {
    return;
  }
  let load = pending.get(mapId);
  if (!load) {
    load = fetchMap(mapId)
      .then((detail) => {
        const source = detail.source as HexMapSource;
        const compiled = compileHexMap(source);
        registerMap(compiled.definition);
        svgCache.set(mapId, assembleBoardSvg(buildScene(compiled)));
      })
      .finally(() => {
        pending.delete(mapId);
      });
    pending.set(mapId, load);
  }
  return load;
}

/** Synchronous cache lookup; null until `ensureMapLoaded(mapId)` has resolved. */
export function boardSvgFor(mapId: string): string | null {
  return svgCache.get(mapId) ?? null;
}

/** Simplified land/sea preview SVG per map id (see `mapThumbnailSvg`). Rivers is bundled;
 *  custom maps are added by `ensureThumbnailLoaded`. Separate from `svgCache` because the
 *  library only needs the lightweight thumbnail, not the full feature board. */
const thumbnailCache = new Map<string, string>([[riversMapId, buildThumbnail(riversSource)]]);
const thumbnailPending = new Map<string, Promise<void>>();

/** Fetch (once) and cache a map's land/sea thumbnail. Instant for Rivers/already-loaded maps;
 *  coalesces concurrent callers, mirroring `ensureMapLoaded`. */
export async function ensureThumbnailLoaded(mapId: string): Promise<void> {
  if (thumbnailCache.has(mapId)) {
    return;
  }
  let load = thumbnailPending.get(mapId);
  if (!load) {
    load = fetchMap(mapId)
      .then((detail) => {
        thumbnailCache.set(mapId, buildThumbnail(detail.source as HexMapSource));
      })
      .finally(() => {
        thumbnailPending.delete(mapId);
      });
    thumbnailPending.set(mapId, load);
  }
  return load;
}

/** Synchronous thumbnail lookup; null until `ensureThumbnailLoaded(mapId)` has resolved. */
export function thumbnailSvgFor(mapId: string): string | null {
  return thumbnailCache.get(mapId) ?? null;
}
