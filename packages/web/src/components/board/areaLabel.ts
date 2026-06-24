import type { MapArea } from "@sengoku-jidai/engine";

/** A short, human-readable label for an area, derived from its traits — never the raw
 *  engine id (players never see "tile9" on the board). Used for the selected-area heading
 *  and any unavoidable text reference to a tile. */
export function describeArea(mapArea: MapArea): string {
  if (mapArea.hq) {
    return mapArea.hq === "red" ? "Red HQ" : "Black HQ";
  }
  if (mapArea.kind === "sea") {
    return "Sea";
  }
  if (mapArea.harbor) {
    return "Harbour";
  }
  if (mapArea.shellable) {
    return "Coastal land";
  }
  return "Inland";
}
