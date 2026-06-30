import type { HexMapSource } from "./hex/source.js";

/**
 * Rivers authored as a hex map. The hex layout was reconstructed from the
 * flat-top hex grid in assets/maps/rivers/board.svg (size 114): single-hex
 * tiles read directly from the board, multi-hex tiles (1,5,14,18,22) placed so
 * the edge-derived adjacency exactly reproduces the hand-authored graph. The
 * equivalence is locked by riversSource.test.ts against riversMap.snapshot.json.
 */
export const riversSource: HexMapSource = {
  id: "rivers",
  name: "Rivers",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "tile1", kind: "land", hexes: [{ q: 0, r: 2 }, { q: 0, r: 3 }], features: {} },
    { id: "tile2", kind: "land", hexes: [{ q: 1, r: 1 }], features: { valueStars: 1 } },
    { id: "tile3", kind: "sea", hexes: [{ q: 2, r: 1 }], features: { valueStars: 1 } },
    { id: "tile4", kind: "land", hexes: [{ q: 3, r: 0 }], features: { valueStars: 1 } },
    { id: "tile5", kind: "land", hexes: [{ q: 4, r: 0 }, { q: 4, r: 1 }], features: {} },
    {
      id: "tile6", kind: "land", hexes: [{ q: 1, r: 2 }],
      features: { valueStars: 1, harbor: true }, ports: ["tile3", "tile7"]
    },
    { id: "tile7", kind: "sea", hexes: [{ q: 2, r: 2 }], features: { valueStars: 1 } },
    {
      id: "tile8", kind: "land", hexes: [{ q: 3, r: 1 }],
      features: { valueStars: 1, harbor: true }, ports: ["tile3", "tile7"]
    },
    {
      id: "tile9", kind: "land", hexes: [{ q: 0, r: 4 }],
      features: { hq: "red", harbor: true }, ports: ["tile14", "tile15"]
    },
    { id: "tile10", kind: "land", hexes: [{ q: 1, r: 3 }], features: { shellable: true } },
    { id: "tile11", kind: "sea", hexes: [{ q: 2, r: 3 }], features: { valueStars: 1 } },
    { id: "tile12", kind: "land", hexes: [{ q: 3, r: 2 }], features: { shellable: true } },
    {
      id: "tile13", kind: "land", hexes: [{ q: 4, r: 2 }],
      features: { hq: "black", harbor: true }, ports: ["tile17", "tile18"]
    },
    { id: "tile14", kind: "sea", hexes: [{ q: 0, r: 5 }, { q: 0, r: 6 }], features: {} },
    { id: "tile15", kind: "sea", hexes: [{ q: 1, r: 4 }], features: { valueStars: 1 } },
    {
      id: "tile16", kind: "land", hexes: [{ q: 2, r: 4 }],
      features: { valueStars: 2, harbor: true }, ports: ["tile11", "tile15", "tile17"]
    },
    { id: "tile17", kind: "sea", hexes: [{ q: 3, r: 3 }], features: { valueStars: 1 } },
    { id: "tile18", kind: "sea", hexes: [{ q: 4, r: 3 }, { q: 4, r: 4 }], features: {} },
    { id: "tile19", kind: "land", hexes: [{ q: 1, r: 5 }], features: { shellable: true } },
    { id: "tile20", kind: "land", hexes: [{ q: 2, r: 5 }], features: { valueStars: 2 } },
    { id: "tile21", kind: "land", hexes: [{ q: 3, r: 4 }], features: { shellable: true } },
    {
      id: "tile22", kind: "sea",
      hexes: [{ q: 1, r: 6 }, { q: 2, r: 6 }, { q: 3, r: 5 }], features: {}
    }
  ],
  startingDeployment: {
    tile1: { seat: "red", troop: 2 },
    tile9: { seat: "red", troop: 3 },
    tile10: { seat: "red", troop: 2 },
    tile14: { seat: "red", ship: 3 },
    tile19: { seat: "red", troop: 3 },
    tile5: { seat: "black", troop: 2 },
    tile13: { seat: "black", troop: 3 },
    tile12: { seat: "black", troop: 2 },
    tile18: { seat: "black", ship: 3 },
    tile21: { seat: "black", troop: 3 }
  },
  bonusSlots: ["tile2", "tile4", "tile20"]
};
