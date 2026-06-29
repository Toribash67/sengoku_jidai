import type { SeatId } from "../../types.js";
import type { Axial, HexLayout } from "./coords.js";
import type { StartingUnits } from "../riversMap.js";

export type { StartingUnits };

/** One game tile: a connected set of same-kind hexes plus its feature flags. */
export interface HexTileSource {
  /** Unique within the map. */
  id: string;
  /** Every member hex inherits this. */
  kind: "land" | "sea";
  /** Connected, non-empty, disjoint from other tiles' hexes. */
  hexes: Axial[];
  features: {
    /** HQ owner if this tile is a faction headquarters. */
    hq?: SeatId;
    valueStars?: 0 | 1 | 2;
    /** Can build/launch ships (a port endpoint). */
    harbor?: boolean;
    /** Coastal land targetable by Shell. */
    shellable?: boolean;
  };
  /** Sea tile ids reachable from this harbor via a pier. Not movement edges. */
  ports?: string[];
}

/** The hex authoring format. Compiled to a runtime `MapDefinition` by `compileHexMap`. */
export interface HexMapSource {
  id: string;
  name: string;
  /** Flat-top layout for the renderer/editor; the engine ignores it. */
  layout: HexLayout;
  tiles: HexTileSource[];
  /** Map-driven starting unit placement, keyed by tile id. */
  startingDeployment: Record<string, StartingUnits>;
  /** Tile ids that receive a random bonus at setup. */
  bonusSlots: string[];
}
