import { fileURLToPath } from "node:url";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import type { BoardScene } from "@sengoku-jidai/board-render";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { compileHexMap, riversSource } from "@sengoku-jidai/engine";

/** Repo root, relative to packages/terrain/src/. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Hex source per built-in map id. The terrain structure image is derived from board-render
 * (`mapStructureSvg`) off these, exactly as the server does for custom maps — so a built-in
 * map's generated background always shares the geometry the web actually draws. Keep these
 * keys in sync with the engine's map registry (`getMap`). Future built-in maps add an entry.
 */
const SOURCE_BY_MAP: Record<string, HexMapSource> = {
  rivers: riversSource
};

/**
 * The board structure SVG *and* its scene, built once from live board-render geometry. The SVG
 * conditions the terrain control image; the scene carries fort positions for the fort pass. Both
 * derive from the same `buildScene(compileHexMap(source))` so they always agree. Throws on an
 * unknown map id.
 */
export function mapStructureScene(mapId: string): { svgMarkup: string; scene: BoardScene } {
  const source = SOURCE_BY_MAP[mapId];
  if (!source) {
    throw new Error(`Unknown map "${mapId}" — add its source to SOURCE_BY_MAP in mapSources.ts`);
  }
  const scene = buildScene(compileHexMap(source));
  return { svgMarkup: assembleBoardSvg(scene), scene };
}

/**
 * The board SVG the terrain pipeline builds its control image from, rendered from live
 * board-render geometry — identical to `boardSvgFor(mapId)` in the web client and to the
 * server's custom-map terrain path. This is the single source of truth for tile placement:
 * a committed `assets/maps/<id>/board.svg` can (and did) drift from the rendered board, which
 * stretched the generated background; deriving it here keeps the two in lockstep. Throws on an
 * unknown map id.
 */
export function mapStructureSvg(mapId: string): string {
  return mapStructureScene(mapId).svgMarkup;
}

/**
 * Board SVG path per map id (relative to repo root). This committed art file is still the
 * source for feature-glyph proportions (HQ/harbour marks in board-render's `assemble.ts`) and
 * for tests; it is NO LONGER the terrain structure source — use `mapStructureSvg` for that.
 * Keep these keys in sync with the engine's map registry (`getMap`).
 */
const SVG_BY_MAP: Record<string, string> = {
  rivers: "assets/maps/rivers/board.svg"
};

/** Absolute path to a map's board SVG. Throws on an unknown map id. */
export function mapSvgPath(mapId: string): string {
  const rel = SVG_BY_MAP[mapId];
  if (!rel) {
    throw new Error(`Unknown map "${mapId}" — add its SVG to SVG_BY_MAP in mapSources.ts`);
  }
  return repoRoot + rel;
}
