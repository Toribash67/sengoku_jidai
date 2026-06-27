import type { MapDefinition } from "@sengoku-jidai/engine";

/** Control-image classes: land is white, sea (and everything outside the tiles) is black. */
export const LAND_COLOR = "#ffffff";
export const SEA_COLOR = "#000000";

/** Map every tile id in a map to its control-image colour by land/sea kind. */
export function tileColorMap(map: MapDefinition): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const area of Object.values(map.areas)) {
    colors[area.id] = area.kind === "land" ? LAND_COLOR : SEA_COLOR;
  }
  return colors;
}
