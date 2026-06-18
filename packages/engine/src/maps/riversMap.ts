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
 * Connectivity is one general adjacency graph plus a ports overlay:
 *   - adjacent       : every area sharing a border (land, sea, or mixed). Used for
 *                      movement (Advance/Sail) as well as supply, Bombard, and Shell.
 *   - ports          : NOT movement edges. A port is a build/launch point where a
 *                      navy can be created in the linked sea tile if one is not
 *                      already present there. Ships move purely by general adjacency.
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
  /** Land area that can launch/build ships (endpoint of one or more ports). */
  harbor: boolean;
  /** Coastal land area that can be targeted by a Shell action from the sea. */
  shellable: boolean;
  /** General adjacency: every area sharing a border (land, sea, or mixed). Derived from cloned_map.svg; symmetry + no-dangling enforced by riversMap.test.ts. */
  adjacent: string[];
  /** For harbours: water areas reachable via a pier (Embark placement + navy building). */
  ports: string[];
}

export interface MapDefinition {
  id: string;
  /** Human-facing name for map selection UI. */
  name: string;
  areas: Record<string, MapArea>;
  /**
   * Fixed areas that receive a randomly-assigned bonus at setup (one bonus drawn
   * per slot). The map author defines which areas qualify.
   */
  bonusSlots: string[];
}

export const riversMapId = "rivers";

function area(
  id: string,
  kind: AreaKind,
  adjacent: string[],
  opts: {
    hq?: SeatId;
    valueStars?: 0 | 1 | 2;
    harbor?: boolean;
    shellable?: boolean;
    ports?: string[];
  } = {}
): MapArea {
  return {
    id,
    kind,
    hq: opts.hq ?? null,
    valueStars: opts.valueStars ?? 0,
    harbor: opts.harbor ?? false,
    shellable: opts.shellable ?? false,
    adjacent,
    ports: opts.ports ?? []
  };
}

const areaList: MapArea[] = [
  area("tile1", "land", ["tile6", "tile9", "tile10"]),
  area("tile2", "land", ["tile6"], { valueStars: 1 }),
  area("tile3", "sea", ["tile7", "tile6", "tile8"], { valueStars: 1 }),
  area("tile4", "land", ["tile8"], { valueStars: 1 }),
  area("tile5", "land", ["tile8", "tile12", "tile13"]),
  area("tile6", "land", ["tile1", "tile2", "tile10", "tile3", "tile7"], {
    valueStars: 1,
    harbor: true,
    ports: ["tile3", "tile7"]
  }),
  area("tile7", "sea", ["tile3", "tile11", "tile6", "tile8"], { valueStars: 1 }),
  area("tile8", "land", ["tile4", "tile5", "tile12", "tile3", "tile7"], {
    valueStars: 1,
    harbor: true,
    ports: ["tile3", "tile7"]
  }),
  area("tile9", "land", ["tile1", "tile10", "tile14", "tile15"], {
    hq: "red",
    harbor: true,
    ports: ["tile14", "tile15"]
  }),
  area("tile10", "land", ["tile1", "tile6", "tile9"], { shellable: true }),
  area("tile11", "sea", ["tile7", "tile15", "tile17", "tile16"], { valueStars: 1 }),
  area("tile12", "land", ["tile5", "tile8", "tile13"], { shellable: true }),
  area("tile13", "land", ["tile5", "tile12", "tile17", "tile18"], {
    hq: "black",
    harbor: true,
    ports: ["tile17", "tile18"]
  }),
  area("tile14", "sea", ["tile22", "tile9"]),
  area("tile15", "sea", ["tile11", "tile9", "tile16"], { valueStars: 1 }),
  area("tile16", "land", ["tile19", "tile20", "tile21", "tile11", "tile15", "tile17"], {
    valueStars: 2,
    harbor: true,
    ports: ["tile11", "tile15", "tile17"]
  }),
  area("tile17", "sea", ["tile11", "tile13", "tile16"], { valueStars: 1 }),
  area("tile18", "sea", ["tile22", "tile13"]),
  area("tile19", "land", ["tile16", "tile20"], { shellable: true }),
  area("tile20", "land", ["tile16", "tile19", "tile21"], { valueStars: 2 }),
  area("tile21", "land", ["tile16", "tile20"], { shellable: true }),
  area("tile22", "sea", ["tile14", "tile18"])
];

export const riversMap: MapDefinition = {
  id: riversMapId,
  name: "Rivers",
  areas: Object.fromEntries(areaList.map((area) => [area.id, area])),
  // INTERIM placeholder slots until confirmed by the board author; change here only.
  bonusSlots: ["tile6", "tile16", "tile20"]
};
