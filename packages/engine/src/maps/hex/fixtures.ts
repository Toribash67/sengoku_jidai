import type { HexMapSource } from "./source.js";

/**
 * A tiny synthetic flat-top hex map for tests (NOT Rivers). Five tiles:
 *   A  land, red HQ            hexes (0,0)
 *   B  land, 1 star, shellable hexes (1,0),(1,-1)   (a 2-hex tile)
 *   C  sea, 1 star             hexes (0,1)
 *   D  land, harbor -> port C  hexes (-1,1)
 *   E  land, black HQ          hexes (2,-1)
 *
 * Hand-verified edge adjacency (axial neighbors only):
 *   A(0,0)   borders B,C,D
 *   B(1,0/1,-1) borders A,C,E
 *   C(0,1)   borders A,B,D
 *   D(-1,1)  borders A,C
 *   E(2,-1)  borders B
 */
export const FIXTURE_HEX_MAP: HexMapSource = {
  id: "fixture",
  name: "Fixture",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "A", kind: "land", hexes: [{ q: 0, r: 0 }], features: { hq: "red" } },
    {
      id: "B",
      kind: "land",
      hexes: [
        { q: 1, r: 0 },
        { q: 1, r: -1 }
      ],
      features: { valueStars: 1, shellable: true }
    },
    { id: "C", kind: "sea", hexes: [{ q: 0, r: 1 }], features: { valueStars: 1 } },
    {
      id: "D",
      kind: "land",
      hexes: [{ q: -1, r: 1 }],
      features: { harbor: true },
      ports: ["C"]
    },
    { id: "E", kind: "land", hexes: [{ q: 2, r: -1 }], features: { hq: "black" } }
  ],
  startingDeployment: {
    A: { seat: "red", troop: 3 },
    C: { seat: "red", ship: 1 },
    E: { seat: "black", troop: 3 }
  },
  bonusSlots: ["B"]
};
