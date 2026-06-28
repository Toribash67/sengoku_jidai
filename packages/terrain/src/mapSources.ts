import { fileURLToPath } from "node:url";

/** Repo root, relative to packages/terrain/src/. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Board SVG path per map id (relative to repo root). Keep these keys in sync with the
 * engine's map registry (`getMap`): a map known to the engine but missing here makes the
 * CLI fail at `mapSvgPath`. Future maps add an entry here.
 */
const SVG_BY_MAP: Record<string, string> = {
  rivers: "cloned_map.svg"
};

/** Absolute path to a map's board SVG. Throws on an unknown map id. */
export function mapSvgPath(mapId: string): string {
  const rel = SVG_BY_MAP[mapId];
  if (!rel) {
    throw new Error(`Unknown map "${mapId}" — add its SVG to SVG_BY_MAP in mapSources.ts`);
  }
  return repoRoot + rel;
}

/** Committed control-image asset path for a map — the flat land/sea image fed to the edit
 *  model. Generated (fal-free) by the `gen:map-control` CLI. */
export function mapControlPath(mapId: string): string {
  return fileURLToPath(new URL(`../assets/controls/${mapId}-control.png`, import.meta.url));
}
