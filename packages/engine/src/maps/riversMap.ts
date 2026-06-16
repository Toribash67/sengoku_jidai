import type { SeatId } from "../types.js";

/**
 * Static topology for the "Rivers" board (the base General Orders: Sengoku Jidai map).
 *
 * This is the engine-owned, rules-relevant map: area ids, kinds, adjacency, and
 * scoring/supply-relevant facts. Visual layout (SVG coordinates, hit targets) is
 * owned by the web package and references these area ids.
 *
 * Source of truth is the hand-drawn `cloned_map.svg`, whose clone ids encode the
 * topology declaratively:
 *   - `move-tileN`            -> land area N (the SVG's `move` prefix == the Advance action)
 *   - `bombard/sail-tileN`    -> sea area N
 *   - `basered/baseblack-tileN` -> HQ areas
 *   - `harbor-tileN`          -> land area with a harbor
 *   - `shell-tileN`           -> coastal land area that can be Shelled from sea
 *   - `stars1/stars2-tileN`   -> value (victory) stars on the area
 *   - `pier-tileX-tileY`      -> a pier linking harbor land X to sea Y
 *
 * Connectivity is three separate networks, not one blended graph:
 *   - land <-> land  : the Advance action between touching land hexes
 *   - sea  <-> sea   : sailing between touching sea hexes
 *   - piers          : NOT movement edges. A pier is a build/launch point where a
 *                      navy can be created in the linked sea tile if one is not
 *                      already present there. Ships move purely by sea adjacency.
 *
 * The board is two land masses separated by a central sea; they have no land path
 * between them and are joined only through harbors and the navigable sea.
 */

export type AreaKind = "land" | "sea";

export interface MapArea {
  id: string;
  kind: AreaKind;
  /** HQ owner if this area is a faction headquarters, else null. */
  hq: SeatId | null;
  /** Victory-point stars on the area (0, 1, or 2). */
  valueStars: 0 | 1 | 2;
  /** Land area that can launch/build ships (endpoint of one or more piers). */
  harbor: boolean;
  /** Coastal land area that can be targeted by a Shell action from the sea. */
  shellable: boolean;
  /** Touching land neighbours reachable by the Advance action (land areas only). */
  landAdjacent: string[];
  /** Touching sea neighbours reachable by the Sail action (sea areas only). */
  seaAdjacent: string[];
  /** For harbours: sea areas where a navy may be built/launched via a pier. */
  piers: string[];
}

export interface MapDefinition {
  id: string;
  /** Human-facing name for map selection UI. */
  name: string;
  areas: Record<string, MapArea>;
}

export const riversMapId = "rivers";

function land(
  id: string,
  landAdjacent: string[],
  opts: {
    hq?: SeatId;
    valueStars?: 0 | 1 | 2;
    harbor?: boolean;
    shellable?: boolean;
    piers?: string[];
  } = {}
): MapArea {
  return {
    id,
    kind: "land",
    hq: opts.hq ?? null,
    valueStars: opts.valueStars ?? 0,
    harbor: opts.harbor ?? false,
    shellable: opts.shellable ?? false,
    landAdjacent,
    seaAdjacent: [],
    piers: opts.piers ?? []
  };
}

function sea(id: string, seaAdjacent: string[], valueStars: 0 | 1 | 2 = 0): MapArea {
  return {
    id,
    kind: "sea",
    hq: null,
    valueStars,
    harbor: false,
    shellable: false,
    landAdjacent: [],
    seaAdjacent,
    piers: []
  };
}

const areaList: MapArea[] = [
  land("tile1", ["tile6", "tile9", "tile10"]),
  land("tile2", ["tile6"], { valueStars: 1 }),
  sea("tile3", ["tile7"], 1),
  land("tile4", ["tile8"], { valueStars: 1 }),
  land("tile5", ["tile8", "tile12", "tile13"]),
  land("tile6", ["tile1", "tile2", "tile10"], { valueStars: 1, harbor: true, piers: ["tile3", "tile7"] }),
  sea("tile7", ["tile3", "tile11"], 1),
  land("tile8", ["tile4", "tile5", "tile12"], { valueStars: 1, harbor: true, piers: ["tile3", "tile7"] }),
  land("tile9", ["tile1", "tile10"], { hq: "red", harbor: true, piers: ["tile14", "tile15"] }),
  land("tile10", ["tile1", "tile6", "tile9"], { shellable: true }),
  sea("tile11", ["tile7", "tile15", "tile17"], 1),
  land("tile12", ["tile5", "tile8", "tile13"], { shellable: true }),
  land("tile13", ["tile5", "tile12"], { hq: "black", harbor: true, piers: ["tile17", "tile18"] }),
  sea("tile14", ["tile22"]),
  sea("tile15", ["tile11"], 1),
  land("tile16", ["tile19", "tile20", "tile21"], {
    valueStars: 2,
    harbor: true,
    piers: ["tile11", "tile15", "tile17"]
  }),
  sea("tile17", ["tile11"], 1),
  sea("tile18", ["tile22"]),
  land("tile19", ["tile16", "tile20"], { shellable: true }),
  land("tile20", ["tile16", "tile19", "tile21"], { valueStars: 2 }),
  land("tile21", ["tile16", "tile20"], { shellable: true }),
  sea("tile22", ["tile14", "tile18"])
];

export const riversMap: MapDefinition = {
  id: riversMapId,
  name: "Rivers",
  areas: Object.fromEntries(areaList.map((area) => [area.id, area]))
};
