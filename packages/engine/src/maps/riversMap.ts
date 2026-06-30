import type { SeatId } from "../types.js";
import { compileHexMap } from "./hex/compile.js";
import { riversSource } from "./riversSource.js";

/** Map-driven starting unit placement for a tile (seat + counts). */
export interface StartingUnits {
  seat: SeatId;
  troop?: number;
  ship?: number;
}

/**
 * Static topology for the "Rivers" board (the base General Orders: Sengoku Jidai map).
 *
 * This is the engine-owned, rules-relevant map: area ids, kinds, adjacency, and
 * scoring/supply-relevant facts. Visual layout (SVG coordinates, hit targets) is
 * owned by the web package and references these area ids.
 *
 * Source of truth is the hand-drawn `board.svg`, whose clone ids encode the
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
  /** General adjacency: every area sharing a border (land, sea, or mixed). Derived from board.svg; symmetry + no-dangling enforced by riversMap.test.ts. */
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
  /**
   * Optional map-driven starting deployment, keyed by area id. When present,
   * `setupGame` uses it instead of the hardcoded Rivers fallback.
   */
  startingDeployment?: Record<string, StartingUnits>;
}

export const riversMapId = "rivers";

/** Runtime Rivers definition, compiled from the hex source (adjacency auto-derived
 *  from shared hex edges). Topology equivalence is locked by riversSource.test.ts. */
export const riversMap: MapDefinition = compileHexMap(riversSource).definition;
