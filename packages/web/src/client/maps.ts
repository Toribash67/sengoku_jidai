import type { HexMapSource } from "@sengoku-jidai/engine/client";
import {
  compileHexMap,
  registerMap,
  riversMapId,
  riversSource
} from "@sengoku-jidai/engine/client";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { fetchMap } from "./api.js";

function buildSvg(source: HexMapSource): string {
  return assembleBoardSvg(buildScene(compileHexMap(source)));
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
